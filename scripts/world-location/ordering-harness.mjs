// WORLD LOCATION-4 — ordering harness (LOCAL ONLY). Generic: generated players and tokens,
// a per-run local secret, an embedded Postgres; no hosted project, JWT or real account.
//
//   node scripts/world-location/ordering-harness.mjs [--tree DIR] [--reps 200] [--width 25]
//        [--seed 1] [--port 2800] [--only same-process,two-process,candidates,shadow-refused,inverted,failed-startup,drain,shutdown,lost]
//        [--out results.json]
//
// --tree runs another checkout (its realtime, world-authority handler and migrations end to
// end): the negative control runs the protocol before WORLD LOCATION-4 (4d0ab64) and must
// FAIL the T3/T4/T7, drain and shutdown checks.
//
// Modes (docs/design/WORLD_LOCATION_4_DESIGN.md §1, §3.3, §5, §6):
//   same-process  two presence hosts in one process, T3/T4/T7 × reps (orderingSameProcess.mjs)
//   two-process   two real realtime processes (P older, Q newer; shadow, as LOCATION-3B),
//                 T3/T4/T7 × reps; black box: sockets and the database row only
//   candidates, shadow-refused, inverted, failed-startup, drain, shutdown, lost   host lifecycle (orderingLifecycle.mjs)
//
// Exit 0 only if every applicable check passed. Prints a JSON summary.

import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { startLocalAuthority } from './localAuthority.mjs'
import { connect, delay, leave, nudge, startRealtime } from './realtimeProcesses.mjs'
import { pool, seeded, spread, tail, uniform } from './harnessRandom.mjs'
import { runSameProcess } from './orderingSameProcess.mjs'
import { LIFECYCLE } from './orderingLifecycle.mjs'

/** An absolute directory with forward slashes and a trailing slash. */
function normalize(dir) { return `${resolve(dir).replace(/\\/g, '/').replace(/\/?$/, '/')}` }

const here = normalize(fileURLToPath(new URL('../..', import.meta.url)))
const argv = process.argv.slice(2)
const arg = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback }
const tree = normalize(arg('tree', here))
const reps = Number(arg('reps', 200))
const width = Number(arg('width', 25))
const seed = Number(arg('seed', 1))
const basePort = Number(arg('port', 2800))
const only = new Set(arg('only', 'same-process,two-process,candidates,shadow-refused,inverted,failed-startup,drain,shutdown,lost').split(','))
const out = arg('out', null)
const random = seeded(seed)
const { openDirection } = await import(pathToFileURL(`${tree}services/realtime/src/world/testing.js`).href)

/** Two real processes, P then Q (Q's host is newer), on one local authority; shadow, as LOCATION-3B. */
async function twoProcess() {
  const local = await startLocalAuthority({ secret: randomBytes(24).toString('hex'), tree, latency: () => tail(random) })
  const servers = []
  try {
    const P = await startRealtime({ tree, name: 'P', port: basePort, env: local.env('shadow', 'P') })
    servers.push(P)
    const Q = await startRealtime({ tree, name: 'Q', port: basePort + 10, env: local.env('shadow', 'Q') })
    servers.push(Q)
    const at = { P, Q }
    const claimsOf = (inst, userId, since = 0) => local.events.filter(e => e.inst === inst && e.op === 'location_claim' && e.userIds.includes(userId) && e.tRecv >= since)
    const savesOf = (inst, userId, since) => local.events.filter(e => e.inst === inst && e.op === 'location_save' && e.userIds.includes(userId) && e.tRecv >= since && e.tDone !== null)
    const row = async userId => (await local.query('SELECT area_id, tx, ty FROM public.world_player_locations WHERE user_id = $1', [userId])).rows[0] ?? null
    const waitFor = async (condition, ms) => { for (let t = 0; t < ms && !condition(); t += 20) await delay(20); return condition() }

    async function repetition(scenario, i) {
      const variant = i % 4 === 3 ? 'same' : 'cross'
      const where = { A: variant === 'cross' ? 'P' : 'Q', B: 'Q' }
      const { userId, token } = await local.player()
      const fault = scenario === 'T3' ? { mode: 'delay', ms: uniform(random, 300, 1_200) } : scenario === 'T4' ? { mode: 'hold' } : null
      if (fault) local.rule({ op: 'location_claim', inst: where.A, userId, ...fault })
      const gap = scenario === 'T7' ? uniform(random, 0, 300) : scenario === 'T4' ? 300 : uniform(random, 20, 200)
      const a = await connect(at[where.A], token, { tabId: `tab-a-${i}-harness` })
      await delay(gap)
      const tB = local.now()
      const b = await connect(at[where.B], token, { tabId: `tab-b-${i}-harness` })
      await waitFor(() => claimsOf(where.B, userId, tB).some(e => e.tDone !== null), 10_000)
      if (scenario === 'T3') await waitFor(() => local.events.some(e => e.inst === where.A && e.userIds.includes(userId) && e.rule === 'delay' && e.tDone !== null), 5_000)
      if (scenario === 'T4') {
        await delay(4_500) // the realtime gave up on the held claim and retried it
        await local.releaseHeld()
        await delay(300)
      }
      const bClosedByServer = b.left
      await nudge(b, (area, self) => openDirection(area, self, ['right', 'down', 'left', 'up']))
      const bAt = b.self && { areaId: b.self.areaId, tx: b.self.tx, ty: b.self.ty }
      const tLeave = local.now()
      await leave(b)
      await waitFor(() => savesOf(where.B, userId, tLeave).length > 0, 6_000)
      const aOpen = a.left === null
      if (aOpen) { await nudge(a, (area, self) => openDirection(area, self, ['left', 'up', 'right', 'down'])); await leave(a) }
      await delay(1_500)
      const final = await row(userId)
      const violations = []
      if (bClosedByServer !== null) violations.push(`I2 B closed by the server with ${bClosedByServer}`)
      if (!bAt || !final || final.area_id !== bAt.areaId || final.tx !== bAt.tx || final.ty !== bAt.ty) violations.push(`I3 row ${JSON.stringify(final)} is not B's last ${JSON.stringify(bAt)}`)
      return { scenario, variant, i, fault, gap, violations, aOutcome: aOpen ? 'open' : a.left ?? `refused ${a.refused}` }
    }

    const results = {}
    for (const scenario of ['T3', 'T4', 'T7']) {
      const started = performance.now()
      const runs = await pool(reps, width, i => repetition(scenario, i).catch(error => ({ scenario, i, violations: [`error: ${String(error?.message ?? error)}`] })))
      results[scenario] = {
        reps: runs.length, ms: Math.round(performance.now() - started),
        violated: runs.filter(r => r.violations.length).length,
        gaps: spread(runs.map(r => r.gap).filter(Number.isFinite)),
        injected: spread(runs.map(r => r.fault?.ms).filter(Number.isFinite)),
        olderOutcomes: runs.reduce((count, r) => { const k = String(r.aOutcome); count[k] = (count[k] ?? 0) + 1; return count }, {}),
        examples: runs.filter(r => r.violations.length).slice(0, 5),
      }
    }
    return { applicable: true, results, hosts: await local.hosts(), authorityCalls: { ...local.calls } }
  } finally {
    for (const server of servers) await server.kill()
    await local.close()
  }
}

const summary = { tree: tree === here ? 'this checkout' : 'other (--tree)', reps, width, seed, modes: {} }
const failed = []
const record = (name, outcome) => {
  summary.modes[name] = outcome
  const violated = outcome.applicable && (Object.values(outcome.results ?? {}).some(r => r.violated > 0) || outcome.passed === false)
  if (violated) failed.push(name)
  // A crashed scenario says ERROR, never FAIL: a crash is not a detection (mutationJudge.mjs).
  console.log(`${name}: ${!outcome.applicable ? `n/a (${outcome.reason})` : outcome.error ? `ERROR (${String(outcome.error).split('\n')[0].slice(0, 120)})` : violated ? 'FAIL' : 'PASS'}`)
}
const guarded = async (name, run) => { try { record(name, await run()) } catch (error) { record(name, { applicable: true, passed: false, error: String(error?.stack ?? error).slice(0, 600) }) } }

if (only.has('same-process')) await guarded('same-process', () => runSameProcess({ tree, reps, random, width }))
if (only.has('two-process')) await guarded('two-process', twoProcess)
for (const [name, scenario] of Object.entries(LIFECYCLE)) {
  if (only.has(name)) await guarded(name, () => scenario({ tree, random, basePort: basePort + 100, reps }))
}

summary.passed = failed.length === 0
summary.failed = failed
const text = JSON.stringify(summary, null, 2)
if (out) writeFileSync(out, text)
console.log(text)
process.exit(summary.passed ? 0 : 1)
