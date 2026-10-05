import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { startHealthServer } from './health.js'
import { PresenceMetrics } from './metrics.js'

test('health endpoints expose readiness and aggregate-only metrics', async () => {
  const metrics = new PresenceMetrics()
  metrics.joined('guest'); metrics.rejected('invalid')
  const health = await startHealthServer({ port: 0, metrics, ready: () => true })
  const base = `http://127.0.0.1:${health.port}`
  try {
    assert.equal((await fetch(`${base}/healthz`)).status, 200)
    assert.equal((await fetch(`${base}/readyz`)).status, 200)
    assert.deepEqual(await (await fetch(`${base}/metrics`)).json(), {
      connections: 1, guests: 1, players: 0, rejections: { capacity: 0, invalid: 1, rate: 0, area: 0, replay: 0, sequence: 0, blocked: 0 },
    })
  } finally {
    await health.close()
  }
})

test('health server exposes the build identity and aggregate runtime counters only', async () => {
  const metrics = new PresenceMetrics({ loopDelay: { percentile: () => 2e6, max: 9e6 } })
  metrics.moved(); metrics.changedArea(); metrics.rejected('replay')
  const version = { service: 'pokeswap-presence', commit: 'abc1234', protocol: 2, startedAt: '2026-09-23T00:00:00.000Z' }
  const health = await startHealthServer({ port: 0, metrics, version, ready: () => true })
  const base = `http://127.0.0.1:${health.port}`
  try {
    assert.deepEqual(await (await fetch(`${base}/version`)).json(), version)
    const body = await (await fetch(`${base}/metrics`)).json()
    assert.equal(body.moves, 1)
    assert.equal(body.areaChanges, 1)
    assert.equal(body.rejections.replay, 1)
    assert.deepEqual(body.eventLoopDelayMs, { p50: 2, p99: 2, max: 9 })
    assert.equal(typeof body.memoryMb.rss, 'number')
    assert.doesNotMatch(JSON.stringify(body), /token|username|email|userId/i)
  } finally {
    await health.close()
  }
})

// HEALTH PORT-1: observability can never end the realtime process.
const hold = () => new Promise((resolve, reject) => { const holder = createServer().once('error', reject).listen(0, () => resolve(holder)) })

test('a health port already in use resolves once as unavailable with its code, logged, and never throws', async () => {
  const holder = await hold()
  const port = holder.address().port
  const logs = []
  const uncaught = []
  const onUncaught = error => uncaught.push(error)
  process.on('uncaughtException', onUncaught)
  try {
    const health = await startHealthServer({ port, metrics: new PresenceMetrics(), ready: () => true, log: line => logs.push(line) })
    assert.equal(health.status, 'unavailable')
    assert.equal(health.code, 'EADDRINUSE')
    assert.equal(health.server.listening, false)
    await new Promise(resolve => setTimeout(resolve, 50))
    assert.deepEqual(uncaught, [])
    assert.deepEqual(logs, [`[health] unavailable: could not listen on port ${port} (EADDRINUSE); realtime keeps serving without health endpoints`])
    await health.close()
    await health.close()
    assert.equal(health.status, 'closed')
  } finally {
    process.off('uncaughtException', onUncaught)
    await new Promise(resolve => holder.close(resolve))
  }
})

test('a server error after startup degrades the health endpoint without throwing; close releases the port', async () => {
  const logs = []
  const health = await startHealthServer({ port: 0, metrics: new PresenceMetrics(), ready: () => true, log: line => logs.push(line) })
  assert.equal(health.status, 'listening')
  assert.deepEqual(logs, [`[health] listening on port ${health.port}`])
  health.server.emit('error', Object.assign(new Error('boom'), { code: 'EMFILE' }))
  assert.equal(health.status, 'degraded')
  assert.equal(health.code, 'EMFILE')
  assert.match(logs[1], /\[health\] degraded: .*EMFILE/)
  const port = health.port
  await health.close()
  const again = await startHealthServer({ port, metrics: new PresenceMetrics(), ready: () => true })
  assert.equal(again.status, 'listening', 'the port was released')
  await again.close()
})

test('a failing health handler answers 500 instead of throwing', async () => {
  const logs = []
  const health = await startHealthServer({ port: 0, metrics: { snapshot() { throw new TypeError('broken') } }, ready: () => true, log: line => logs.push(line) })
  try {
    assert.equal((await fetch(`http://127.0.0.1:${health.port}/metrics`)).status, 500)
    assert.equal((await fetch(`http://127.0.0.1:${health.port}/healthz`)).status, 200)
    assert.ok(logs.includes('[health] request failed (TypeError); answering 500'))
  } finally {
    await health.close()
  }
})
