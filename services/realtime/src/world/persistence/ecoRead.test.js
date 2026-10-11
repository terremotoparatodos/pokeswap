import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEdgePlayerData } from './playerData.js'
import { withPlayerDataMetrics } from './playerDataMetrics.js'

const user = '11111111-1111-4111-8111-111111111111'
test('ECO read sends only authenticated server identity and selected slot through the existing boundary', async () => {
  const bodies = []
  const data = withPlayerDataMetrics(createEdgePlayerData({ url: 'http://test.invalid', secret: 'test-only', publishableKey: 'test-only', fetcher: async (_url, request) => {
    bodies.push(JSON.parse(request.body))
    return { ok: true, json: async () => ({ rows: [] }) }
  } }))
  await data.readEcoCombatants(user)
  await data.readEcoCombatants(user, 25)
  assert.deepEqual(bodies, [{ op: 'eco_combatants', userId: user, slotPokemonId: null }, { op: 'eco_combatants', userId: user, slotPokemonId: 25 }])
  await assert.rejects(data.readEcoCombatants('benchmark-a', 25))
  await assert.rejects(data.readEcoCombatants(user, 0))
  assert.equal(bodies.length, 2)
  assert.equal(data.metrics().readEcoCombatants.calls, 4)
})

test('ECO read malformed replies and timeouts fail closed', async () => {
  const options = { url: 'http://test.invalid', secret: 'test-only', publishableKey: 'test-only' }
  await assert.rejects(createEdgePlayerData({ ...options, fetcher: async () => ({ ok: true, json: async () => ({ rows: null }) }) }).readEcoCombatants(user))
  await assert.rejects(createEdgePlayerData({ ...options, timeoutMs: 5, fetcher: (_url, { signal }) => new Promise((_, reject) => {
    const keeper = setTimeout(() => reject(new Error('timeout did not abort')), 100)
    signal.addEventListener('abort', () => { clearTimeout(keeper); reject(new Error('aborted')) })
  }) }).readEcoCombatants(user))
})
