import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { RecoveryCapability, recoveryRequested, withRecovery } from './recoveryCapability.js'
import { RecoveryUnsupported, createEdgePlayerData, createSqlPlayerData } from '../world/persistence/playerData.js'
import { openLocalDatabase, serviceQuery } from '../world/persistence/dev/localDatabase.js'
import { HostLifecycle } from './hostLifecycle.js'

// CLOUD READINESS-3 — the capability contract on the realtime side: kill switch, one probe per
// process, permanent disable on "unsupported", no downgrade on transient failures, and the v1
// fallback of a claim (same key, once). Plus the production path end to end (Edge adapter → the
// REAL world-authority v6 handler → the real SQL on PGlite), including the SQL disappearing under a
// live process. A v5 Edge Function is modelled by its documented answer (400 unknown_op), which the
// handler's own Deno tests prove against the v5 code.

const KEY = { generation: 7, seq: 3, sessionId: 'c0000000-0000-4000-8000-000000000001', hostId: 'a0000000-0000-4000-8000-000000000001' }
const USER = '11111111-1111-4111-8111-111111111111'
const quiet = { log: () => {} }

test('kill switch: only WORLD_PRESENCE_RECOVERY=on requests recovery; off never probes', async () => {
  assert.equal(recoveryRequested({ WORLD_PRESENCE_RECOVERY: 'on' }), true)
  for (const value of [undefined, '', 'true', '1', 'ON', 'yes', 'shadow']) assert.equal(recoveryRequested({ WORLD_PRESENCE_RECOVERY: value }), false, String(value))
  let probes = 0
  const off = new RecoveryCapability({ store: { capabilities: async () => { probes++; return { recovery: { version: 1 } } } }, requested: false, ...quiet })
  assert.deepEqual([await off.probe(), off.reason, probes, off.enabled], ['off', 'kill-switch', 0, false])
})

test('probe: one in flight; enabled only on recovery v1; a store without the op or the SQL is disabled', async () => {
  let calls = 0
  let answer
  const store = { capabilities: () => { calls++; return new Promise(resolve => { answer = resolve }) } }
  const c = new RecoveryCapability({ store, requested: true, ...quiet })
  const a = c.probe(); const b = c.probe()
  answer({ recovery: { version: 1 } })
  assert.deepEqual([await a, await b, calls], ['enabled', 'enabled', 1])
  assert.equal((await new RecoveryCapability({ store: {}, requested: true, ...quiet }).probe()), 'disabled')
  const missing = new RecoveryCapability({ store: { capabilities: async () => ({ recovery: null, reason: 'edge-v5' }) }, requested: true, ...quiet })
  assert.deepEqual([await missing.probe(), missing.reason], ['disabled', 'edge-v5'])
})

test('a transient probe failure stays unknown (never a downgrade) and is probed again only after retryMs', async () => {
  let now = 0
  let fail = true
  let calls = 0
  const c = new RecoveryCapability({ store: { capabilities: async () => { calls++; if (fail) throw new Error('timeout'); return { recovery: { version: 1 } } } }, requested: true, now: () => now, retryMs: 60_000, ...quiet })
  assert.equal(await c.probe(), 'unknown')
  fail = false
  assert.equal(await c.probe(), 'unknown', 'not before retryMs')
  now = 60_000
  assert.equal(await c.probe(), 'enabled')
  assert.equal(calls, 2)
})

test('disable is permanent: an unsupported answer, then a capable answer, never re-enables (no flapping)', async () => {
  const c = new RecoveryCapability({ store: { capabilities: async () => ({ recovery: { version: 1 } }) }, requested: true, ...quiet })
  await c.probe()
  assert.equal(c.unsupported(new Error('500')), false, 'a transient error is not unsupported')
  assert.equal(c.state, 'enabled')
  assert.equal(c.unsupported(new RecoveryUnsupported('edge-v5')), true)
  assert.deepEqual([c.state, c.reason], ['disabled', 'edge-v5'])
  assert.equal(await c.probe(), 'disabled')
})

test('withRecovery: v2 (with the takeover) while enabled; unsupported → the SAME key once through v1; a transient error is the caller\'s (no v1 call, no duplicate claim)', async () => {
  const calls = []
  let v2 = async () => ({ status: 'claimed', epoch: 2, location: null, newerActive: false })
  const base = {
    locationClaim: async (user, key) => { calls.push(['v1', key.seq]); return { status: 'claimed', epoch: 1, location: null, newerActive: false } },
    locationClaimV2: async (user, key, options) => { calls.push(['v2', key.seq, options?.takeover === true]); return v2() },
    locationSave: async () => ({ status: 'ok', results: new Map() }),
    capabilities: async () => ({ recovery: { version: 1 } }),
  }
  const c = new RecoveryCapability({ store: base, requested: true, ...quiet })
  await c.probe()
  const store = withRecovery(base, () => c)
  assert.equal(store.locationSave, base.locationSave, 'everything else passes through')
  assert.equal((await store.locationClaim(USER, KEY, { takeover: true })).epoch, 2)
  v2 = async () => { throw new Error('world-authority location_claim_v2 500') }
  await assert.rejects(store.locationClaim(USER, KEY), /500/)
  assert.equal(c.state, 'enabled')
  v2 = async () => { throw new RecoveryUnsupported('edge-v5') }
  assert.equal((await store.locationClaim(USER, KEY)).epoch, 1)
  assert.equal(c.state, 'disabled')
  await store.locationClaim(USER, KEY)
  assert.deepEqual(calls, [['v2', 3, true], ['v2', 3, false], ['v2', 3, false], ['v1', 3], ['v1', 3]])
  assert.equal(c.counters.fallbacks, 1)
})

test('Edge adapter: unknown_op and unsupported are RecoveryUnsupported; any other non-2xx or a bad request is an ordinary error', async () => {
  let reply = { status: 200, body: {} }
  const sent = []
  const fetcher = async (_url, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify(reply.body), { status: reply.status }) }
  const edge = createEdgePlayerData({ url: 'https://local/wa', secret: 's'.repeat(48), publishableKey: 'anon', fetcher })
  reply = { status: 400, body: { error: 'unknown_op' } }
  assert.deepEqual(await edge.capabilities(), { recovery: null, reason: 'edge-v5', joinOrder: null, joinOrderReason: 'edge-v5' })
  await assert.rejects(edge.locationClaimV2(USER, KEY, { takeover: true }), error => error instanceof RecoveryUnsupported && error.reason === 'edge-v5')
  assert.deepEqual(sent.at(-1), { op: 'location_claim_v2', userId: USER, ...KEY, takeover: true })
  reply = { status: 501, body: { error: 'unsupported' } }
  await assert.rejects(edge.presenceAnyActive(), error => error instanceof RecoveryUnsupported && error.reason === 'sql-missing')
  for (const r of [{ status: 500, body: { error: 'authority_failed' } }, { status: 400, body: { error: 'invalid_takeover' } }, { status: 401, body: { error: 'unauthorized' } }]) {
    reply = r
    await assert.rejects(edge.locationClaimV2(USER, KEY), error => !(error instanceof RecoveryUnsupported), JSON.stringify(r))
  }
  reply = { status: 200, body: { recovery: { version: 1 } } }
  // CLOUD JOIN-ORDER-2: a v6 function does not name the join order at all.
  assert.deepEqual(await edge.capabilities(), { recovery: { version: 1 }, joinOrder: null, joinOrderReason: 'edge-v6' })
  reply = { status: 200, body: { active: true } }
  assert.equal(await edge.presenceAnyActive(), true)
})

const HANDLER = new URL('../../../../supabase/functions/world-authority/handler.ts', import.meta.url)
const ROLLBACK = fileURLToPath(new URL('../../../../scripts/world-location/rollback_world_presence_recovery.sql', import.meta.url))
// CLOUD JOIN-ORDER-2: claim v3 (20261006120000) sits on top of the recovery SQL; its rollback runs first.
const JOIN_ORDER_ROLLBACK = fileURLToPath(new URL('../../../../scripts/world-location/rollback_world_location_join_order.sql', import.meta.url))

test('production path: Edge adapter → world-authority v6 handler → SQL; then the SQL is rolled back under a live process', async t => {
  let handler
  try { handler = await import(HANDLER.href) } catch { return t.skip('this Node cannot load TypeScript; the handler has its own Deno tests') }
  const db = await openLocalDatabase()
  let host = null
  // One hook, in order: the host's last call before the database closes.
  t.after(async () => { await host?.stop(); await db.close() })
  await db.exec(`INSERT INTO auth.users VALUES ('${USER}')`)
  const query = serviceQuery(db)
  // supabase-js rpc(fn, namedArgs) over SQL, with the error code PostgREST forwards (42883 here).
  const rpc = async (fn, args) => {
    try {
      const names = Object.keys(args)
      const { rows } = await query(`SELECT public.${fn}(${names.map((name, i) => `${name} => $${i + 1}`).join(', ')}) AS data`, names.map(name => args[name]))
      return { data: rows[0]?.data ?? null, error: null }
    } catch (error) {
      return { data: null, error: { message: error.message, code: error.code } }
    }
  }
  const SECRET = 's'.repeat(48)
  const fetcher = async (_url, init) => handler.handleWorldAuthority(new Request('https://local/world-authority', init), { secret: SECRET, rpc })
  const edge = createEdgePlayerData({ url: 'https://local/world-authority', secret: SECRET, publishableKey: 'anon', fetcher })
  const capability = new RecoveryCapability({ store: edge, requested: true, ...quiet })
  assert.equal(await capability.probe(), 'enabled')

  host = new HostLifecycle({ store: createSqlPlayerData(query), renewMs: 600_000, log: () => {} })
  await host.acquire(); await host.activate()
  const store = withRecovery(edge, () => capability)
  const key = host.sessionKey()
  assert.equal((await store.locationClaim(USER, key)).status, 'claimed', 'v2 through the real handler')
  assert.equal(await edge.presenceAnyActive(), true)

  await db.exec(await readFile(JOIN_ORDER_ROLLBACK, 'utf8'))
  await db.exec(await readFile(ROLLBACK, 'utf8'))      // the SQL goes first (wrong order, on purpose)
  assert.deepEqual(await edge.capabilities(), { recovery: null, reason: 'sql-missing', joinOrder: null, joinOrderReason: 'sql-missing' }, 'v7 reports what the SQL really has')
  const again = host.sessionKey()
  assert.equal((await store.locationClaim(USER, again)).status, 'claimed', 'falls back to v1 with the same key')
  assert.equal(capability.state, 'disabled')
  await assert.rejects(edge.presenceAnyActive(), RecoveryUnsupported)
})
