// WORLD LOCATION-2/4 — a LOCAL stand-in for what a realtime process talks to in
// production, for the two-instance simulation, the ordering harness and the
// location benchmark.
//
//   - /functions/v1/world-authority: the REAL handler
//     (supabase/functions/world-authority/handler.ts) over an embedded
//     Postgres (PGlite) running the real migrations, as service_role;
//   - /auth/v1/user: a token → user id map (Supabase Auth stand-in);
//   - any other path: an empty JSON array (wild catalog, companion reads).
//
// `tree` is the checkout under test (default: this one). The handler, the
// migrations and the embedded database all come from it, so an older tree runs
// against its own protocol end to end (negative controls).
//
// Each realtime process gets its own authority URL (`env(mode, inst)`), so every
// request is attributed to an instance. `rule()` injects faults per operation,
// instance and player:
//   - delay: the operation reaches the database `ms` later (it lands late: T3);
//   - slow:  the operation runs at once, its answer comes `ms` later;
//   - hold:  no answer; the operation waits until `releaseHeld()` runs it late
//            (an aborted request whose database work lands after the give-up);
//   - lose:  the operation runs, then the connection is cut (a lost response);
//   - fail:  answer 503 without running anything (authority unavailable).
// `latency()` adds a distributed delay to every authority request.
// `events` records every location and presence operation with its answer.
//
// Generic on purpose: generated users and tokens, a local secret, no network
// beyond 127.0.0.1. Not a substitute for the local Supabase stack (no PostgREST
// grants, Auth or Edge Runtime): it exercises the realtime ↔ authority ↔ SQL
// contract only.

import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(new URL('../..', import.meta.url))
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

export async function startLocalAuthority({ secret, tree = here, latency = () => 0 }) {
  const { openLocalDatabase, serviceQuery } = await import(pathToFileURL(`${tree}services/realtime/src/world/persistence/dev/localDatabase.js`).href)
  const { handleWorldAuthority } = await import(pathToFileURL(`${tree}supabase/functions/world-authority/handler.ts`).href)
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
      // As index.ts: the error code (never the message) reaches the handler (CLOUD READINESS-3: 42883 = missing function).
      return { data: null, error: { message: error.message, code: error.code } }
    }
  }
  const tokens = new Map()
  const calls = { location_claim: 0, location_save: 0, location_rows: 0, presence: 0, other: 0, held: 0, lost: 0, failed: 0 }
  const rules = []
  const held = []
  const events = []
  const started = performance.now()
  const now = () => performance.now() - started

  /** The first live rule for this request (consumed once per match). */
  function take(op, inst, userIds) {
    const index = rules.findIndex(r => (r.op === op || r.op === '*') && (!r.inst || r.inst === inst) && (!r.userId || userIds.includes(r.userId)) && r.times > 0)
    if (index < 0) return null
    const rule = rules[index]
    rule.times--
    if (rule.times <= 0) rules.splice(index, 1)
    return rule
  }

  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = Buffer.concat(chunks)
    const send = (status, json) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(json)) }
    const url = new URL(request.url, 'http://local')
    if (url.pathname.startsWith('/functions/v1/world-authority')) {
      const inst = url.searchParams.get('inst') ?? '?'
      let parsed = null
      try { parsed = JSON.parse(body.toString()) } catch { /* the handler answers 400 */ }
      const op = typeof parsed?.op === 'string' ? parsed.op : '?'
      const userIds = op === 'location_claim' || op === 'location_claim_v2' || op === 'location_claim_v3' ? [parsed.userId] : op === 'location_save' && Array.isArray(parsed.rows) ? parsed.rows.map(r => r?.userId) : []
      if (op === 'location_claim') calls.location_claim++
      else if (op === 'location_save') { calls.location_save++; calls.location_rows += userIds.length }
      else if (op.startsWith('presence_')) calls.presence++
      else calls.other++
      // CLOUD READINESS-3: the v6 ops too (location_claim_v2, capabilities).
      // CLOUD JOIN-ORDER-2: and the v7 claim (location_claim_v3).
      const traced = op === 'location_claim' || op === 'location_claim_v2' || op === 'location_claim_v3' || op === 'location_save' || op === 'capabilities' || op.startsWith('presence_')
      const event = traced ? { inst, op, userIds, body: parsed, tRecv: now(), tDone: null, answer: null, rule: null } : null
      if (event) events.push(event)
      const run = async () => {
        const reply = await handleWorldAuthority(new Request('http://local/world-authority', { method: request.method, headers: request.headers, body }), { secret, rpc })
        const text = await reply.text()
        if (event) { event.tDone = now(); event.status = reply.status; try { event.answer = JSON.parse(text) } catch { event.answer = text } }
        return { status: reply.status, text }
      }
      const rule = take(op, inst, userIds)
      if (event && rule) event.rule = rule.mode
      if (rule?.mode === 'fail') { calls.failed++; if (event) { event.tDone = now(); event.status = 503 } return send(503, { error: 'unavailable' }) }
      if (rule?.mode === 'hold') {
        calls.held++
        held.push(async () => JSON.parse((await run()).text))
        return // never answered: the realtime gives up and aborts
      }
      const extra = latency()
      if (extra > 0) await wait(extra)
      if (rule?.mode === 'delay') await wait(rule.ms)
      const reply = await run()
      if (rule?.mode === 'lose') { calls.lost++; request.socket.destroy(); return }
      if (rule?.mode === 'slow') await wait(rule.ms)
      response.writeHead(reply.status, { 'content-type': 'application/json' })
      response.end(reply.text)
      return
    }
    if (url.pathname.startsWith('/auth/v1/user')) {
      const id = tokens.get(String(request.headers.authorization ?? '').replace(/^Bearer /, ''))
      return id ? send(200, { id, user_metadata: { username: `p${id.slice(0, 6)}` } }) : send(401, {})
    }
    send(200, [])
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  return {
    base, calls, query, db, events, now,
    /** A new auth user and a token that authenticates as it. */
    async player() {
      const userId = randomUUID()
      const token = `tok-${randomUUID()}`
      tokens.set(token, userId)
      await db.query('INSERT INTO auth.users VALUES ($1)', [userId])
      return { userId, token }
    },
    /** The env a realtime process needs to use this authority, as instance `inst`. */
    env(mode, inst = 'A') {
      return {
        SUPABASE_URL: base, SUPABASE_PUBLISHABLE_KEY: 'local-publishable', WORLD_WILD_CATALOG: 'synthetic',
        WORLD_AUTHORITY_URL: `${base}/functions/v1/world-authority?inst=${encodeURIComponent(inst)}`, WORLD_AUTHORITY_SECRET: secret,
        WORLD_LOCATION_PERSISTENCE: mode, WORLD_PLAYERDATA: '', WORLD_DEMO_SKILLS: '',
      }
    },
    /** Inject a fault: { op, inst?, userId?, mode: 'delay'|'slow'|'hold'|'lose'|'fail', ms?, times? = 1 }. */
    rule(rule) { rules.push({ times: 1, ...rule }) },
    /** Removes every rule, or only those of one operation. */
    clearRules(op = null) { for (let i = rules.length - 1; i >= 0; i--) if (!op || rules[i].op === op) rules.splice(i, 1) },
    /** The next location_claim of this player hangs until releaseHeld(). */
    holdClaims(userId) { rules.push({ op: 'location_claim', userId, mode: 'hold', times: 1 }) },
    /** Runs the oldest held operation now, against the database; resolves to its answer. */
    async releaseHeld() { return held.shift()() },
    held: () => held.length,
    /** The presence hosts table (null on a tree without WORLD LOCATION-4). */
    async hosts() {
      try {
        const { rows } = await query('SELECT generation::int AS generation, state, activated_at, draining_at, stopped_at, lease_expires_at > now() AS live FROM public.world_presence_hosts ORDER BY generation')
        return rows
      } catch { return null }
    },
    async close() { server.closeAllConnections?.(); server.close(); await db.close() },
  }
}
