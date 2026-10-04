import test from 'node:test'
import assert from 'node:assert/strict'
import { openLocalDatabase, serviceQuery } from './dev/localDatabase.js'
import { LOCATION_CLAIM_TIMEOUT_MS, createEdgePlayerData, createSqlPlayerData, readClaim, readSaveAnswer, readSaveResults } from './playerData.js'
import { withPlayerDataMetrics } from './playerDataMetrics.js'
import { within } from '../testing.js'

// WORLD LOCATION-2/4: the PlayerDataAuthority location operations on both adapters (keyed
// claim and save, host lifecycle), the Edge path end to end (real handler, real SQL), the
// claim's own budget, strict answer parsing and the metrics wrapper.

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const H = 'a0000000-0000-4000-8000-000000000001'
const S1 = 'c0000000-0000-4000-8000-000000000001'
const S2 = 'c0000000-0000-4000-8000-000000000002'
const HANDLER = new URL('../../../../../supabase/functions/world-authority/handler.ts', import.meta.url)
const SECRET = 's'.repeat(48)
const row = (userId, epoch, seq, extra = {}) => ({ userId, epoch, seq, areaId: 'pradera', tx: 1, ty: -60, layoutVersion: 'p.abc', ...extra })

async function database() {
  const db = await openLocalDatabase()
  await db.exec(`INSERT INTO auth.users VALUES ('${A}'), ('${B}')`)
  return db
}

/** Acquire + activate a host through the adapter; returns the writer and a key factory. */
async function activeHostOn(data, hostId = H) {
  const { generation } = await data.presenceAcquire(hostId, 15_000)
  assert.deepEqual(await data.presenceActivate(generation, hostId, 15_000), { status: 'active' })
  const writer = { generation, hostId }
  return { writer, key: (seq, sessionId) => ({ generation, seq, sessionId, hostId }) }
}

/** The shared flow: both adapters must give exactly the same answers. */
async function keyedFlow(data) {
  const { writer, key } = await activeHostOn(data)
  assert.deepEqual(await data.locationClaim(A, key(1, S1)), { status: 'claimed', epoch: 1, location: null, newerActive: false })
  assert.deepEqual(await data.locationClaim(A, key(1, S1)), { status: 'claimed', epoch: 1, location: null, newerActive: false }, 'a retry adopts')
  assert.deepEqual(await data.locationClaim('99999999-9999-4999-8999-999999999999', key(9, S2)), { status: 'unknown_user' })
  const saved = await data.locationSave([row(A, 1, 1, { tx: 7 }), row(B, 2, 1)], writer)
  assert.equal(saved.status, 'ok')
  assert.deepEqual([...saved.results], [[A, 'applied'], [B, 'stale']])
  assert.equal(saved.newerActive, false)
  const newer = await data.locationClaim(A, key(2, S2))
  assert.deepEqual(newer, { status: 'claimed', epoch: 2, location: { areaId: 'pradera', tx: 7, ty: -60, layoutVersion: 'p.abc' }, newerActive: false })
  assert.deepEqual(await data.locationClaim(A, key(1, S1)), { status: 'superseded', newerActive: false }, 'final for the older key')
  await data.presenceStop(writer.generation, writer.hostId)
  assert.deepEqual(await data.locationClaim(B, key(3, S1)), { status: 'host_inactive', state: 'stopped' })
  assert.deepEqual(await data.locationSave([row(A, 2, 1)], writer), { status: 'host_inactive', state: 'stopped' })
  return writer
}

test('SQL adapter: keyed claim, save and host refusals over the real migration', async () => {
  const db = await database()
  const data = createSqlPlayerData(serviceQuery(db))
  await keyedFlow(data)
  const host = { generation: 1, hostId: H }
  await assert.rejects(data.locationClaim('benchmark-pc', { ...host, seq: 1, sessionId: S1 }), /invalid user id/, 'never sends a non-UUID identity')
  for (const bad of [null, {}, { ...host, seq: 0, sessionId: S1 }, { ...host, seq: 1, sessionId: 'tab' }, { ...host, seq: 1.5, sessionId: S1 }, { seq: 1, sessionId: S1, hostId: H }]) {
    await assert.rejects(data.locationClaim(A, bad), /invalid session key/, JSON.stringify(bad))
  }
  for (const bad of [null, { generation: 0, hostId: H }, { generation: 1 }, { generation: 1, hostId: 'h' }]) {
    await assert.rejects(data.locationSave([row(A, 1, 1)], bad), /invalid writing host/, JSON.stringify(bad))
  }
  await db.close()
})

test('Edge adapter → real world-authority handler → SQL: the same answers, and nothing without the secret', async t => {
  let handler
  try { handler = await import(HANDLER.href) } catch { return t.skip('this Node cannot load TypeScript; covered by deno test') }
  const db = await database()
  const query = serviceQuery(db)
  const rpc = async (fn, args) => {
    try {
      const names = Object.keys(args)
      const values = names.map(name => (args[name] !== null && typeof args[name] === 'object' ? JSON.stringify(args[name]) : args[name]))
      const { rows } = await query(`SELECT public.${fn}(${names.map((name, i) => `${name} => $${i + 1}`).join(', ')}) AS data`, values)
      return { data: rows[0]?.data ?? null, error: null }
    } catch (error) {
      return { data: null, error: { message: error.message } }
    }
  }
  const sent = []
  const fetcher = async (_url, init) => { sent.push(JSON.parse(init.body)); return handler.handleWorldAuthority(new Request('https://local/world-authority', init), { secret: SECRET, rpc }) }
  const data = createEdgePlayerData({ url: 'https://local/world-authority', secret: SECRET, publishableKey: 'anon', fetcher })
  const writer = await keyedFlow(data)
  const claims = sent.filter(body => body.op === 'location_claim')
  assert.ok(claims.every(body => 'generation' in body && 'seq' in body && 'sessionId' in body && 'hostId' in body && !('expectedEpoch' in body)), 'only the keyed shape')
  const intruder = createEdgePlayerData({ url: 'https://local/world-authority', secret: 'w'.repeat(48), publishableKey: 'anon', fetcher })
  await assert.rejects(intruder.locationClaim(A, { ...writer, seq: 5, sessionId: S1 }), /401/)
  await assert.rejects(intruder.presenceAcquire(H, 15_000), /401/)
  // A malformed batch never reaches SQL: 400, nothing written.
  await assert.rejects(data.locationSave([row(A, 2, 1, { tx: 0.5 })], writer), /400/)
  await db.close()
})

test('Edge adapter: the claim has its own budget (4 s by default, separate from the 1.5 s hydration wait)', async () => {
  assert.equal(LOCATION_CLAIM_TIMEOUT_MS, 4_000)
  const hanging = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))
  const data = createEdgePlayerData({ url: 'https://x', secret: SECRET, publishableKey: 'k', fetcher: hanging, claimTimeoutMs: 30, timeoutMs: 60_000 })
  // The adapter's abort timer is unref'd and the fake fetch holds no socket: `within` keeps the loop alive (Node 22).
  const started = Date.now()
  await assert.rejects(within(data.locationClaim(A, { generation: 1, seq: 1, sessionId: S1, hostId: H }), 2_000, 'the claim budget'), /aborted/)
  assert.ok(Date.now() - started < 1_000)
})

test('readClaim: exactly one of the keyed answers or an error; a stored location of the wrong shape is dropped, not trusted', () => {
  assert.deepEqual(readClaim({ status: 'unknown_user' }), { status: 'unknown_user' })
  assert.deepEqual(readClaim({ status: 'unknown_host' }), { status: 'unknown_host' })
  assert.deepEqual(readClaim({ status: 'host_expired' }), { status: 'host_expired' })
  assert.deepEqual(readClaim({ status: 'host_inactive', state: 'draining' }), { status: 'host_inactive', state: 'draining' })
  assert.deepEqual(readClaim('{"status":"claimed","epoch":4,"location":null,"newerActive":true}'), { status: 'claimed', epoch: 4, location: null, newerActive: true })
  assert.deepEqual(readClaim({ status: 'superseded' }), { status: 'superseded', newerActive: false })
  for (const bad of [null, {}, { status: 'claimed' }, { status: 'claimed', epoch: 0 }, { status: 'claimed', epoch: 1.5 }, { status: 'ok', epoch: 1 },
    { status: 'conflict', epoch: 3 }, { status: 'host_inactive' }, { status: 'host_inactive', state: 'weird' }]) {
    assert.throws(() => readClaim(bad), /malformed/, JSON.stringify(bad))
  }
  for (const location of [{ areaId: 'pradera', tx: '1', ty: 2, layoutVersion: 'v' }, { areaId: 'pradera', tx: 1.5, ty: 2, layoutVersion: 'v' }, { tx: 1, ty: 2 }, 'pradera']) {
    assert.equal(readClaim({ status: 'claimed', epoch: 2, location }).location, null, JSON.stringify(location))
  }
})

test('readSaveAnswer: per-row results or one refusal for the batch; anything else is an error', () => {
  const sent = [row(A, 1, 1)]
  const ok = readSaveAnswer(sent, { status: 'ok', results: [{ userId: A, result: 'applied' }], newerActive: true })
  assert.deepEqual([ok.status, [...ok.results], ok.newerActive], ['ok', [[A, 'applied']], true])
  assert.deepEqual(readSaveAnswer(sent, { status: 'host_expired', state: 'draining' }), { status: 'host_expired', state: 'draining' })
  assert.deepEqual(readSaveAnswer(sent, { status: 'unknown_host' }), { status: 'unknown_host' })
  for (const bad of [null, [], { results: [] }, { status: 'unknown_user' }, { status: 'host_inactive' }]) assert.throws(() => readSaveAnswer(sent, bad), /malformed/)
})

test('readSaveResults: one answer per SENT user; anything missing or odd is "unknown" for that user only', () => {
  const sent = [row(A, 1, 1), row(B, 1, 1)]
  assert.deepEqual([...readSaveResults(sent, [{ userId: A, result: 'applied' }, { userId: B, result: 'stale' }])], [[A, 'applied'], [B, 'stale']])
  assert.deepEqual([...readSaveResults(sent, [{ userId: A, result: 'applied' }])], [[A, 'applied'], [B, 'unknown']])
  assert.deepEqual([...readSaveResults(sent, [{ userId: A, result: 'ok' }, { userId: B.toUpperCase(), result: 'duplicate' }])], [[A, 'unknown'], [B, 'duplicate']])
  // An answer about a user that was not sent is ignored: it can never confirm someone else.
  assert.deepEqual([...readSaveResults([row(A, 1, 1)], [{ userId: B, result: 'applied' }])], [[A, 'unknown']])
  assert.deepEqual([...readSaveResults(sent, null)], [[A, 'unknown'], [B, 'unknown']])
})

test('metrics wrapper: counts the location operations without ids, and omits operations an adapter lacks', async () => {
  const data = withPlayerDataMetrics({
    async playerState() { return {} }, async ownsPokemon() { return null }, async commitWork() { return {} }, async loadNodes() { return [] },
    async locationClaim() { return { status: 'claimed', epoch: 1, location: null } }, async locationSave() { throw new Error('down') },
  })
  await data.locationClaim(A, 0)
  await assert.rejects(data.locationSave([row(A, 1, 1)]), /down/)
  const metrics = data.metrics()
  assert.equal(metrics.locationClaim.calls, 1)
  assert.equal(metrics.locationSave.failures, 1)
  assert.doesNotMatch(JSON.stringify(metrics), /1111|pradera/)
  const older = withPlayerDataMetrics({ async playerState() { return {} }, async ownsPokemon() { return null }, async commitWork() { return {} }, async loadNodes() { return [] } })
  assert.equal(older.locationClaim, undefined)
  assert.equal('locationSave' in older.metrics(), false)
})
