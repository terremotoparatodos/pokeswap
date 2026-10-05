// CLOUD JOIN-ORDER-2 — integrated local validation (local staging of the candidate): REAL realtime processes
// (services/realtime/src/index.js, development mode) and REAL @colyseus/sdk sockets against the REAL
// world-authority handler (v7) over an embedded Postgres with every migration (localAuthority.mjs).
// Synthetic users, 127.0.0.1 only; nothing hosted, no existing environment, no secret of any.
//
//   node scripts/world-location/join-order-integration.mjs [--only SAME,TWO] [--out report.json]
//
// Each scenario starts its own authority and processes. A process is a PM2 slot, not a routed slot (no
// NGINX here). Every wait is bounded; a wait that runs out is BLOCKED, never a pass. Controls run the same
// steps with WORLD_JOIN_ORDER unset (today's behaviour) and must show the defect.

import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { startLocalAuthority } from './localAuthority.mjs'
import { connect, delay, leave, nudge, startRealtime } from './realtimeProcesses.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const { openDirection } = await import(new URL('../../services/realtime/src/world/testing.js', import.meta.url).href)
const JOIN_ORDER_ROLLBACK = fileURLToPath(new URL('./rollback_world_location_join_order.sql', import.meta.url))
const argv = process.argv.slice(2)
const arg = name => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : null }
const only = arg('only')?.split(',') ?? null
let nextPort = 38_300
const PAGE = 'tab-jo2-page-0001'

class Blocked extends Error {}
async function until(label, predicate, ms) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) { const value = await predicate(); if (value) return value; await delay(100) }
  throw new Blocked(`timed out after ${ms} ms: ${label}`)
}

async function world(t, { sqlWithoutV3 = false } = {}) {
  const local = await startLocalAuthority({ secret: randomBytes(24).toString('hex') })
  if (sqlWithoutV3) await local.db.exec(await readFile(JOIN_ORDER_ROLLBACK, 'utf8'))
  const servers = []
  t.cleanup.push(async () => { for (const s of servers) await s.kill(); await local.close() })
  const start = async (name, { order = 'on', recovery = false } = {}) => {
    const port = nextPort; nextPort += 2
    const env = { ...local.env('on', name), ...(order ? { WORLD_JOIN_ORDER: order } : {}), ...(recovery ? { WORLD_PRESENCE_RECOVERY: 'on' } : {}) }
    const s = await startRealtime({ name, port, env })
    servers.push(s)
    await until(`${name} ready`, async () => (await s.ready()) === 200, 30_000)
    return s
  }
  const owner = async userId => (await local.query('SELECT owner_generation::int AS g FROM public.world_player_locations WHERE user_id = $1', [userId])).rows[0]?.g ?? null
  const attemptOf = async userId => { try { return (await local.query('SELECT owner_attempt::int AS a FROM public.world_player_locations WHERE user_id = $1', [userId])).rows[0]?.a ?? null } catch { return 'no column' } }
  const generation = async s => (await s.metrics())?.hosting?.generation ?? null
  return { local, start, owner, attemptOf, generation }
}

const SCENARIOS = {
  /** One process: the real SDK carries 4410 / 4422 as join refusals; the current socket is untouched. Control: today's 4409. */
  async SAME(t) {
    const out = {}
    for (const order of ['on', null]) {
      const w = await world(t)
      const A = await w.start(`A-${order ?? 'unset'}`, { order })
      const p = await w.local.player()
      const current = await connect(A, p.token, { tabId: PAGE, attempt: 2, resume: true })
      const old = await connect(A, p.token, { tabId: PAGE, attempt: 1, waitSelf: false })
      await until('the old join settles', () => old.refused !== null || old.self || old.left !== null || current.left !== null, 10_000)
      await delay(300)
      const invalid = await connect(A, p.token, { tabId: PAGE, attempt: '3', takeover: true, waitSelf: false })
      await until('the invalid join settles', () => invalid.refused !== null || invalid.self || invalid.left !== null, 10_000)
      const moved = current.left === null ? await nudge(current, openDirection) : false
      const metrics = await A.metrics()
      out[order ?? 'control'] = { oldRefused: old.refused, currentLeft: current.left, currentMoved: moved, invalidRefused: invalid.refused, joinOrder: metrics?.joinOrder ?? null }
      for (const s of [current, old, invalid]) await leave(s)
      if (order) {
        t.check('on: the old attempt is refused 4410 at join; the current socket stays open and keeps moving', old.refused === 4410 && out.on.currentLeft === null && moved)
        t.check('on: an unreadable attempt is refused 4422', invalid.refused === 4422)
        t.check('on: /metrics shows aggregates only', metrics?.joinOrder?.stale === 1 && metrics?.joinOrder?.invalid === 1 && !JSON.stringify(metrics.joinOrder).includes(p.userId))
      } else t.check('control (unset): the old attempt replaces the current socket (4409), as today', old.refused === null && out.control.currentLeft === 4409)
    }
    return out
  },

  /** Two processes: the old attempt lands on the NEWER host; claim v3 refuses it (4410, never placed); the current one keeps the row and saves. */
  async TWO(t) {
    const out = {}
    for (const order of ['on', null]) {
      const w = await world(t)
      const A = await w.start(`A-${order ?? 'unset'}`, { order })
      const p = await w.local.player()
      // The current connection first (its claim must not hear of a newer host: that would drain A, a deploy, not this case).
      const current = await connect(A, p.token, { tabId: PAGE, attempt: 2, resume: true })
      await until('current claimed', async () => (await w.owner(p.userId)) === await w.generation(A), 10_000)
      // Two ACTIVE hosts (the window before A renews): A must not learn of B for the scenario's few seconds.
      w.local.rule({ op: 'presence_renew', inst: A.name, mode: 'fail', times: 1_000 })
      const B = await w.start(`B-${order ?? 'unset'}`, { order })
      const old = await connect(B, p.token, { tabId: PAGE, attempt: 1, waitSelf: false })
      await until('the old join settles', () => old.left !== null || old.self || old.refused !== null, 10_000)
      await delay(500)
      const facts = { oldLeft: old.left, oldPlaced: Boolean(old.self), oldRefused: old.refused, owner: await w.owner(p.userId), A: await w.generation(A), B: await w.generation(B), attempt: await w.attemptOf(p.userId) }
      if (order) {
        // The current session saves: a move and a disconnect (an urgent save) both land under its own epoch.
        const moved = await nudge(current, openDirection)
        const currentLeftBeforeLeave = current.left
        const tile = { tx: current.self.tx, ty: current.self.ty }
        await leave(current)
        await until('the current save landed', () => w.local.events.some(e => e.inst === A.name && e.op === 'location_save' && e.status === 200 && JSON.stringify(e.answer).includes('applied')), 10_000)
        const row = (await w.local.query('SELECT tx, ty, owner_generation::int AS g FROM public.world_player_locations WHERE user_id = $1', [p.userId])).rows[0]
        Object.assign(facts, { currentLeftBeforeLeave, moved, tile, row, claims: w.local.events.filter(e => e.op.startsWith('location_claim')).map(e => `${e.inst}:${e.op}:${e.answer?.claim?.status ?? e.status}`) })
        out.on = facts
        t.check('on: the old attempt is closed 4410 on the newer host and never placed', old.left === 4410 && !old.self)
        t.check('on: the current attempt keeps the row (claim v3), whatever the keys', facts.owner === facts.A && facts.attempt === 2)
        t.check('on: the current session was never closed and keeps saving (its tile is the stored one)', currentLeftBeforeLeave === null && moved && row.g === facts.A && row.tx === tile.tx && row.ty === tile.ty)
      } else {
        await until('the current one is fenced (its next save)', () => current.left !== null, 20_000).catch(() => null)
        Object.assign(facts, { currentLeft: current.left })
        out.control = facts
        // Which close reaches the current socket first (4409 fence, or 4503 from A draining for the newer B) is a race of LOCATION-4, not of this case.
        t.check('control (unset): the abandoned attempt is placed and takes the row by key order', facts.owner === facts.B && facts.oldPlaced)
        await leave(current)
      }
      await leave(old)
    }
    return out
  },

  /** An authority whose SQL has no claim v3: the capability turns itself off; in-process order still holds; claims as before. */
  async NO_V3(t) {
    const w = await world(t, { sqlWithoutV3: true })
    const A = await w.start('A')
    const p = await w.local.player()
    const current = await connect(A, p.token, { tabId: PAGE, attempt: 2, resume: true })
    const old = await connect(A, p.token, { tabId: PAGE, attempt: 1, waitSelf: false })
    await until('the old join settles', () => old.refused !== null || old.self || old.left !== null, 10_000)
    const hosting = (await A.metrics())?.hosting
    const currentLeft = current.left
    const currentPlaced = Boolean(current.self)
    const ops = [...new Set(w.local.events.map(e => e.op))]
    for (const s of [current, old]) await leave(s)
    t.check('the join-order capability is disabled (sql-missing); recovery untouched (off)', hosting?.joinOrderAuthority?.state === 'disabled' && hosting?.joinOrderAuthority?.reason === 'sql-missing')
    t.check('the in-process order still refuses the old attempt (4410) and keeps the current socket', old.refused === 4410 && currentLeft === null && currentPlaced)
    t.check('claims go through v1 (never v3)', ops.includes('location_claim') && !ops.includes('location_claim_v3'))
    return { hosting: hosting?.joinOrderAuthority, ops }
  },

  /** Shadow: observed and counted, nothing refused or closed for it; claim v3 never called. */
  async SHADOW(t) {
    const w = await world(t)
    const A = await w.start('A', { order: 'shadow' })
    const p = await w.local.player()
    const current = await connect(A, p.token, { tabId: PAGE, attempt: 2, resume: true })
    const old = await connect(A, p.token, { tabId: PAGE, attempt: 1, waitSelf: false })
    await until('the old join settles', () => old.refused !== null || old.self || current.left !== null, 10_000)
    await delay(300)
    const metrics = await A.metrics()
    const ops = [...new Set(w.local.events.map(e => e.op))]
    const currentLeft = current.left
    for (const s of [current, old]) await leave(s)
    t.check('shadow behaves as today (the late join replaces: 4409) and counts wouldRefuse', old.refused === null && currentLeft === 4409 && metrics?.joinOrder?.wouldRefuse === 1)
    t.check('shadow never requests claim v3', metrics?.hosting?.joinOrderAuthority?.state === 'off' && !ops.includes('location_claim_v3'))
    return { joinOrder: metrics?.joinOrder, ops }
  },
}

const report = { tree: root, startedAt: new Date().toISOString(), node: process.version, scenarios: {} }
let failed = false
let blocked = false
for (const [name, scenario] of Object.entries(SCENARIOS)) {
  if (only && !only.includes(name)) continue
  const t = { checks: [], cleanup: [], check(label, ok) { this.checks.push({ label, ok: Boolean(ok) }) } }
  const started = Date.now()
  let facts = null
  let verdict
  try {
    facts = await scenario(t)
    verdict = t.checks.every(c => c.ok) ? 'PASS' : 'FAIL'
  } catch (error) {
    verdict = 'BLOCKED'
    facts = { error: String(error?.message ?? error).slice(0, 400) }
  } finally {
    for (const clean of t.cleanup.reverse()) await clean().catch(() => {})
  }
  if (verdict === 'FAIL') failed = true
  if (verdict === 'BLOCKED') blocked = true
  report.scenarios[name] = { verdict, seconds: Math.round((Date.now() - started) / 1000), checks: t.checks, facts }
  console.log(`${name.padEnd(10)} ${verdict.padEnd(8)} ${Math.round((Date.now() - started) / 1000)}s ${t.checks.filter(c => !c.ok).map(c => `✗ ${c.label}`).join(' | ')}${facts?.error ? ` ${facts.error}` : ''}`.trimEnd())
}
report.finishedAt = new Date().toISOString()
const out = arg('out')
if (out) await writeFile(out, JSON.stringify(report, null, 2) + '\n')
process.exit(blocked ? 2 : failed ? 1 : 0)
