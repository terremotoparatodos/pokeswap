// WORLD LOCATION-2 — a LOCAL stand-in for what a realtime process talks to in
// production, for the two-instance simulation and the location benchmark.
//
//   - /functions/v1/world-authority: the REAL handler
//     (supabase/functions/world-authority/handler.ts) over an embedded
//     Postgres (PGlite) running the real migrations, as service_role;
//   - /auth/v1/user: a token → user id map (Supabase Auth stand-in);
//   - any other path: an empty JSON array (wild catalog, companion reads).
//
// `holdClaims(userId)` makes the next location_claim of that player hang: no
// answer, and the operation itself waits until `releaseHeld()` runs it — an
// aborted request whose database work lands late (review B2).
//
// Not a substitute for the local Supabase stack (no PostgREST grants, Auth or
// Edge Runtime): it exercises the realtime ↔ authority ↔ SQL contract only.

import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))

export async function startLocalAuthority({ secret }) {
  const { openLocalDatabase, serviceQuery } = await import(pathToFileURL(`${root}services/realtime/src/world/persistence/dev/localDatabase.js`).href)
  const { handleWorldAuthority } = await import(pathToFileURL(`${root}supabase/functions/world-authority/handler.ts`).href)
  const db = await openLocalDatabase()
  const query = serviceQuery(db)
  const rpc = async (fn, args) => {
    try {
      const names = Object.keys(args)
      const sql = fn === 'world_load_nodes'
        ? 'SELECT coalesce(json_agg(n), \'[]\'::json) AS data FROM public.world_load_nodes() n'
        : `SELECT public.${fn}(${names.map((name, i) => `${name} => $${i + 1}`).join(', ')}) AS data`
      const values = names.map(name => (args[name] !== null && typeof args[name] === 'object' ? JSON.stringify(args[name]) : args[name]))
      const { rows } = await query(sql, values)
      return { data: rows[0]?.data ?? null, error: null }
    } catch (error) {
      return { data: null, error: { message: error.message } }
    }
  }
  const tokens = new Map()
  const calls = { location_claim: 0, location_save: 0, location_rows: 0, other: 0, held: 0 }
  const holding = new Set()
  const held = []
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = Buffer.concat(chunks)
    const send = (status, json) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(json)) }
    if (request.url.startsWith('/functions/v1/world-authority')) {
      let parsed = null
      try { parsed = JSON.parse(body.toString()) } catch { /* the handler answers 400 */ }
      if (parsed?.op === 'location_claim') calls.location_claim++
      else if (parsed?.op === 'location_save') { calls.location_save++; calls.location_rows += Array.isArray(parsed.rows) ? parsed.rows.length : 0 }
      else calls.other++
      const run = () => handleWorldAuthority(new Request('http://local/world-authority', { method: request.method, headers: request.headers, body }), { secret, rpc })
      if (parsed?.op === 'location_claim' && holding.delete(parsed.userId)) {
        calls.held++
        held.push(async () => { const late = await run(); return late.json() })
        return // never answered: the realtime gives up and aborts
      }
      const reply = await run()
      response.writeHead(reply.status, { 'content-type': 'application/json' })
      response.end(await reply.text())
      return
    }
    if (request.url.startsWith('/auth/v1/user')) {
      const id = tokens.get(String(request.headers.authorization ?? '').replace(/^Bearer /, ''))
      return id ? send(200, { id, user_metadata: { username: `p${id.slice(0, 6)}` } }) : send(401, {})
    }
    send(200, [])
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  return {
    base, calls, query, db,
    /** A new auth user and a token that authenticates as it. */
    async player() {
      const userId = randomUUID()
      const token = `tok-${randomUUID()}`
      tokens.set(token, userId)
      await db.query('INSERT INTO auth.users VALUES ($1)', [userId])
      return { userId, token }
    },
    /** The env a realtime process needs to use this authority. */
    env(mode) {
      return {
        SUPABASE_URL: base, SUPABASE_PUBLISHABLE_KEY: 'local-publishable', WORLD_WILD_CATALOG: 'synthetic',
        WORLD_AUTHORITY_URL: `${base}/functions/v1/world-authority`, WORLD_AUTHORITY_SECRET: secret,
        WORLD_LOCATION_PERSISTENCE: mode, WORLD_PLAYERDATA: '', WORLD_DEMO_SKILLS: '',
      }
    },
    /** The next location_claim of this player hangs until releaseHeld(). */
    holdClaims(userId) { holding.add(userId) },
    /** Runs the oldest held claim now, against the database; resolves to its answer. */
    async releaseHeld() { return held.shift()() },
    async close() { server.closeAllConnections?.(); server.close(); await db.close() },
  }
}
