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
      connections: 1, guests: 1, players: 0, rejections: { capacity: 0, invalid: 1, rate: 0, area: 0 },
    })
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})
