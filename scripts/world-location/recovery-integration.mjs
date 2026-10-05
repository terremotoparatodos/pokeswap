// CLOUD READINESS-3 — integrated local validation: REAL realtime processes (services/realtime/src/index.js,
// development mode) against the REAL world-authority handler over an embedded Postgres with every migration
// (localAuthority.mjs), synthetic users, 127.0.0.1 only. Each scenario starts its own authority and processes.
//
//   node scripts/world-location/recovery-integration.mjs [--only D2A,D2B] [--out report.json]
//
// What it can and cannot show: a process here is a PM2 slot, not a routed slot. There is no NGINX: "the host
// recovered" means a process holds the ACTIVE identity; which process NGINX publishes is the agent's decision
// (the PM2/NGINX emulation, separate). Every wait is bounded; a wait that runs out is BLOCKED, never a pass.
// Real timers: lease 15 s, renew 5 s, standby probe 5 s + jitter.

import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { startLocalAuthority } from './localAuthority.mjs'
import { connect, delay, leave, nudge, startRealtime } from './realtimeProcesses.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const { openDirection } = await import(new URL('../../services/realtime/src/world/testing.js', import.meta.url).href)
const ROLLBACK = fileURLToPath(new URL('./rollback_world_presence_recovery.sql', import.meta.url))
const argv = process.argv.slice(2)
const arg = name => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : null }
const only = arg('only')?.split(',') ?? null
let nextPort = 38_100

class Blocked extends Error {}
async function until(label, predicate, ms) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) { const value = await predicate(); if (value) return value; await delay(200) }
  throw new Blocked(`timed out after ${ms} ms: ${label}`)
}

async function world(t) {
  const local = await startLocalAuthority({ secret: randomBytes(24).toString('hex') })
  const servers = []
  t.cleanup.push(async () => { for (const s of servers) await s.kill(); await local.close() })
  const start = async (name, { recovery = true, ready = true } = {}) => {
    const port = nextPort; nextPort += 2
    const s = await startRealtime({ name, port, env: { ...local.env('on', name), ...(recovery ? { WORLD_PRESENCE_RECOVERY: 'on' } : {}) } })
    servers.push(s)
    if (ready) await until(`${name} ready`, async () => (await s.ready()) === 200, 30_000)
    return s
  }
  const hosting = async s => (await s.metrics())?.hosting ?? null
  const live = async () => (await local.hosts()).filter(h => h.state === 'active' && h.live).map(h => h.generation)
  return { local, start, hosting, live }
}

const SCENARIOS = {
  /** D2-A: the old process is displaced by a newer one, which then stops: the old process recovers with a NEW identity. */
  async D2A(t) {
    const out = {}
    for (const recovery of [true, false]) {
      const w = await world(t)
      const A = await w.start(`A${recovery ? '' : '-off'}`, { recovery })
      const generationA = (await w.hosting(A)).generation
      const B = await w.start(`B${recovery ? '' : '-off'}`)
      await until('A displaced', async () => (await w.hosting(A))?.displaced, 20_000)
      const stoppedAt = Date.now()
      await B.shutdown()
      if (recovery) {
        const h = await until('A promoted', async () => { const x = await w.hosting(A); return x?.standbyCounters?.promotions === 1 ? x : null }, 40_000)
        const recoveredMs = Date.now() - stoppedAt
        const p = await w.local.player()
        const socket = await connect(A, p.token, { tabId: 'tab-d2a-0001' })
        out.recovered = { recoveredMs, oldGeneration: generationA, newGeneration: h.generation, ready: await A.ready(), liveHosts: await w.live(), playerPlaced: Boolean(socket.self) }
        await leave(socket)
        t.check('D2-A: one host again, with a NEW identity, admitting players', out.recovered.newGeneration > generationA && out.recovered.ready === 200 && out.recovered.liveHosts.length === 1 && out.recovered.playerPlaced)
      } else {
        await delay(25_000)
        out.control = { ready: await A.ready(), liveHosts: await w.live(), standby: (await w.hosting(A))?.standby }
        t.check('control (kill switch off): D2-A stays without an active host', out.control.ready === 503 && out.control.liveHosts.length === 0 && out.control.standby === false)
      }
    }
    return out
  },

  /** D2-B: a player claimed on a newer host that STOPPED; resuming on the older, still active one restores its tile (no false 4409). */
  async D2B(t) {
    const out = {}
    for (const recovery of [true, false]) {
      const w = await world(t)
      const A = await w.start(`A${recovery ? '' : '-off'}`, { recovery })
      // A must not learn of B in this window (its renew answers would say newerActive): they fail, for less than a lease.
      w.local.rule({ op: 'presence_renew', inst: A.name, mode: 'fail', times: 1_000 })
      const B = await w.start(`B${recovery ? '' : '-off'}`)
      const p = await w.local.player()
      const onB = await connect(B, p.token, { tabId: 'tab-d2b-0001' })
      await nudge(onB, openDirection)
      const tile = { areaId: onB.self.areaId, tx: onB.self.tx, ty: onB.self.ty }
      await B.shutdown()                                  // drains (saves the tile) and stops its identity
      w.local.clearRules('presence_renew')
      const onA = await connect(A, p.token, { tabId: 'tab-d2b-0001', resume: true, waitSelf: false })
      await until('the resume settles', () => onA.self || onA.left !== null || onA.refused !== null, 10_000)
      await delay(300)
      const got = onA.self && { areaId: onA.self.areaId, tx: onA.self.tx, ty: onA.self.ty }
      const settled = { tile, restored: got, left: onA.left, closing: [...onA.closing], refused: onA.refused }
      out[recovery ? 'recovery' : 'control'] = settled
      await leave(onA)
      if (recovery) t.check('D2-B: the resume on the older host restores the tile saved by the stopped one', JSON.stringify(got) === JSON.stringify(tile) && settled.left === null)
      else t.check('control (kill switch off): the same resume is the false 4409', settled.left === 4409 && settled.closing.includes('replaced'))
    }
    return out
  },

  /** A crashed newer owner: a resume gets 4503 owner-unreachable and writes nothing; only «Jugar acá» (takeover) restores. */
  async UNREACHABLE(t) {
    const w = await world(t)
    const A = await w.start('A')
    w.local.rule({ op: 'presence_renew', inst: A.name, mode: 'fail', times: 1_000 })
    const B = await w.start('B')
    const p = await w.local.player()
    const onB = await connect(B, p.token, { tabId: 'tab-unr-0001' })
    await nudge(onB, openDirection)
    const tile = { areaId: onB.self.areaId, tx: onB.self.tx, ty: onB.self.ty }
    await leave(onB)                                       // a disconnect is an urgent save
    await until('the tile saved', () => w.local.events.some(e => e.inst === 'B' && e.op === 'location_save' && e.status === 200), 10_000)
    const generationB = (await w.local.hosts()).at(-1).generation
    await B.kill()                                         // crash: B stays 'active' until its lease runs out
    await until('B lease expired', async () => !(await w.local.hosts()).find(h => h.generation === generationB)?.live, 30_000)
    w.local.clearRules('presence_renew')
    await until('A serving again', async () => (await A.ready()) === 200, 20_000)
    const resumes = []
    for (const options of [{ resume: true }, {}]) {
      const s = await connect(A, p.token, { tabId: 'tab-unr-0001', waitSelf: false, ...options })
      await until('the join settles', () => s.self || s.left !== null || s.refused !== null, 10_000)
      resumes.push({ options, left: s.left, closing: s.closing, placed: Boolean(s.self) })
      await leave(s)
    }
    const playHere = await connect(A, p.token, { tabId: 'tab-unr-0001', takeover: true })
    const got = { areaId: playHere.self.areaId, tx: playHere.self.tx, ty: playHere.self.ty }
    await leave(playHere)
    t.check('a resume and a plain fresh join get 4503 owner-unreachable', resumes.every(r => r.left === 4503 && r.closing.includes('owner-unreachable') && !r.placed))
    t.check('«Jugar acá» (takeover) restores the last confirmed tile', JSON.stringify(got) === JSON.stringify(tile))
    return { tile, resumes, playHere: got }
  },

  /** SIGINT while the standby's exclusive activation is in flight: the process exits; the late activation is never installed by it. */
  async SIGINT_PROMOTION(t) {
    const w = await world(t)
    const A = await w.start('A')
    const B = await w.start('B')
    await until('A displaced', async () => (await w.hosting(A))?.displaced, 20_000)
    w.local.rule({ op: 'presence_activate_exclusive', inst: 'A', mode: 'hold', times: 1 })
    await B.shutdown()
    await until('the exclusive activation is held', () => w.local.held() === 1, 40_000)
    const exit = A.shutdown()
    const code = await Promise.race([exit, delay(20_000).then(() => 'still running')])
    const late = await w.local.releaseHeld()              // the activation reaches the database after the process is gone
    const hosts = await w.local.hosts()
    t.check('the process exits on SIGTERM during its promotion', code === 0)
    t.check('the late activation finds the identity already stopped: no active host without a process', late?.status === 'host_inactive' && hosts.every(h => !(h.state === 'active' && h.live)))
    return { exitCode: code, lateAnswer: late, hosts: hosts.map(h => ({ generation: h.generation, state: h.state, live: h.live })) }
  },

  /** The authority is down while in standby: no promotion; it recovers once the authority answers again. */
  async AUTHORITY_DOWN(t) {
    const w = await world(t)
    const A = await w.start('A')
    const B = await w.start('B')
    await until('A displaced', async () => (await w.hosting(A))?.displaced, 20_000)
    w.local.rule({ op: '*', inst: 'A', mode: 'fail', times: 100_000 })
    await B.shutdown()
    await delay(20_000)
    const during = await w.hosting(A)
    w.local.clearRules()
    const after = await until('A promoted', async () => { const x = await w.hosting(A); return x?.standbyCounters?.promotions === 1 ? x : null }, 40_000)
    t.check('no promotion while the authority is down (probe failures only)', during.standbyCounters.promotions === 0 && during.standbyCounters.probeFailures > 0)
    t.check('recovers once the authority answers', after.standbyCounters.promotions === 1 && (await w.live()).length === 1)
    return { during: during.standbyCounters, after: after.standbyCounters }
  },

  /** The recovery SQL is rolled back under a live process: one v2 call is unsupported, the same key goes through v1, recovery stays off. */
  async CAPABILITY_ROLLBACK(t) {
    const w = await world(t)
    const D = await w.start('D')
    const before = (await w.hosting(D)).recovery
    await w.local.db.exec(await readFile(ROLLBACK, 'utf8'))
    const p = await w.local.player()
    const s = await connect(D, p.token, { tabId: 'tab-cap-0001' })
    const after = (await w.hosting(D)).recovery
    const claims = w.local.events.filter(e => e.inst === 'D' && (e.op === 'location_claim_v2' || e.op === 'location_claim')).map(e => ({ op: e.op, status: e.status, seq: e.body?.seq }))
    await leave(s)
    t.check('enabled before, disabled (sql-missing) after one unsupported call', before.state === 'enabled' && after.state === 'disabled' && after.reason === 'sql-missing')
    t.check('the player is placed: the SAME key claimed once through v1', Boolean(s.self) && claims.length === 2 && claims[0].op === 'location_claim_v2' && claims[0].status === 501 && claims[1].op === 'location_claim' && claims[1].status === 200 && claims[0].seq === claims[1].seq)
    return { before, after, claims }
  },

  /** Two deploy candidates start at once next to an active host: exactly one active host settles and stays (no oscillation). */
  async CONCURRENT_CANDIDATES(t) {
    const w = await world(t)
    await w.start('A')
    // Concurrent candidates: the older one may be displaced at once (503, by design), so only listening is awaited.
    await Promise.all([w.start('B', { ready: false }), w.start('C', { ready: false })])
    await until('one active host', async () => (await w.live()).length === 1, 30_000)
    const samples = []
    for (let i = 0; i < 20; i++) { samples.push(await w.live()); await delay(1_000) }
    const stable = samples.every(s => s.length === 1 && s[0] === samples[0][0])
    t.check('exactly one active host for 20 s, always the same (no alternation between standbys)', stable)
    return { samples: samples.map(s => s.join(',')) }
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
  console.log(`${name.padEnd(22)} ${verdict.padEnd(8)} ${Math.round((Date.now() - started) / 1000)}s ${t.checks.filter(c => !c.ok).map(c => `✗ ${c.label}`).join(' | ')}${facts?.error ? ` ${facts.error}` : ''}`.trimEnd())
}
report.finishedAt = new Date().toISOString()
const out = arg('out')
if (out) await writeFile(out, JSON.stringify(report, null, 2) + '\n')
process.exit(blocked ? 2 : failed ? 1 : 0)
