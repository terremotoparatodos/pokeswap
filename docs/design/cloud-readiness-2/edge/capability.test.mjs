// CLOUD READINESS-2 — capability contract checks (Node 24: imports the REAL handler.ts with type
// stripping). No network, no secrets: synthetic secret, in-memory rpc stubs.
//   node --test docs/design/cloud-readiness-2/edge/capability.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { CapabilityClient } from './capabilityClient.mjs'
import { createV6 } from './prototypeV6.mjs'

const HANDLER = new URL('../../../../supabase/functions/world-authority/handler.ts', import.meta.url).href
const { handleWorldAuthority: handleV5 } = await import(HANDLER)
const handleV6 = await createV6(HANDLER)
const SECRET = `synthetic-${'x'.repeat(40)}`
const req = body => new Request('http://edge.test/world-authority', { method: 'POST', headers: { 'x-world-authority-secret': SECRET }, body: JSON.stringify(body) })
const answer = async res => ({ status: res.status, body: await res.json() })

/** An rpc stub: `missing` names functions that do not exist (PostgREST PGRST202). */
function rpc({ missing = [], failing = [], data = {} } = {}) {
  const calls = []
  return { calls, secret: SECRET, async rpc(fn, args) {
    calls.push([fn, args])
    if (missing.includes(fn)) return { data: null, error: { code: 'PGRST202', message: 'not found' } }
    if (failing.includes(fn)) return { data: null, error: { code: '57014', message: 'canceling statement' } }
    return { data: fn in data ? data[fn] : { status: 'ok' }, error: null }
  } }
}

const host = { generation: 7, hostId: randomUUID(), leaseMs: 15000 }
const V5_BODIES = [
  { op: 'presence_acquire', hostId: host.hostId, leaseMs: 15000 },
  { op: 'presence_activate', ...host },
  { op: 'presence_renew', ...host },
  { op: 'presence_drain', generation: 7, hostId: host.hostId, drainMs: 10000 },
  { op: 'presence_stop', generation: 7, hostId: host.hostId },
  { op: 'location_claim', userId: randomUUID(), generation: 7, seq: 1, sessionId: randomUUID(), hostId: host.hostId },
  { op: 'location_save', generation: 7, hostId: host.hostId, rows: [{ userId: randomUUID(), epoch: 1, seq: 1, areaId: 'ciudad-corazon', tx: 3, ty: 4, layoutVersion: '1.test' }] },
  { op: 'nonsense' },
  { op: 'presence_activate', generation: 'x' },
]

test('E1 FACT: the current Edge (ad6a98e, v5) answers 400 unknown_op to every recovery op and to capabilities', async () => {
  for (const op of ['capabilities', 'location_claim_v2', 'presence_activate_exclusive', 'presence_any_active']) {
    assert.deepEqual(await answer(await handleV5(req({ op }), rpc())), { status: 400, body: { error: 'unknown_op' } }, op)
  }
})

test('E2 v6 prototype: every v5 op gives a byte-identical answer and the same rpc calls (old realtimes unaffected)', async () => {
  for (const body of V5_BODIES) {
    const a = rpc(); const b = rpc()
    const [r5, r6] = [await answer(await handleV5(req(body), a)), await answer(await handleV6(req(body), b))]
    assert.deepEqual(r6, r5, body.op)
    assert.deepEqual(b.calls, a.calls, body.op)
  }
  // The door is the same: no secret → 401 on recovery ops too.
  const noSecret = new Request('http://edge.test', { method: 'POST', body: JSON.stringify({ op: 'capabilities' }) })
  assert.equal((await handleV6(noSecret, rpc())).status, 401)
})

test('E3 v6 prototype: capabilities follow the SQL actually present; a missing function is 501 unsupported, other errors stay 500', async () => {
  assert.deepEqual(await answer(await handleV6(req({ op: 'capabilities' }), rpc({ data: { world_presence_recovery_version: 1 } }))), { status: 200, body: { recovery: { version: 1 } } })
  assert.deepEqual(await answer(await handleV6(req({ op: 'capabilities' }), rpc({ missing: ['world_presence_recovery_version'] }))), { status: 200, body: { recovery: null } })
  assert.deepEqual(await answer(await handleV6(req({ op: 'location_claim_v2' }), rpc({ missing: ['world_location_claim_keyed_v2'] }))), { status: 501, body: { error: 'unsupported' } })
  assert.deepEqual(await answer(await handleV6(req({ op: 'location_claim_v2' }), rpc({ failing: ['world_location_claim_keyed_v2'] }))), { status: 500, body: { error: 'authority_failed' } })
})

// ── the realtime side (model) against the real v5 handler and the v6 prototype ─────────────────
const via = (handler, deps) => async (op, body) => answer(await handler(req({ op, ...body }), deps))
const key = { userId: randomUUID(), generation: 7, seq: 1, sessionId: randomUUID(), hostId: host.hostId }
const SQL_OK = { data: { world_presence_recovery_version: 1, world_location_claim_keyed_v2: { status: 'claimed' }, world_presence_activate_exclusive: { status: 'active' } } }

test('E4 against a v5 Edge: probe → disabled, every claim uses v1, no standby', async () => {
  const c = new CapabilityClient({ call: via(handleV5, rpc()) })
  assert.equal(await c.probe(), 'disabled'); assert.equal(c.reason, 'edge-v5')
  assert.equal((await c.claim(key)).via, 'v1')
  assert.deepEqual(await c.promote(host), { promoted: false, reason: 'edge-v5' })
  assert.deepEqual(c.calls, ['capabilities', 'location_claim'])
})

test('E5 against v6 with SQL: enabled, claims use v2, standby promotes', async () => {
  const c = new CapabilityClient({ call: via(handleV6, rpc(SQL_OK)) })
  assert.equal(await c.probe(), 'enabled')
  assert.equal((await c.claim(key)).via, 'v2')
  assert.equal((await c.promote(host)).promoted, true)
})

test('E6 rollback Edge v6 → v5 under a process with the capability cached: one call disables, the claim falls back to v1 once, then v1 only', async () => {
  let handler = handleV6
  const c = new CapabilityClient({ call: async (op, body) => answer(await handler(req({ op, ...body }), rpc(SQL_OK))) })
  await c.probe(); assert.equal(c.state, 'enabled')
  handler = handleV5                                              // the Edge is rolled back
  const r = await c.claim(key)
  assert.equal(r.via, 'v1'); assert.equal(c.state, 'disabled'); assert.equal(c.reason, 'edge-v5')
  handler = handleV6                                              // even if v6 comes back: no flapping
  assert.equal((await c.claim(key)).via, 'v1')
  assert.deepEqual(c.calls, ['capabilities', 'location_claim_v2', 'location_claim', 'location_claim'])
})

test('E7 SQL dropped under v6 (wrong rollback order): 501 unsupported disables and falls back; a promotion in flight stops its identity', async () => {
  const deps = rpc({ ...SQL_OK, missing: [] })
  const c = new CapabilityClient({ call: via(handleV6, deps) })
  await c.probe()
  const dropped = rpc({ missing: ['world_location_claim_keyed_v2', 'world_presence_activate_exclusive', 'world_presence_recovery_version'] })
  c.call = via(handleV6, dropped)
  const p = await c.promote(host)
  assert.deepEqual(p, { promoted: false, reason: 'sql-missing' })
  assert.deepEqual(c.calls.slice(-3), ['presence_acquire', 'presence_activate_exclusive', 'presence_stop'])
  assert.equal((await c.claim(key)).via, 'v1')
})

test('E8 a transient failure (500) never disables: the caller retries as today (no silent v1 downgrade)', async () => {
  const c = new CapabilityClient({ call: via(handleV6, rpc({ ...SQL_OK, failing: ['world_location_claim_keyed_v2'] })) })
  await c.probe()
  const r = await c.claim(key)
  assert.equal(r.via, 'v2'); assert.equal(r.status, 500); assert.equal(c.state, 'enabled')
})

test('E9 kill switch: never probes, never calls a recovery op', async () => {
  const c = new CapabilityClient({ call: via(handleV6, rpc(SQL_OK)), killSwitch: 'off' })
  assert.equal(await c.probe(), 'off')
  assert.equal((await c.claim(key)).via, 'v1')
  assert.deepEqual(await c.promote(host), { promoted: false, reason: 'kill-switch' })
  assert.deepEqual(c.calls, ['location_claim'])
})

test('E10 control: a client that treated 500 as unsupported would silently downgrade on a transient error (rejected design)', async () => {
  class Naive extends CapabilityClient { async claim(k) { const r = await this.call('location_claim_v2', k); if (r.status >= 400) { this.state = 'disabled'; return { via: 'v1' } } return { via: 'v2', ...r } } }
  const c = new Naive({ call: via(handleV6, rpc({ ...SQL_OK, failing: ['world_location_claim_keyed_v2'] })) })
  await c.probe(); await c.claim(key)
  assert.equal(c.state, 'disabled', 'the naive rule disables on a transient 500 — the contract above must not')
})
