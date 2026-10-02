import test from 'node:test'
import assert from 'node:assert/strict'
import { openLocalDatabase, serviceQuery } from './dev/localDatabase.js'
import { LOCATION_CLAIM_TIMEOUT_MS, createEdgePlayerData, createSqlPlayerData, readClaim, readSaveResults } from './playerData.js'
import { withPlayerDataMetrics } from './playerDataMetrics.js'

// WORLD LOCATION-2, commit 3: the PlayerDataAuthority location operations on
// both adapters, the Edge path end to end (real handler, real SQL), the
// claim's own short timeout, per-user result parsing and the metrics wrapper.

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const HANDLER = new URL('../../../../../supabase/functions/world-authority/handler.ts', import.meta.url)
const SECRET = 's'.repeat(48)
const row = (userId, epoch, seq, extra = {}) => ({ userId, epoch, seq, areaId: 'pradera', tx: 1, ty: -60, layoutVersion: 'p.abc', ...extra })

async function database() {
  const db = await openLocalDatabase()
  await db.exec(`INSERT INTO auth.users VALUES ('${A}'), ('${B}')`)
  return db
}

test('SQL adapter: claim, save and per-user results over the real migration', async () => {
  const db = await database()
  const data = createSqlPlayerData(serviceQuery(db))
  assert.deepEqual(await data.locationClaim(A, 0), { status: 'claimed', epoch: 1, location: null })
  assert.deepEqual(await data.locationClaim(A, 0), { status: 'conflict', epoch: 1 })
  assert.deepEqual(await data.locationClaim('99999999-9999-4999-8999-999999999999', 0), { status: 'unknown_user' })
  await data.locationClaim(B, 0)
  const results = await data.locationSave([row(A, 1, 1), row(B, 2, 1)])
  assert.deepEqual([...results], [[A, 'applied'], [B, 'stale']])
  assert.deepEqual(await data.locationClaim(A, 1), { status: 'claimed', epoch: 2, location: { areaId: 'pradera', tx: 1, ty: -60, layoutVersion: 'p.abc' } })
  await assert.rejects(data.locationClaim('benchmark-pc', 0), /invalid user id/, 'never sends a non-UUID identity')
  for (const bad of [undefined, null, -1, 1.5, '2']) await assert.rejects(data.locationClaim(A, bad), /invalid expected epoch/, 'never sends an unconditional claim')
  await db.close()
})

test('Edge adapter → real world-authority handler → SQL: claim, save, and nothing without the secret', async t => {
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
  assert.deepEqual(await data.locationClaim(A, 0), { status: 'claimed', epoch: 1, location: null })
  assert.deepEqual([...await data.locationSave([row(A, 1, 1, { tx: 7 })])], [[A, 'applied']])
  assert.deepEqual(await data.locationClaim(A, 0), { status: 'conflict', epoch: 1 })
  assert.deepEqual((await data.locationClaim(A, 1)).location, { areaId: 'pradera', tx: 7, ty: -60, layoutVersion: 'p.abc' })
  assert.deepEqual(sent.map(body => [body.op, body.expectedEpoch]), [['location_claim', 0], ['location_save', undefined], ['location_claim', 0], ['location_claim', 1]])
  const intruder = createEdgePlayerData({ url: 'https://local/world-authority', secret: 'w'.repeat(48), publishableKey: 'anon', fetcher })
  await assert.rejects(intruder.locationClaim(A, 2), /401/)
  await assert.rejects(intruder.locationSave([row(A, 2, 1)]), /401/)
  // A malformed batch never reaches SQL: 400, nothing written.
  await assert.rejects(data.locationSave([row(A, 2, 1, { tx: 0.5 })]), /400/)
  assert.equal((await data.locationClaim(A, 2)).location.tx, 7)
  await db.close()
})

test('Edge adapter: the claim has its own short budget (1.5 s by default), independent of the 6 s one', async () => {
  assert.equal(LOCATION_CLAIM_TIMEOUT_MS, 1_500)
  const hanging = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))
  const data = createEdgePlayerData({ url: 'https://x', secret: SECRET, publishableKey: 'k', fetcher: hanging, claimTimeoutMs: 30, timeoutMs: 60_000 })
  // The adapter's abort timer is unref'd and the fake fetch holds no socket: keep the loop alive (Node 22).
  const alive = setInterval(() => {}, 1_000)
  const started = Date.now()
  await assert.rejects(data.locationClaim(A, 0), /aborted/).finally(() => clearInterval(alive))
  assert.ok(Date.now() - started < 1_000)
})

test('readClaim: exactly a claim or an error; a stored location of the wrong shape is dropped, not trusted', () => {
  assert.deepEqual(readClaim({ status: 'unknown_user' }), { status: 'unknown_user' })
  assert.deepEqual(readClaim('{"status":"claimed","epoch":4,"location":null}'), { status: 'claimed', epoch: 4, location: null })
  assert.deepEqual(readClaim({ status: 'conflict', epoch: 0 }), { status: 'conflict', epoch: 0 })
  assert.deepEqual(readClaim({ status: 'conflict', epoch: 9, location: { areaId: 'pradera' } }), { status: 'conflict', epoch: 9 }, 'a conflict carries no location')
  for (const bad of [null, {}, { status: 'claimed' }, { status: 'claimed', epoch: 0 }, { status: 'claimed', epoch: 1.5 }, { status: 'ok', epoch: 1 },
    { status: 'conflict' }, { status: 'conflict', epoch: -1 }, { status: 'conflict', epoch: '3' }]) {
    assert.throws(() => readClaim(bad), /malformed/, JSON.stringify(bad))
  }
  for (const location of [{ areaId: 'pradera', tx: '1', ty: 2, layoutVersion: 'v' }, { areaId: 'pradera', tx: 1.5, ty: 2, layoutVersion: 'v' }, { tx: 1, ty: 2 }, 'pradera']) {
    assert.equal(readClaim({ status: 'claimed', epoch: 2, location }).location, null, JSON.stringify(location))
  }
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
