import test from 'node:test'
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'

// HEALTH PORT-1 (docs/design/world-location-4/evidence/6-cloud-topology.md §4.3): during every
// Colyseus Cloud rollout PM2 runs the old and the new process of the same app at once, in slots
// NODE_APP_INSTANCE 0 and 1, with the same environment. Before this fix both bound the same
// health port; the new one died with EADDRINUSE right AFTER activating its host, and PM2
// restarted it 4–5 times per deploy. These tests run real processes (realtimeProcess.fixture.js).

const FIXTURE = fileURLToPath(new URL('./realtimeProcess.fixture.js', import.meta.url))
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
let nextPort = 3000 + Math.floor(Math.random() * 400) * 10
const ports = count => { const first = nextPort; nextPort += count; return first }

function spawnProcess(env) {
  // Never inherit a real Cloud slot (Cloud's build runs `npm test` on the production machine):
  // the fixture opts into the Cloud health-port rule only through FIXTURE_CLOUD.
  const childEnv = { ...process.env, ...env }
  delete childEnv.COLYSEUS_CLOUD
  if (!('NODE_APP_INSTANCE' in env)) delete childEnv.NODE_APP_INSTANCE
  const child = fork(FIXTURE, [], { env: childEnv, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
  const events = []
  let exited = null
  child.on('message', message => events.push(message))
  child.on('exit', code => { exited = { code } })
  return {
    events,
    get exited() { return exited },
    logs: () => events.filter(m => m.event === 'log').map(m => m.line),
    steps: () => events.filter(m => ['health', 'acquired', 'listening', 'activated', 'interrupted'].includes(m.event)).map(m => `${m.event}:${m.state}`),
    async until(predicate, timeoutMs = 30_000) {
      for (let waited = 0; waited < timeoutMs; waited += 25) {
        const found = events.find(predicate)
        if (found) return found
        if (exited) return null
        await wait(25)
      }
      return null
    },
    async exit(timeoutMs = 10_000) {
      for (let waited = 0; waited < timeoutMs && !exited; waited += 25) await wait(25)
      return exited
    },
    async stop() {
      if (exited) return exited
      child.send('shutdown')
      if (!await this.exit()) child.kill()
      return this.exit()
    },
  }
}

const canBind = port => new Promise(resolve => {
  const probe = createServer().once('error', () => resolve(false)).listen(port, () => probe.close(() => resolve(true)))
})
const hold = port => new Promise((resolve, reject) => {
  const holder = createServer().once('error', reject).listen(port, () => resolve(holder))
})

test('rollout: the old (slot 0) and new (slot 1) Cloud processes both survive on their own health ports, then release every socket', async () => {
  const base = ports(4)
  // Same environment for both, as on Cloud (HEALTH_PORT is the base there; unset on Cloud it is
  // 2568). Each gets its own game port only because there is no per-slot Cloud socket locally.
  const shared = { FIXTURE_CLOUD: '1', HEALTH_PORT: String(base + 2) }
  // As in a rollout: the old process is up and serving before PM2 starts the new one.
  const old = spawnProcess({ ...shared, PORT: String(base), NODE_APP_INSTANCE: '0' })
  let fresh = null
  try {
    const oldStarted = await old.until(m => m.event === 'started')
    assert.ok(oldStarted, `the old process starts (steps ${old.steps()}, exit ${JSON.stringify(old.exited)})`)
    assert.equal(oldStarted.hostState, 'active')

    fresh = spawnProcess({ ...shared, PORT: String(base + 1), NODE_APP_INSTANCE: '1' })
    const freshStarted = await fresh.until(m => m.event === 'started')
    assert.ok(fresh.steps().includes('activated:active'), `the new process activated its host (steps ${fresh.steps()})`)
    assert.equal(fresh.exited, null, `the new process survives while the old one still holds its health port (steps ${fresh.steps()})`)
    assert.ok(freshStarted, 'the new process finishes its bootstrap')
    assert.equal(freshStarted.hostState, 'active')
    assert.equal(oldStarted.healthPort, base + 2, 'slot 0 takes the base port')
    assert.equal(freshStarted.healthPort, base + 3, 'slot 1 takes base + 1')

    for (const started of [oldStarted, freshStarted]) {
      assert.equal((await fetch(`http://127.0.0.1:${started.healthPort}/healthz`)).status, 200)
      assert.equal((await fetch(`http://127.0.0.1:${started.healthPort}/readyz`)).status, 200)
    }
    for (const gamePort of [base, base + 1]) assert.equal((await fetch(`http://127.0.0.1:${gamePort}/version`)).status, 200)
    await wait(500)
    assert.equal(old.exited, null)
    assert.equal(fresh.exited, null, 'still alive after the bind window')
    for (const process of [old, fresh]) assert.equal(process.logs().filter(line => line.startsWith('[health] unavailable')).length, 0)
  } finally {
    await Promise.all([old.stop(), fresh?.stop()])
  }
  assert.deepEqual([old.exited, fresh.exited], [{ code: 0 }, { code: 0 }], 'a graceful shutdown exits 0')
  for (const port of [base, base + 1, base + 2, base + 3]) assert.ok(await canBind(port), `port ${port} released`)
})

test('a health port taken by a third party: the process stays up, says why, and keeps its one host identity', async () => {
  const base = ports(2)
  const holder = await hold(base + 1)
  const process = spawnProcess({ PORT: String(base) })
  try {
    const started = await process.until(m => m.event === 'started')
    assert.ok(started, `the process finishes its bootstrap (steps ${process.steps()}, exit ${JSON.stringify(process.exited)})`)
    assert.equal(started.healthStatus, 'unavailable')
    assert.equal(started.healthPort, null)
    assert.equal(started.hostState, 'active')
    assert.deepEqual(process.steps(), ['health:unavailable', 'acquired:starting', 'listening:starting', 'activated:active'])
    const logs = process.logs()
    assert.ok(logs.some(line => line.includes('[health] unavailable') && line.includes(`port ${base + 1}`) && line.includes('EADDRINUSE')), 'the degraded state and its code are logged')
    assert.ok(!logs.some(line => line.includes('[health] listening')), 'never announces a listening health endpoint')

    await wait(1_000)
    assert.equal(process.exited, null, 'no crash, so no PM2 restart')
    const alive = process.events.filter(m => m.event === 'alive')
    assert.ok(alive.length >= 5)
    assert.ok(alive.every(m => m.hostState === 'active' && m.generation === started.generation), 'the same generation, still active')
    assert.equal(process.steps().filter(step => step.startsWith('acquired')).length, 1, 'acquired exactly once')
    assert.equal((await fetch(`http://127.0.0.1:${base}/version`)).status, 200, 'the game port still serves')
  } finally {
    await process.stop()
    await new Promise(resolve => holder.close(resolve))
  }
  assert.deepEqual(process.exited, { code: 0 })
  assert.ok(await canBind(base), 'game port released')
})

test('a shutdown during the health bind ends the bootstrap there: no acquire, listen or activate', async () => {
  const base = ports(2)
  const process = spawnProcess({ PORT: String(base), FIXTURE_SIGINT_AT: 'health' })
  try {
    assert.ok(await process.exit(30_000), 'the process exits')
    assert.deepEqual(process.steps(), ['health:listening', 'interrupted:health'])
    assert.equal(process.exited.code, 0, 'a graceful exit')
  } finally {
    await process.stop()
  }
  for (const port of [base, base + 1]) assert.ok(await canBind(port), `port ${port} released`)
})

test('a shutdown during acquire stops the host it got and never listens nor activates', async () => {
  const base = ports(2)
  const process = spawnProcess({ PORT: String(base), FIXTURE_SIGINT_AT: 'acquired' })
  try {
    assert.ok(await process.exit(30_000), 'the process exits')
    assert.deepEqual(process.steps(), ['health:listening', 'acquired:starting', 'interrupted:acquired'])
    assert.equal(process.exited.code, 0)
  } finally {
    await process.stop()
  }
  for (const port of [base, base + 1]) assert.ok(await canBind(port), `port ${port} released`)
})

test('a malformed NODE_APP_INSTANCE on Cloud is a configuration error before anything is bound or acquired', async () => {
  const base = ports(2)
  const process = spawnProcess({ PORT: String(base), FIXTURE_CLOUD: '1', NODE_APP_INSTANCE: 'one' })
  try {
    assert.ok(await process.exit(30_000), 'the process exits')
    assert.notEqual(process.exited.code, 0)
    assert.deepEqual(process.steps(), [], 'no health bind, no acquire')
  } finally {
    await process.stop()
  }
  assert.ok(await canBind(base + 1))
})
