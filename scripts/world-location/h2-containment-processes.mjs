// H2 containment — acceptance with REAL processes (services/realtime/src/index.js, development mode), REAL
// @colyseus/sdk sockets and the REAL world-authority handler over an embedded Postgres with every migration
// (localAuthority.mjs). Loopback only (h2-loopback.mjs, from investigation/cloud-h2-0.3 @2bab8f7), synthetic
// users and secrets, no inherited application variables. Leases run out NATURALLY (15 s) by refusing only A's
// presence_renew at the local authority; renew 5 s and standby probe 5 s + jitter are the production timers.
// A "route" is the harness choosing A: there is no NGINX, agent or discovery here (Cloud behaviour is not shown).
//
//   node scripts/world-location/h2-containment-processes.mjs [--only CONTAINED,STANDBY_ON,SHADOW,CRASH] [--out report.json]
//
// Every wait is bounded; a wait that runs out is BLOCKED (exit 2), never a pass or a detection.

import net from 'node:net'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { startLocalAuthority } from './localAuthority.mjs'
import { connect, delay, leave, nudge, ORIGIN } from './realtimeProcesses.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const { openDirection } = await import(new URL('../../services/realtime/src/world/testing.js', import.meta.url).href)
const argv = process.argv.slice(2)
const arg = name => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : null }
const only = arg('only')?.split(',') ?? null

class Blocked extends Error {}
async function until(label, predicate, ms = 30_000) {
  const deadline = performance.now() + ms
  while (performance.now() < deadline) { const answer = await predicate(); if (answer) return answer; await delay(100) }
  throw new Blocked(`timed out after ${ms} ms: ${label}`)
}
async function freePort() {
  const s = net.createServer()
  await new Promise(resolve => s.listen(0, '127.0.0.1', resolve))
  const p = s.address().port
  await new Promise(resolve => s.close(resolve))
  return p
}

async function world(t) {
  const local = await startLocalAuthority({ secret: randomBytes(24).toString('hex') })
  const children = []
  t.cleanup.push(async () => { for (const c of children) await c.kill(); await local.close() })
  async function start(name, { mode = 'on', recovery = true, standby = false } = {}) {
    const game = await freePort(), health = await freePort()
    const env = {}
    for (const key of ['SystemRoot', 'SYSTEMROOT', 'PATH', 'Path', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key]
    Object.assign(env, local.env(mode, name), {
      PORT: String(game), HEALTH_PORT: String(health), NODE_ENV: 'development', ALLOWED_ORIGINS: ORIGIN,
      WORLD_PRESENCE_RECOVERY: recovery ? 'on' : '', WORLD_PRESENCE_STANDBY: standby ? 'on' : '', WORLD_JOIN_ORDER: 'off',
    })
    const child = spawn(process.execPath, ['--import', new URL('./h2-loopback.mjs', import.meta.url).href, '--import', new URL('./shutdownOnStdin.mjs', import.meta.url).href,
      fileURLToPath(new URL('../../services/realtime/src/index.js', import.meta.url))], { cwd: root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const exit = new Promise(resolve => child.once('exit', resolve))
    let log = ''
    child.stdout.on('data', chunk => { log += chunk })
    child.stderr.on('data', chunk => { log += chunk })
    const read = async path => {
      try { const res = await fetch(`http://127.0.0.1:${health}${path}`, { signal: AbortSignal.timeout(1000) }); return { status: res.status, body: await res.json() } } catch { return { status: 0, body: null } }
    }
    const server = {
      name, port: game, child, log: () => log,
      metrics: async () => (await read('/metrics')).body, ready: async () => (await read('/readyz')).status,
      hosting: async () => (await read('/metrics')).body?.hosting ?? null,
      async kill() { if (child.exitCode === null) child.kill('SIGKILL'); await exit },
    }
    children.push(server)
    await until(`${name} listening`, async () => (await read('/metrics')).status === 200 || child.exitCode !== null)
    if (child.exitCode !== null) throw new Blocked(`${name} exited: ${log.slice(-400)}`)
    return server
  }
  const hostRow = async generation => (await local.hosts()).find(h => h.generation === generation) ?? null
  const ops = inst => w.local.events.filter(e => e.inst === inst).map(e => e.op)
  const w = { local, start, hostRow, ops }
  return w
}

/** S (older, displaced by A) and A (newer, serving one player); then A's renewals fail until its lease runs out naturally. */
async function routedAExpires(t, w, { mode = 'on', standby = false, refusedS = false } = {}) {
  if (refusedS) w.local.rule({ op: 'presence_activate', inst: 'S', mode: 'hold', times: 1 })
  const S = await w.start('S', { mode, standby })
  if (refusedS) await until('S activation held', () => w.local.held() === 1)
  else await until('S ready', async () => (await S.ready()) === 200)
  const A = await w.start('A', { mode, standby })
  await until('A ready', async () => (await A.ready()) === 200)
  if (refusedS) t.check('S activation answered newer_active (displaced while starting)', (await w.local.releaseHeld())?.status === 'newer_active')
  await until('S displaced', async () => (await S.hosting())?.displaced)
  const player = await w.local.player()
  const socket = await connect(A, player.token, { tabId: 'h2c-page-0001' })
  t.check('a real socket is placed on A', Boolean(socket.self))
  const generation = (await A.hosting()).generation
  w.local.rule({ op: 'presence_renew', inst: 'A', mode: 'fail', times: 1000 })
  await until('A lease expired naturally', async () => !(await w.hostRow(generation))?.live)
  t.check('lease expiry is not process death', A.child.exitCode === null)
  return { S, A, socket, player, generation }
}

const SCENARIOS = {
  /** AT-1 (real): recovery on, standby off — S never probes or promotes; A revives its same identity; the socket stays. */
  async CONTAINED(t) {
    const w = await world(t)
    const { S, A, socket, generation } = await routedAExpires(t, w)
    await delay(8_000)                                         // > one standby probe period (5 s + jitter): a standby would have promoted
    const sDuring = await S.hosting()
    w.local.clearRules('presence_renew')
    // Bounded, and its outcome is ASSERTED below: running out here is never the verdict on its own.
    await until('A renews its own identity', async () => (await A.ready()) === 200, 20_000).catch(() => null)
    const aAfter = await A.hosting()
    const facts = { sDuring: { standby: sDuring.standby, standbyEnabled: sDuring.standbyEnabled, counters: sDuring.standbyCounters, recovery: sDuring.recovery?.state }, aAfter: { generation: aAfter.generation, state: aAfter.state, paused: aAfter.paused }, socketLeft: socket.left, sOps: [...new Set(w.ops('S'))] }
    t.check('S never entered standby; recovery itself enabled', sDuring.standby === false && sDuring.standbyEnabled === false && sDuring.standbyCounters.notRequested === 1 && sDuring.recovery?.state === 'enabled')
    t.check('S never called presence_any_active nor presence_activate_exclusive', !facts.sOps.includes('presence_any_active') && !facts.sOps.includes('presence_activate_exclusive'))
    t.check('A serves again with the SAME generation; its socket was never closed', aAfter.generation === generation && aAfter.state === 'active' && !aAfter.paused && socket.left === null)
    t.check('the moving socket still works', await nudge(socket, openDirection))
    await leave(socket)
    return facts
  },

  /** AT-2 (real, isolated only): the same with WORLD_PRESENCE_STANDBY=on — H2 still exists. */
  async STANDBY_ON(t) {
    const w = await world(t)
    const { S, A, socket, player } = await routedAExpires(t, w, { standby: true })
    await until('S promoted', async () => (await S.hosting())?.standbyCounters?.promotions === 1)
    w.local.clearRules('presence_renew')
    await until('A socket closed', () => socket.left !== null)
    const retry = await connect(A, player.token, { tabId: 'h2c-page-0001', resume: true, waitSelf: false })
    t.check('H2: the live A closes 4503/draining', socket.left === 4503 && socket.closing.includes('draining'))
    t.check('H2: a retry on the route to A is refused 4503', retry.refused === 4503)
    await leave(retry)
    return { socketLeft: socket.left, retryRefused: retry.refused }
  },

  /** AT-3 (real): shadow with the standby REQUESTED — S, displaced while starting, never promotes; no exclusive call. */
  async SHADOW(t) {
    const w = await world(t)
    const { S, A, socket } = await routedAExpires(t, w, { mode: 'shadow', standby: true, refusedS: true })
    await delay(8_000)
    const s = await S.hosting()
    const sOps = [...new Set(w.ops('S'))]
    w.local.clearRules('presence_renew')
    const live = (await w.local.hosts()).filter(h => h.state === 'active' && h.live).map(h => h.generation)
    t.check('shadow S never started a standby (counted wouldStandby) and never promoted', s.standby === false && s.standbyCounters.wouldStandby === 1 && s.standbyCounters.promotions === 0)
    t.check('shadow S never called presence_any_active nor presence_activate_exclusive', !sOps.includes('presence_any_active') && !sOps.includes('presence_activate_exclusive'))
    t.check('no host row became active through S', !live.includes(s.generation ?? -1) && live.every(g => g !== (s.generation ?? -1)))
    await leave(socket)
    return { counters: s.standbyCounters, sOps, liveAfter: live, aReady: await A.ready() }
  },

  /** AT-4 (real): standby off — a REAL crash of A (SIGKILL) with a player; a restarted process recovers the service and the row. */
  async CRASH(t) {
    const w = await world(t)
    const A = await w.start('A')
    await until('A ready', async () => (await A.ready()) === 200)
    const player = await w.local.player()
    const first = await connect(A, player.token, { tabId: 'h2c-crash-0001' })
    await nudge(first, openDirection)
    const tile = { areaId: first.self.areaId, tx: first.self.tx, ty: first.self.ty }
    await leave(first)                                         // a disconnect is an urgent save
    await until('the tile saved', () => w.local.events.some(e => e.inst === 'A' && e.op === 'location_save' && e.status === 200 && JSON.stringify(e.answer).includes('applied')), 10_000)
    const second = await connect(A, player.token, { tabId: 'h2c-crash-0001', resume: true })
    const dead = (await A.hosting()).generation
    await A.kill()                                             // crash: no drain, no stop; its row stays 'active' until the lease runs out
    t.check('the crashed host row is still active with a live lease (no proof of death)', (await w.hostRow(dead))?.state === 'active' && (await w.hostRow(dead))?.live === true)
    const A2 = await w.start('A2')                             // what the supervisor (PM2 autorestart) does: a new process
    await until('A2 ready', async () => (await A2.ready()) === 200)
    const restarted = (await A2.hosting()).generation
    const back = await connect(A2, player.token, { tabId: 'h2c-crash-0001', resume: true })
    const got = back.self && { areaId: back.self.areaId, tx: back.self.tx, ty: back.self.ty }
    const row = (await w.local.query('SELECT owner_generation::int AS g FROM public.world_player_locations WHERE user_id = $1', [player.userId])).rows[0]
    t.check('the restarted process takes a NEW generation and serves (no standby involved)', restarted > dead && (await A2.hosting()).standby === false)
    t.check('the player resumes on it and gets the last confirmed tile; the row is the new generation\'s', JSON.stringify(got) === JSON.stringify(tile) && row.g === restarted)
    await leave(back)
    return { dead, restarted, tile, restored: got, secondLeft: second.left }
  },
}

const report = { tree: '<worktree of fix/cloud-h2-standby-contain-0.3>', node: process.version, startedAt: new Date().toISOString(), scenarios: {} }
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
  console.log(`${name.padEnd(11)} ${verdict.padEnd(8)} ${Math.round((Date.now() - started) / 1000)}s ${t.checks.filter(c => c.ok).length}/${t.checks.length}${t.checks.filter(c => !c.ok).map(c => ` ✗ ${c.label}`).join('')}${facts?.error ? ` ${facts.error}` : ''}`)
}
report.finishedAt = new Date().toISOString()
const out = arg('out')
if (out) await writeFile(out, JSON.stringify(report, null, 2) + '\n')
process.exit(blocked ? 2 : failed ? 1 : 0)
