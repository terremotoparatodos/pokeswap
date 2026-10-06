// CLOUD D5/D8 — local, isolated reproductions with REAL realtime processes (services/realtime/src/index.js,
// development mode), REAL @colyseus/sdk sockets and the REAL world-authority handler over embedded Postgres with
// every migration (scripts/world-location/localAuthority.mjs). Loopback only (h2-loopback.mjs), synthetic users
// and secrets, no inherited application variables, standby OFF (the H2 containment default), join order off.
// The "route" is the harness choosing which process a client dials: there is no NGINX, Colyseus agent or PM2 here.
// Timers are the production ones (lease 15 s, renew 5 s). Every wait is bounded; a wait that runs out is BLOCKED.
//
//   node docs/design/cloud-d5-d8/repro/d5-d8-processes.mjs [--only D5A_SWITCH,...] [--out report.json]
//
// Each scenario records, separately: process state (alive, /readyz), authority (host rows: state + live lease),
// traffic destination (the process the harness dials) and existing sessions (placed / closed code).

import net from 'node:net'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { startLocalAuthority } from '../../../../scripts/world-location/localAuthority.mjs'
import { connect, delay, leave, nudge, ORIGIN } from '../../../../scripts/world-location/realtimeProcesses.mjs'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const scripts = new URL('../../../../scripts/world-location/', import.meta.url)
const { openDirection } = await import(new URL('../../../../services/realtime/src/world/testing.js', import.meta.url).href)
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

/** One authority (one database) and the processes started against it. */
async function authority(t) {
  const local = await startLocalAuthority({ secret: randomBytes(24).toString('hex') })
  const children = []
  t.cleanup.push(async () => { for (const c of children) await c.kill(); await local.close() })
  async function start(name, { mode = 'on' } = {}) {
    const game = await freePort(), health = await freePort()
    const env = {}
    for (const key of ['SystemRoot', 'SYSTEMROOT', 'PATH', 'Path', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key]
    Object.assign(env, local.env(mode, name), {
      PORT: String(game), HEALTH_PORT: String(health), NODE_ENV: 'development', ALLOWED_ORIGINS: ORIGIN,
      WORLD_PRESENCE_RECOVERY: '', WORLD_PRESENCE_STANDBY: '', WORLD_JOIN_ORDER: 'off',
    })
    const child = spawn(process.execPath, ['--import', new URL('h2-loopback.mjs', scripts).href, '--import', new URL('shutdownOnStdin.mjs', scripts).href,
      fileURLToPath(new URL('../../../../services/realtime/src/index.js', import.meta.url))], { cwd: root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const exit = new Promise(resolve => child.once('exit', resolve))
    let log = ''
    child.stdout.on('data', chunk => { log += chunk })
    child.stderr.on('data', chunk => { log += chunk })
    const read = async path => {
      try { const res = await fetch(`http://127.0.0.1:${health}${path}`, { signal: AbortSignal.timeout(1000) }); return { status: res.status, body: await res.json() } } catch { return { status: 0, body: null } }
    }
    const server = {
      name, mode, port: game, child, log: () => log,
      ready: async () => (await read('/readyz')).status,
      hosting: async () => (await read('/metrics')).body?.hosting ?? null,
      alive: () => child.exitCode === null && !child.killed,
      async kill() { if (child.exitCode === null) child.kill('SIGKILL'); await exit },
    }
    children.push(server)
    await until(`${name} listening`, async () => (await read('/metrics')).status === 200 || child.exitCode !== null)
    if (child.exitCode !== null) throw new Blocked(`${name} exited: ${log.slice(-300)}`)
    return server
  }
  const hosts = async () => (await local.hosts()).map(h => ({ generation: h.generation, state: h.state, live: h.live }))
  return { local, start, hosts, started: performance.now() }
}

/** The four views at one instant (process, authority, traffic, sessions). */
async function view(a, label, procs, { route, sessions = {} } = {}) {
  const processes = {}
  for (const p of procs) {
    const h = await p.hosting()
    processes[p.name] = { mode: p.mode, alive: p.alive(), readyz: await p.ready(), host: h && { generation: h.generation, state: h.state, displaced: h.displaced ?? null, identityResets: h.identityResets } }
  }
  const s = {}
  for (const [name, socket] of Object.entries(sessions)) s[name] = { placed: Boolean(socket.self), closedWith: socket.left, closing: [...socket.closing], refused: socket.refused }
  return { label, ms: Math.round(a.local.now()), processes, authority: await a.hosts(), traffic: route ?? null, sessions: s }
}

/** A routed host A in `on` with one player P that moved (its tile saved by an urgent disconnect, then reconnected). */
async function routedA(t, a) {
  const A = await a.start('A')
  await until('A ready', async () => (await A.ready()) === 200)
  const player = await a.local.player()
  const first = await connect(A, player.token, { tabId: 'd5d8-page-0001' })
  await nudge(first, openDirection)
  const tile = { areaId: first.self.areaId, tx: first.self.tx, ty: first.self.ty }
  await leave(first)
  await until('the tile persisted', async () => {
    const { rows } = await a.local.query('SELECT area_id, tx, ty FROM public.world_player_locations WHERE user_id = $1', [player.userId])
    return rows[0] && rows[0].area_id === tile.areaId && rows[0].tx === tile.tx && rows[0].ty === tile.ty
  }, 10_000)
  const P = await connect(A, player.token, { tabId: 'd5d8-page-0001', resume: true })
  t.check('P placed on the routed A at its saved tile', Boolean(P.self) && P.self.tx === tile.tx && P.self.ty === tile.ty)
  return { A, player, tile, P }
}

/** Dials `server` as P would after a close; returns { placed, refused, left }. */
async function redial(server, player) {
  const s = await connect(server, player.token, { tabId: 'd5d8-page-0001', resume: true, waitSelf: false })
  await until('the redial settles', () => s.self || s.left !== null || s.refused !== null, 10_000).catch(() => null)
  const outcome = { placed: Boolean(s.self), refused: s.refused, left: s.left, tile: s.self && { tx: s.self.tx, ty: s.self.ty } }
  await leave(s)
  return outcome
}

const SCENARIOS = {
  /** D5(a): a deploy candidate C activates authority before any traffic reaches it; the route then switches to C (transient). */
  async D5A_SWITCH(t) {
    const a = await authority(t)
    const { A, player, tile, P } = await routedA(t, a)
    const timeline = [await view(a, 'A routed, P placed', [A], { route: 'A', sessions: { P } })]
    const C = await a.start('C')
    await until('C active', async () => (await C.hosting())?.state === 'active')
    timeline.push(await view(a, 'C active (no traffic yet)', [A, C], { route: 'A', sessions: { P } }))
    const tC = a.local.now()
    await until('A displaced', async () => (await A.hosting())?.displaced, 15_000)
    await until('P closed', () => P.left !== null, 10_000)
    const tClosed = a.local.now()
    timeline.push(await view(a, 'A displaced; P closed; route still A', [A, C], { route: 'A', sessions: { P } }))
    const stillA = await redial(A, player)
    await delay(3_000)                                          // the route switch the agent would make
    const onC = await redial(C, player)
    const tPlaced = a.local.now()
    timeline.push(await view(a, 'route switched to C; P placed on C', [A, C], { route: 'C' }))
    t.check('C activated with NO traffic and A was displaced by it (newest generation wins)', (await C.hosting()).generation > (await A.hosting()).generation && (await A.hosting()).displaced)
    t.check('P (existing session on A) closed with 4503 draining', P.left === 4503 && P.closing.includes('draining'))
    t.check('while the route stays on A, a redial is refused 4503 (A alive, /readyz 503)', stillA.refused === 4503 && A.alive() && (await A.ready()) === 503)
    t.check('after the route moves to C, P is placed on C at its saved tile (transient outage only)', onC.placed && onC.tile?.tx === tile.tx && onC.tile?.ty === tile.ty)
    return { timeline, stillA, onC, msActivateToClose: Math.round(tClosed - tC), msCloseToPlaced: Math.round(tPlaced - tClosed) }
  },

  /** D5(a): the same, but the deploy is aborted after C activated (C dies before any switch): nothing recovers on its own. */
  async D5A_ABORT(t) {
    const a = await authority(t)
    const { A, player, P } = await routedA(t, a)
    const C = await a.start('C')
    await until('C active', async () => (await C.hosting())?.state === 'active')
    await until('A displaced', async () => (await A.hosting())?.displaced, 15_000)
    await until('P closed', () => P.left !== null, 10_000)
    const generationC = (await C.hosting()).generation
    await C.kill()                                               // deploy aborted: the candidate is gone, the route never moved
    const tKilled = a.local.now()
    const timeline = [await view(a, 'C killed right after it displaced A', [A], { route: 'A', sessions: { P } })]
    await until('C lease ran out', async () => !(await a.hosts()).find(h => h.generation === generationC)?.live, 30_000)
    await delay(10_000)                                          // two more renew periods: nothing changes on its own
    const later = await view(a, 'C lease expired + 10 s', [A], { route: 'A' })
    timeline.push(later)
    const redialA = await redial(A, player)
    const liveHosts = (await a.hosts()).filter(h => h.state === 'active' && h.live)
    t.check('no live active host remains (A displaced/stopped, C dead) — no automatic recovery', liveHosts.length === 0)
    t.check('A is alive but refuses: /readyz 503, redial 4503 (route still A)', A.alive() && (await A.ready()) === 503 && redialA.refused === 4503)
    // External intervention (what a supervisor/agent/operator would do): a NEW process on the route.
    const A2 = await a.start('A2')
    await until('A2 ready', async () => (await A2.ready()) === 200)
    const onA2 = await redial(A2, player)
    t.check('only an external restart recovers the service (new process, new generation)', onA2.placed)
    return { timeline, msWithoutHost: Math.round(a.local.now() - tKilled), redialA, onA2 }
  },

  /** D5(b): a starting candidate whose starting lease runs out (slow activation) takes a NEW identity and displaces the routed host. */
  async D5B_EXPIRED_STARTING(t) {
    const a = await authority(t)
    const { A, P } = await routedA(t, a)
    // Every ACTIVATION and RENEWAL of C fails in transport from its boot (its acquire succeeds): C stays 'starting' while its
    // 15 s starting lease runs out. Weaker faults are not enough (observed preparing this scenario; see the report): a single
    // slow activation is retried with the same identity at 6 s, and with only activations failing, the starting host's own
    // renewals keep its lease alive.
    a.local.rule({ op: 'presence_activate', inst: 'C', mode: 'fail', times: 100_000 })
    a.local.rule({ op: 'presence_renew', inst: 'C', mode: 'fail', times: 100_000 })
    const C = await a.start('C')
    const first = await until('C acquired', async () => (await C.hosting())?.generation, 15_000)
    const timeline = [await view(a, 'C acquired (starting), activation delayed', [A, C], { route: 'A', sessions: { P } })]
    await until('C starting lease expired', async () => !(await a.hosts()).find(h => h.generation === first)?.live, 30_000)
    a.local.clearRules('presence_activate'); a.local.clearRules('presence_renew')   // C reaches the authority again
    const resetC = await until('C took a new identity and activated', async () => { const h = await C.hosting(); return h?.state === 'active' && h.identityResets >= 1 ? h : null }, 45_000)
    await until('A displaced', async () => (await A.hosting())?.displaced, 15_000)
    await until('P closed', () => P.left !== null, 10_000)
    timeline.push(await view(a, 'C active with a NEW generation; A displaced', [A, C], { route: 'A', sessions: { P } }))
    const answers = a.local.events.filter(e => e.inst === 'C' && e.op.startsWith('presence_')).map(e => `${e.op}:${e.answer?.status ?? e.status}`)
    const firstAfter = answers.find(x => /:(host_expired|active|ok)$/.test(x))
    t.check('the first answer C got after the outage was host_expired (its starting lease ran out)', /:host_expired$/.test(firstAfter ?? ''))
    t.check('C re-acquired a NEWER generation (identity reset) and activated it', resetC.generation > first && resetC.identityResets >= 1)
    t.check('the routed A was displaced and P closed 4503 — with no traffic ever reaching C', (await A.hosting()).displaced && P.left === 4503)
    return { timeline, firstGeneration: first, newGeneration: resetC.generation, answers }
  },

  /** D8: a SHADOW process started after an `on` process on the SAME authority displaces it (normal activation). */
  async D8_SHADOW_AFTER_ON(t) {
    const a = await authority(t)
    const { A, P } = await routedA(t, a)
    const S = await a.start('S', { mode: 'shadow' })
    await until('S active', async () => (await S.hosting())?.state === 'active')
    await until('A displaced', async () => (await A.hosting())?.displaced, 15_000)
    await until('P closed', () => P.left !== null, 10_000)
    const timeline = [await view(a, 'shadow S started after on A', [A, S], { route: 'A', sessions: { P } })]
    t.check('the shadow process acquired and ACTIVATED a real host row (newer generation)', (await S.hosting()).generation > (await A.hosting()).generation)
    t.check('the on process A was displaced and its player closed 4503 — by a shadow process', (await A.hosting()).displaced && P.left === 4503 && (await A.ready()) === 503)
    t.check('the shadow process keeps reporting ready (200): it does not know it took authority from on', (await S.ready()) === 200)
    return { timeline }
  },

  /** D8: rows written by a SHADOW fleet are restored by an `on` fleet sharing the authority (cross-fleet data). */
  async D8_SHADOW_WRITES_SHARED_ROW(t) {
    const a = await authority(t)
    const S = await a.start('S', { mode: 'shadow' })
    await until('S ready', async () => (await S.ready()) === 200)
    const player = await a.local.player()
    const onS = await connect(S, player.token, { tabId: 'd5d8-shadow-0001' })
    await nudge(onS, openDirection); await nudge(onS, openDirection)
    const shadowTile = { tx: onS.self.tx, ty: onS.self.ty }
    await leave(onS)
    await until('the shadow fleet persisted the tile', async () => {
      const { rows } = await a.local.query('SELECT tx, ty FROM public.world_player_locations WHERE user_id = $1', [player.userId])
      return rows[0] && rows[0].tx === shadowTile.tx && rows[0].ty === shadowTile.ty
    }, 10_000)
    const generationS = (await S.hosting()).generation
    const shadowRow = (await a.local.query('SELECT owner_generation::int AS g, tx, ty FROM public.world_player_locations WHERE user_id = $1', [player.userId])).rows[0]
    await S.kill()                                               // the shadow fleet goes away; its row stays
    const A = await a.start('A')
    await until('A ready', async () => (await A.ready()) === 200)
    const onA = await connect(A, player.token, { tabId: 'd5d8-on-0001' })
    const restored = onA.self && { tx: onA.self.tx, ty: onA.self.ty }
    await leave(onA)
    t.check('the shadow process CLAIMED and SAVED the player row in the shared table (owner = its generation)', shadowRow?.g === generationS && shadowRow.tx === shadowTile.tx && shadowRow.ty === shadowTile.ty)
    t.check('the on process RESTORED the tile the shadow fleet wrote', restored?.tx === shadowTile.tx && restored?.ty === shadowTile.ty)
    return { shadowTile, shadowRow, generationS, restoredOnOn: restored }
  },

  /** D8 control: the same shadow-after-on start, but against a SEPARATE authority (another database): no interaction. */
  async D8_SEPARATE_AUTHORITY(t) {
    const a1 = await authority(t)
    const a2 = await authority(t)
    const { A, P } = await routedA(t, a1)
    const S = await a2.start('S', { mode: 'shadow' })
    await until('S active on its own authority', async () => (await S.hosting())?.state === 'active')
    await delay(12_000)                                          // > two renew periods of A
    const moved = await nudge(P, openDirection)
    t.check('A stays active and never hears of S (separate authority)', !(await A.hosting()).displaced && (await A.ready()) === 200)
    t.check('P stays connected and keeps moving', P.left === null && moved)
    await leave(P)
    return { a1Hosts: await a1.hosts(), a2Hosts: await a2.hosts() }
  },
}

const report = { tree: '<worktree of design/cloud-d5-d8-0.3>', node: process.version, startedAt: new Date().toISOString(), scenarios: {} }
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
  console.log(`${name.padEnd(28)} ${verdict.padEnd(8)} ${Math.round((Date.now() - started) / 1000)}s ${t.checks.filter(c => c.ok).length}/${t.checks.length}${t.checks.filter(c => !c.ok).map(c => ` ✗ ${c.label}`).join('')}${facts?.error ? ` ${facts.error}` : ''}`)
}
report.finishedAt = new Date().toISOString()
const out = arg('out')
if (out) await writeFile(out, JSON.stringify(report, null, 2) + '\n')
process.exit(blocked ? 2 : failed ? 1 : 0)
