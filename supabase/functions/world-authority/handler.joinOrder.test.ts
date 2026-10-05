// Run with: deno test supabase/functions/world-authority/
// CLOUD JOIN-ORDER-2 (additive v7): the join-ordered claim and its capability.
import { handleWorldAuthority, type AuthorityDeps } from './handler.ts'

function expect(actual: unknown) {
  const show = (v: unknown) => JSON.stringify(v)
  return {
    toBe(expected: unknown) { if (actual !== expected) throw new Error(`expected ${show(expected)}, got ${show(actual)}`) },
    toEqual(expected: unknown) { if (show(actual) !== show(expected)) throw new Error(`expected ${show(expected)}, got ${show(actual)}`) },
    not: { toContain(part: string) { if (String(actual).includes(part)) throw new Error(`did not expect ${part}`) } },
  }
}
const it = (name: string, fn: () => Promise<void>) => Deno.test(name, fn)

type Calls = { fn: string; args: Record<string, unknown> }[]
const SECRET = 'x'.repeat(48)
const USER = '11111111-1111-4111-8111-111111111111'
const HOST = 'a0000000-0000-4000-8000-000000000001'
const SESSION = 'c0000000-0000-4000-8000-000000000001'
const PAGE = '6f1c2a9e-3b4d-4c5e-8f70-112233445566'
const post = (body: unknown, secret: string | null = SECRET) => new Request('https://x/functions/v1/world-authority', {
  method: 'POST', headers: { 'content-type': 'application/json', ...(secret === null ? {} : { 'x-world-authority-secret': secret }) }, body: JSON.stringify(body),
})
const claimV3 = (extra: Record<string, unknown> = {}) => ({ op: 'location_claim_v3', userId: USER, generation: 4, seq: 9, sessionId: SESSION, hostId: HOST, takeover: false, recovery: false, page: PAGE, attempt: 3, ...extra })
const answering = (data: unknown, calls: Calls = []): AuthorityDeps => ({ secret: SECRET, rpc: async (fn, args) => { calls.push({ fn, args }); return { data, error: null } } })
const missing = (code: string, only?: string): AuthorityDeps => ({
  secret: SECRET,
  rpc: async fn => (only && fn !== only ? { data: 1, error: null } : { data: null, error: { message: 'function public.x does not exist on db.internal', code } }),
})

it('v7 capabilities: recovery and joinOrder are read from their OWN markers, independently', async () => {
  const onlyRecovery = await handleWorldAuthority(post({ op: 'capabilities' }), missing('PGRST202', 'world_location_join_order_version'))
  expect(await onlyRecovery.json()).toEqual({ recovery: { version: 1 }, joinOrder: null })
  const onlyJoinOrder = await handleWorldAuthority(post({ op: 'capabilities' }), missing('42883', 'world_presence_recovery_version'))
  expect(await onlyJoinOrder.json()).toEqual({ recovery: null, joinOrder: { version: 1 } })
  const failed = await handleWorldAuthority(post({ op: 'capabilities' }), missing('57014', 'world_location_join_order_version'))
  expect(failed.status).toBe(500)
  expect(await failed.text()).not.toContain('db.internal')
})

it('location_claim_v3: needs the secret; the whole key, host, explicit booleans, page and attempt go to world_location_claim_keyed_v3, nothing else', async () => {
  const calls: Calls = []
  expect((await handleWorldAuthority(post(claimV3(), null), answering({ status: 'claimed' }, calls))).status).toBe(401)
  expect(calls).toEqual([])
  for (const [takeover, recovery] of [[false, false], [false, true], [true, true]]) {
    const response = await handleWorldAuthority(post(claimV3({ takeover, recovery, tabId: 'forged', epoch: 99, areaId: 'pradera' })), answering({ status: 'stale_attempt' }, calls))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ claim: { status: 'stale_attempt' } })
  }
  expect(calls.map(c => c.fn)).toEqual(['world_location_claim_keyed_v3', 'world_location_claim_keyed_v3', 'world_location_claim_keyed_v3'])
  expect(calls[2].args).toEqual({ p_user_id: USER, p_generation: 4, p_seq: 9, p_session: SESSION, p_host_id: HOST, p_takeover: true, p_recovery: true, p_page: PAGE, p_attempt: 3 })
})

it('location_claim_v3: malformed key, booleans, page or attempt, a takeover without recovery, or a v1 field never reach SQL (400)', async () => {
  const calls: Calls = []
  const bad: [Record<string, unknown>, string][] = [
    [claimV3({ userId: 'me' }), 'invalid_user'], [claimV3({ expectedEpoch: 0 }), 'mixed_claim'],
    [claimV3({ generation: 0 }), 'invalid_key'], [claimV3({ seq: 1.5 }), 'invalid_key'], [claimV3({ sessionId: 'tab-1' }), 'invalid_key'], [claimV3({ hostId: 'h' }), 'invalid_key'],
    [claimV3({ takeover: 'false' }), 'invalid_takeover'], [claimV3({ recovery: undefined }), 'invalid_takeover'], [claimV3({ recovery: 1 }), 'invalid_takeover'],
    [claimV3({ takeover: true, recovery: false }), 'invalid_takeover'],
    [claimV3({ page: undefined }), 'invalid_attempt'], [claimV3({ page: 'short' }), 'invalid_attempt'], [claimV3({ page: '<script>alert(1)</script>' }), 'invalid_attempt'], [claimV3({ page: 'x'.repeat(65) }), 'invalid_attempt'],
    [claimV3({ attempt: undefined }), 'invalid_attempt'], [claimV3({ attempt: 0 }), 'invalid_attempt'], [claimV3({ attempt: -1 }), 'invalid_attempt'], [claimV3({ attempt: 1.5 }), 'invalid_attempt'],
    [claimV3({ attempt: '3' }), 'invalid_attempt'], [claimV3({ attempt: 2147483648 }), 'invalid_attempt'], [claimV3({ attempt: null }), 'invalid_attempt'],
  ]
  for (const [body, error] of bad) {
    const response = await handleWorldAuthority(post(body), answering({ status: 'claimed' }, calls))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error })
  }
  expect(calls).toEqual([])
})

it('location_claim_v3: a missing SQL function answers 501 unsupported (the realtime falls back); any other failure stays 500 without leaking', async () => {
  for (const code of ['PGRST202', '42883']) {
    const response = await handleWorldAuthority(post(claimV3()), missing(code))
    expect(response.status).toBe(501)
    expect(await response.json()).toEqual({ error: 'unsupported' })
  }
  const failed = await handleWorldAuthority(post(claimV3()), missing('57014'))
  expect(failed.status).toBe(500)
  expect(await failed.text()).not.toContain('db.internal')
})

it('the v5 and v6 claims are unchanged: page and attempt fields on them never reach SQL', async () => {
  const calls: Calls = []
  const v2 = { op: 'location_claim_v2', userId: USER, generation: 4, seq: 9, sessionId: SESSION, hostId: HOST, takeover: false, page: PAGE, attempt: 3, recovery: true }
  const v5 = { op: 'location_claim', userId: USER, generation: 4, seq: 9, sessionId: SESSION, hostId: HOST, page: PAGE, attempt: 3 }
  expect((await handleWorldAuthority(post(v2), answering({ status: 'claimed' }, calls))).status).toBe(200)
  expect((await handleWorldAuthority(post(v5), answering({ status: 'claimed' }, calls))).status).toBe(200)
  expect(calls).toEqual([
    { fn: 'world_location_claim_keyed_v2', args: { p_user_id: USER, p_generation: 4, p_seq: 9, p_session: SESSION, p_host_id: HOST, p_takeover: false } },
    { fn: 'world_location_claim_keyed', args: { p_user_id: USER, p_generation: 4, p_seq: 9, p_session: SESSION, p_host_id: HOST } },
  ])
})
