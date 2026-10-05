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

test('CLOUD READINESS-3: the presence-recovery operations pass through (results and RecoveryUnsupported alike); absent ones stay absent', async () => {
  const { RecoveryUnsupported } = await import('./playerData.js')
  const full = withPlayerDataMetrics({
    capabilities: async () => ({ recovery: { version: 1 } }),
    locationClaimV2: async (_user, _key, options) => ({ status: 'claimed', takeover: options?.takeover === true }),
    presenceActivateExclusive: async () => { throw new RecoveryUnsupported('edge-v5') },
    presenceAnyActive: async () => false,
  })
  assert.deepEqual(await full.capabilities(), { recovery: { version: 1 } })
  assert.deepEqual(await full.locationClaimV2('u', {}, { takeover: true }), { status: 'claimed', takeover: true })
  await assert.rejects(full.presenceActivateExclusive(1, 'h', 15000), RecoveryUnsupported)
  assert.equal(await full.presenceAnyActive(), false)
  assert.equal(full.metrics().presenceActivateExclusive.failures, 1)
  const partial = withPlayerDataMetrics({ locationClaim: async () => ({ status: 'claimed' }) })
  assert.equal(partial.capabilities, undefined)
  assert.equal(partial.locationClaimV2, undefined)
})
