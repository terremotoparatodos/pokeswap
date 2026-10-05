import test from 'node:test'
import assert from 'node:assert/strict'
import { JoinOrderCapability, RecoveryCapability, withRecovery } from './recoveryCapability.js'
import { RecoveryUnsupported, createEdgePlayerData, readClaimV3 } from '../world/persistence/playerData.js'
import { withPlayerDataMetrics } from '../world/persistence/playerDataMetrics.js'

// CLOUD JOIN-ORDER-2 — the cross-process join-order capability and the claim routing (claim v3 or the
// claim it replaces, with the SAME key). The real handler and SQL path is in rooms/PresenceRoomJoinOrderClaims.test.js.

const USER = '11111111-1111-4111-8111-111111111111'
const KEY = { generation: 3, seq: 7, sessionId: 'c0000000-0000-4000-8000-000000000001', hostId: 'a0000000-0000-4000-8000-000000000001' }
const PAGE = 'tab-page-0001'
const quiet = { log: () => {} }
const answering = answer => ({ capabilities: async () => answer })

test('capability: requested only with WORLD_JOIN_ORDER=on (off otherwise, never probed); enabled only by the authority\'s own marker', async () => {
  let probes = 0
  const off = new JoinOrderCapability({ store: { capabilities: async () => { probes++; return {} } }, requested: false, ...quiet })
  assert.equal(await off.probe(), 'off')
  assert.equal(probes, 0)
  assert.equal(await new JoinOrderCapability({ store: answering({ recovery: null, joinOrder: { version: 1 } }), requested: true, ...quiet }).probe(), 'enabled')
  for (const [answer, reason] of [
    [{ recovery: null, reason: 'edge-v5', joinOrder: null, joinOrderReason: 'edge-v5' }, 'edge-v5'],
    [{ recovery: { version: 1 }, joinOrder: null, joinOrderReason: 'edge-v6' }, 'edge-v6'],
    [{ recovery: { version: 1 }, joinOrder: null, joinOrderReason: 'sql-missing' }, 'sql-missing'],
    [{ recovery: { version: 1 }, joinOrder: { version: 2 } }, 'sql-missing'],
  ]) {
    const c = new JoinOrderCapability({ store: answering(answer), requested: true, ...quiet })
    assert.deepEqual([await c.probe(), c.reason], ['disabled', reason], JSON.stringify(answer))
  }
  // Recovery reads only its own entry from the same answer.
  assert.equal(await new RecoveryCapability({ store: answering({ recovery: { version: 1 }, joinOrder: null }), requested: true, ...quiet }).probe(), 'enabled')
  // A transient failure never changes the state (probed again later).
  const flaky = new JoinOrderCapability({ store: { capabilities: async () => { throw new Error('timeout') } }, requested: true, ...quiet })
  assert.equal(await flaky.probe(), 'unknown')
})

/** A store that records every claim and answers per version. */
function recorder({ v3 = async () => ({ status: 'claimed', epoch: 1 }) } = {}) {
  const calls = []
  return {
    calls,
    locationClaim: async (_u, key) => { calls.push(['v1', key.seq]); return { status: 'claimed', epoch: 1 } },
    locationClaimV2: async (_u, key, options) => { calls.push(['v2', key.seq, options?.takeover === true]); return { status: 'claimed', epoch: 1 } },
    locationClaimV3: async (_u, key, options) => { calls.push(['v3', key.seq, options]); return v3() },
  }
}
const enabled = async (Kind, store) => { const c = new Kind({ store: { capabilities: async () => ({ recovery: { version: 1 }, joinOrder: { version: 1 } }) }, requested: true, ...quiet }); await c.probe(); return c }

test('routing: a session with a page claims through v3 with the rules of the claim it replaces; without a page, exactly as before', async () => {
  for (const withRecoveryRules of [false, true]) {
    const base = recorder()
    const recovery = withRecoveryRules ? await enabled(RecoveryCapability) : new RecoveryCapability({ requested: false, ...quiet })
    const order = await enabled(JoinOrderCapability)
    const store = withRecovery(base, () => recovery, () => order)
    await store.locationClaim(USER, KEY, { page: PAGE, attempt: 4, takeover: true })
    await store.locationClaim(USER, KEY, { takeover: true })
    await store.locationClaim(USER, KEY)
    assert.deepEqual(base.calls, [
      // A takeover travels only with the recovery rules (v1 has none).
      ['v3', 7, { takeover: withRecoveryRules, recovery: withRecoveryRules, page: PAGE, attempt: 4 }],
      withRecoveryRules ? ['v2', 7, true] : ['v1', 7],
      withRecoveryRules ? ['v2', 7, false] : ['v1', 7],
    ])
  }
})

test('routing: v3 refused as unsupported disables the JOIN ORDER only, and the SAME key goes once through v1/v2; any other failure is returned as is (the journal retries the same key)', async () => {
  let v3 = async () => { throw new RecoveryUnsupported('edge-v6') }
  const base = recorder({ v3: () => v3() })
  const recovery = await enabled(RecoveryCapability)
  const order = await enabled(JoinOrderCapability)
  const store = withRecovery(base, () => recovery, () => order)
  assert.equal((await store.locationClaim(USER, KEY, { page: PAGE, attempt: 1 })).status, 'claimed')
  assert.deepEqual([order.state, order.reason, order.counters.fallbacks, recovery.state], ['disabled', 'edge-v6', 1, 'enabled'])
  assert.deepEqual(base.calls.map(c => c.slice(0, 2)), [['v3', 7], ['v2', 7]])
  await store.locationClaim(USER, KEY, { page: PAGE, attempt: 1 })
  assert.deepEqual(base.calls.at(-1).slice(0, 2), ['v2', 7], 'never v3 again in this process')
  const other = await enabled(JoinOrderCapability)
  v3 = async () => { throw new Error('world-authority location_claim_v3 503') }
  const transient = withRecovery(recorder({ v3: () => v3() }), () => recovery, () => other)
  await assert.rejects(transient.locationClaim(USER, KEY, { page: PAGE, attempt: 1 }), /503/)
  assert.equal(other.state, 'enabled', 'a transient failure never disables it')
})

test('answers: stale_attempt / duplicate_attempt are read as such; anything else follows claim v2', () => {
  assert.deepEqual(readClaimV3({ status: 'stale_attempt', newerActive: true }), { status: 'stale_attempt', newerActive: true })
  assert.deepEqual(readClaimV3('{"status":"duplicate_attempt"}'), { status: 'duplicate_attempt', newerActive: false })
  assert.deepEqual(readClaimV3({ status: 'owner_draining' }), { status: 'owner_draining', newerActive: false })
  assert.throws(() => readClaimV3({ status: 'taken_by_attempt' }), /malformed/)
})

test('Edge adapter: the exact v7 body; 400 unknown_op (a v5/v6 function) and 501 are RecoveryUnsupported; a malformed order never leaves the process', async () => {
  let reply = { status: 200, body: { claim: { status: 'stale_attempt', newerActive: false } } }
  const sent = []
  const fetcher = async (_url, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify(reply.body), { status: reply.status }) }
  const edge = createEdgePlayerData({ url: 'https://local/wa', secret: 's'.repeat(48), publishableKey: 'anon', fetcher })
  assert.deepEqual(await edge.locationClaimV3(USER, KEY, { takeover: true, recovery: true, page: PAGE, attempt: 3 }), { status: 'stale_attempt', newerActive: false })
  assert.deepEqual(sent.at(-1), { op: 'location_claim_v3', userId: USER, ...KEY, takeover: true, recovery: true, page: PAGE, attempt: 3 })
  await edge.locationClaimV3(USER, KEY, { takeover: true, recovery: false, page: PAGE, attempt: 3 })
  assert.equal(sent.at(-1).takeover, false, 'no takeover without the recovery rules')
  reply = { status: 400, body: { error: 'unknown_op' } }
  await assert.rejects(edge.locationClaimV3(USER, KEY, { page: PAGE, attempt: 1 }), error => error instanceof RecoveryUnsupported && error.reason === 'edge-v6')
  reply = { status: 501, body: { error: 'unsupported' } }
  await assert.rejects(edge.locationClaimV3(USER, KEY, { page: PAGE, attempt: 1 }), error => error instanceof RecoveryUnsupported && error.reason === 'sql-missing')
  reply = { status: 400, body: { error: 'invalid_attempt' } }
  await assert.rejects(edge.locationClaimV3(USER, KEY, { page: PAGE, attempt: 1 }), error => !(error instanceof RecoveryUnsupported))
  const before = sent.length
  for (const options of [{ page: '<b>', attempt: 1 }, { page: PAGE, attempt: 0 }, { page: PAGE, attempt: 1.5 }, { page: PAGE }, {}]) {
    await assert.rejects(edge.locationClaimV3(USER, KEY, options), /invalid join order/, JSON.stringify(options))
  }
  assert.equal(sent.length, before)
})

test('metrics decorator: locationClaimV3 passes through (answers and RecoveryUnsupported alike); absent stays absent', async () => {
  const full = withPlayerDataMetrics({ locationClaimV3: async () => { throw new RecoveryUnsupported('edge-v6') } })
  await assert.rejects(full.locationClaimV3(USER, KEY, { page: PAGE, attempt: 1 }), RecoveryUnsupported)
  assert.equal(full.metrics().locationClaimV3.failures, 1)
  assert.equal(withPlayerDataMetrics({ locationClaim: async () => ({}) }).locationClaimV3, undefined)
})
