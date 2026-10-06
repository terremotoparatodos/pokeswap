// Local H2 reproduction: real processes, real SDK sockets, real authority handler and SQL.
// No .env copied, no inherited application credentials, no proxy/Cloud/PM2 involved.
// A fixed route is modeled by reconnecting explicitly to A. S receives no new traffic
// until a separate direct-connect check. Natural 15s expiry; real 5s renew/probe timers.
import assert from 'node:assert/strict'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { startLocalAuthority } from './localAuthority.mjs'
import { connect, delay, leave, ORIGIN } from './realtimeProcesses.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const output = new URL('../../docs/design/cloud-h2/evidence/', import.meta.url)
await mkdir(output, { recursive: true })
const report = { base: '886ff4d', node: process.version, startedAt: new Date().toISOString(), scenarios: [] }
const only = process.argv.find(a => a.startsWith('--only='))?.slice(7)
if (only !== undefined && !['on', 'off', 'shadow'].includes(only)) throw new Error('expected --only=on, --only=off or --only=shadow')
async function until(label, predicate, ms = 30000) {
  const deadline = performance.now() + ms
  while (performance.now() < deadline) {
    const answer = await predicate()
    if (answer) return answer
    await delay(100)
  }
  throw new Error(`timeout: ${label}`)
}
async function port() {
  const s = net.createServer()
  await new Promise(resolve => s.listen(0, '127.0.0.1', resolve))
  const p = s.address().port
  await new Promise(resolve => s.close(resolve))
  return p
}
async function start(local, name, mode, recovery, children) {
  const game = await port(), health = await port()
  const env = {}
  for (const key of ['SystemRoot', 'SYSTEMROOT', 'PATH', 'Path', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key]
  Object.assign(env, local.env(mode, name), { PORT: String(game), HEALTH_PORT: String(health), NODE_ENV: 'development', ALLOWED_ORIGINS: ORIGIN, WORLD_PRESENCE_RECOVERY: recovery ? 'on' : '', WORLD_JOIN_ORDER: 'off' })
  const child = spawn(process.execPath, ['--import', new URL('./h2-loopback.mjs', import.meta.url).href, '--import', new URL('./shutdownOnStdin.mjs', import.meta.url).href, fileURLToPath(new URL('../../services/realtime/src/index.js', import.meta.url))], { cwd: root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  const exit = new Promise(resolve => child.once('exit', resolve))
  let log = ''
  child.stdout.on('data', chunk => { log += chunk })
  child.stderr.on('data', chunk => { log += chunk })
  const read = async path => {
    try { const res = await fetch(`http://127.0.0.1:${health}${path}`, { signal: AbortSignal.timeout(1000) }); return { status: res.status, body: await res.json() } }
    catch { return { status: 0, body: null } }
  }
  const server = { name, port: game, child, log: () => log, metrics: async () => (await read('/metrics')).body, ready: async () => (await read('/readyz')).status,
    async kill() { if (child.exitCode === null) child.kill('SIGKILL'); await exit },
  }
  children.push(server)
  await until(`${name} listening`, async () => (await read('/metrics')).status === 200 || child.exitCode !== null)
  assert.equal(child.exitCode, null, log)
  return server
}

for (const [name, mode, recovery, refused] of [
  ['on', 'on', true, false], ['off', 'on', false, false],
  ['shadow', 'shadow', true, true],
]) {
  if (only && only !== name) continue
  const result = { name, mode, recovery, refusedCandidate: refused, checks: [], snapshots: [] }
  report.scenarios.push(result)
  const children = [], sockets = []
  const local = await startLocalAuthority({ secret: randomBytes(24).toString('hex') })
  const hosting = async s => (await s.metrics())?.hosting
  const snap = async (label, S, A, socket) => {
    const snapshot = { label, ms: Math.round(local.now()), hosts: await local.hosts(), processes: [] }
    for (const s of [S, A]) snapshot.processes.push({ name: s.name, pid: s.child.pid, running: s.child.exitCode === null, ready: await s.ready(), hosting: await hosting(s) })
    snapshot.socket = { placed: Boolean(socket.self), left: socket.left, closing: [...socket.closing] }
    result.snapshots.push(snapshot)
  }
  const check = (label, ok) => { result.checks.push({ label, ok: Boolean(ok) }); assert(ok, label) }
  try {
    if (refused) local.rule({ op: 'presence_activate', inst: 'S', mode: 'hold', times: 1 })
    const S = await start(local, 'S', mode, recovery, children)
    if (refused) await until('S activation held', () => local.held() === 1)
    else await until('S ready', async () => (await S.ready()) === 200)
    const A = await start(local, 'A', mode, recovery, children)
    await until('A ready', async () => (await A.ready()) === 200)
    if (refused) {
      const answer = await local.releaseHeld()
      check('late S activation finds newer active A', answer.status === 'newer_active')
    }
    await until('S displaced', async () => (await hosting(S))?.displaced)
    const player = await local.player()
    const socket = await connect(A, player.token, { tabId: 'h2-process-0001' })
    sockets.push(socket)
    check('real socket placed on A', Boolean(socket.self))
    const generation = (await hosting(A)).generation
    await snap('A receives player; S displaced', S, A, socket)
    // No DB timestamp edit here: A renews fail until its real lease naturally expires.
    local.rule({ op: 'presence_renew', inst: 'A', mode: 'fail', times: 1000 })
    await until('A natural lease expiry', async () => !(await local.hosts()).find(h => h.generation === generation)?.live)
    await snap('natural lease expired; A process still running', S, A, socket)
    check('expiry is not process death', A.child.exitCode === null)
    if (recovery) {
      await until('S promoted', async () => (await hosting(S))?.standbyCounters.promotions === 1)
      await snap('S promoted without receiving player traffic', S, A, socket)
    } else {
      await delay(6500)
      check('off: no standby promotion', (await hosting(S)).standbyCounters.promotions === 0)
    }
    local.clearRules('presence_renew')
    if (mode === 'on' && recovery) {
      await until('A socket closed', () => socket.left !== null)
      check('live A displaced and socket closes 4503 draining', socket.left === 4503 && socket.closing.includes('draining'))
      const retry = await connect(A, player.token, { tabId: 'h2-process-0001', resume: true, waitSelf: false })
      sockets.push(retry)
      result.routedRetry = { refused: retry.refused, left: retry.left, placed: Boolean(retry.self) }
      check('fixed route retry to A refused 4503', retry.refused === 4503)
      const direct = await connect(S, (await local.player()).token, { tabId: 'h2-process-0002' })
      sockets.push(direct)
      check('explicit direct connection to S can place player', Boolean(direct.self))
      await delay(6500)
      check('S keeps renewing; A remains unavailable on fixed route', (await S.ready()) === 200 && (await A.ready()) === 503)
    } else if (!recovery) {
      await until('A lease revived', async () => (await local.hosts()).find(h => h.generation === generation)?.live)
      check('off: same generation recovers, original socket intact', (await A.ready()) === 200 && socket.left === null)
    } else {
      await until('A observes newer host', async () => (await hosting(A))?.newerSeen)
      const h = await hosting(A)
      check('shadow: A stays ready and socket intact while paused', (await A.ready()) === 200 && socket.left === null && h.paused)
      const fresh = await connect(A, (await local.player()).token, { tabId: 'h2-process-0002' })
      sockets.push(fresh)
      check('shadow: new player still placed on paused routed A', Boolean(fresh.self))
    }
    await snap('after A renewal resumes', S, A, socket)
    result.verdict = 'PASS'
  } catch (error) { result.verdict = 'FAIL'; result.error = String(error.stack) }
  finally {
    result.events = local.events.map(e => ({ inst: e.inst, op: e.op, tRecv: e.tRecv, tDone: e.tDone, status: e.status, answer: e.answer, rule: e.rule }))
    for (const s of sockets) await leave(s)
    for (const s of children) { await s.kill(); await writeFile(new URL(`process-${name}-${s.name}.log`, output), s.log().replace(/[ \t]+$/gm, '')) }
    await local.close()
  }
  console.log(`${name}: ${result.verdict} (${result.checks.length} checks)${result.error ? ` ${result.error}` : ''}`)
}
report.finishedAt = new Date().toISOString()
await mkdir(output, { recursive: true })
await writeFile(new URL('processes.json', output), JSON.stringify(report, null, 2) + '\n')
process.exitCode = report.scenarios.every(s => s.verdict === 'PASS') ? 0 : 1
