import assert from 'node:assert/strict'
import { test } from 'node:test'
import { withPlayerDataMetrics } from './playerDataMetrics.js'

test('counts calls and failures per operation and passes results and errors through', async () => {
  const data = withPlayerDataMetrics({
    async playerState() { return { xp: {}, materials: {}, pokemon: [] } },
    async ownsPokemon(userId, instanceId) { return instanceId === 7 ? { instanceId, speciesId: 7 } : null },
    async commitWork() { throw new Error('db down') },
    async loadNodes() { return [] },
  })
  assert.deepEqual(await data.ownsPokemon('u', 7), { instanceId: 7, speciesId: 7 })
  assert.equal(await data.ownsPokemon('u', 8), null)
  await assert.rejects(data.commitWork({}), /db down/)
  const metrics = data.metrics()
  assert.equal(metrics.ownsPokemon.calls, 2)
  assert.equal(metrics.ownsPokemon.failures, 0)
  assert.equal(metrics.commitWork.calls, 1)
  assert.equal(metrics.commitWork.failures, 1)
  assert.equal(metrics.playerState.calls, 0)
  assert.equal(metrics.loadNodes.ms.p50, 0)
})

test('exposes aggregates only: no user id or payload reaches the metrics', async () => {
  const data = withPlayerDataMetrics({
    async playerState() { return {} }, async ownsPokemon() { return null }, async commitWork() { return {} }, async loadNodes() { return [] },
  })
  await data.playerState('11111111-2222-3333-4444-555555555555')
  await data.commitWork({ actionId: 'secret-action', playerId: 'someone' })
  const text = JSON.stringify(data.metrics())
  assert.doesNotMatch(text, /1111|secret-action|someone/)
})
