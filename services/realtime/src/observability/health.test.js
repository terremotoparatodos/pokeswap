import test from 'node:test'
import assert from 'node:assert/strict'
import { createHealthServer } from './health.js'
import { PresenceMetrics } from './metrics.js'

test('health endpoints expose readiness and aggregate-only metrics', async () => {
  const metrics = new PresenceMetrics()
  metrics.joined('guest'); metrics.rejected('invalid')
  const server = createHealthServer({ port: 0, metrics, ready: () => true })
  await new Promise(resolve => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    assert.equal((await fetch(`${base}/healthz`)).status, 200)
    assert.equal((await fetch(`${base}/readyz`)).status, 200)
    assert.deepEqual(await (await fetch(`${base}/metrics`)).json(), {
      connections: 1, guests: 1, players: 0, rejections: { capacity: 0, invalid: 1, rate: 0, area: 0, replay: 0 },
    })
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('health server exposes the build identity and aggregate runtime counters only', async () => {
  const metrics = new PresenceMetrics({ loopDelay: { percentile: () => 2e6, max: 9e6 } })
  metrics.moved(); metrics.changedArea(); metrics.rejected('replay')
  const version = { service: 'pokeswap-presence', commit: 'abc1234', protocol: 2, startedAt: '2026-09-23T00:00:00.000Z' }
  const server = createHealthServer({ port: 0, metrics, version, ready: () => true })
  await new Promise(resolve => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
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
    await new Promise(resolve => server.close(resolve))
  }
})
