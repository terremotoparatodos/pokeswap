import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BACKOFF_MAX_MS, CHECKPOINT_JITTER_MS, CHECKPOINT_MS, LocationJournal, MAX_BATCH_ROWS, backoffMs, jitterFor, persistableIdentity,
} from './locationJournal.js'
import { manualClock, settle } from '../world/testing.js'

// WORLD LOCATION-2, commit 5: the journal on a fake store that applies the
// same CAS as world_location_save (applied / duplicate / stale) and the same
// conditional claim as world_location_claim (claimed / conflict, review B2).

const uid = n => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`
const A = uid(1), B = uid(2), C = uid(3)
const locate = actor => ['ciudad-corazon', 'pradera', 'cueva-inicial'].includes(actor.areaId)
  ? { areaId: actor.areaId, tx: actor.tx, ty: actor.ty, layoutVersion: `v.${actor.areaId.slice(0, 3)}` } : null

function fakeStore() {
  const rows = new Map()
  const store = {
    rows, claims: [], expectations: [], batches: [],
    down: false, hang: false, claimDown: false, lose: new Set(), override: new Map(),
    async locationClaim(userId, expectedEpoch) {
      store.claims.push(userId)
      store.expectations.push(expectedEpoch)
      if (store.claimDown) throw new Error('authority down')
      if (store.claimGate) await store.claimGate(userId)
      return store.claimNow(userId, expectedEpoch)
    },
    /** world_location_claim: writes only if the stored epoch is still the expected one (0 = no row). */
    claimNow(userId, expectedEpoch) {
      const row = rows.get(userId)
      if ((row?.epoch ?? 0) !== expectedEpoch) return { status: 'conflict', epoch: row?.epoch ?? 0 }
      const next = { epoch: (row?.epoch ?? 0) + 1, seq: 0, location: row?.location ?? null }
      rows.set(userId, next)
      return { status: 'claimed', epoch: next.epoch, location: next.location }
    },
    async locationSave(batch) {
      store.batches.push(batch.map(r => ({ ...r })))
      if (store.hang) return new Promise(() => {})
      if (store.down) throw new Error('authority down')
      const results = new Map()
      for (const r of batch) {
        const row = rows.get(r.userId)
        let result
        if (!row || row.epoch !== r.epoch) result = 'stale'
        else if (r.seq <= row.seq) result = 'duplicate'
        else { row.seq = r.seq; row.location = { areaId: r.areaId, tx: r.tx, ty: r.ty, layoutVersion: r.layoutVersion }; result = 'applied' }
        if (store.override.has(r.userId)) result = store.override.get(r.userId)
        if (!store.lose.has(r.userId)) results.set(r.userId, result)
      }
      if (store.applyThenFail) { store.applyThenFail = false; throw new Error('timeout after commit') }
      return results
    },
  }
  return store
}

function setup(options = {}) {
  const clock = manualClock(1_000_000)
  const store = options.store ?? fakeStore()
  const fenced = []
  const claimed = []
  const journal = new LocationJournal({
    store, locate, now: clock.now, log: () => {},
    onFenced: (userId, epoch) => fenced.push({ userId, epoch }), onClaimed: (session, result) => claimed.push(result.status), ...options,
  })
  const run = async (ms = 0) => { clock.advance(ms); journal.tick(); await settle(); await journal.idle(); await settle() }
  const actor = (areaId = 'pradera', tx = 0, ty = -60) => ({ areaId, tx, ty, dir: 'down', moveSequence: 0 })
  const join = async userId => { const s = journal.beginSession(userId); await journal.claim(s); return s }
  return { clock, store, journal, run, actor, join, fenced, claimed }
}

test('persistable identity: Supabase user ids only (guests and benchmark ids are never persisted)', () => {
  assert.equal(persistableIdentity(A), true)
  for (const id of ['benchmark-pc', 'same-user', '', null, undefined, `${A}x`]) assert.equal(persistableIdentity(id), false, String(id))
})

test('jitter is deterministic, bounded and spreads players; backoff doubles up to 30 s', () => {
  const values = Array.from({ length: 200 }, (_, i) => jitterFor(uid(i)))
  assert.ok(values.every(v => Number.isInteger(v) && v >= 0 && v < CHECKPOINT_JITTER_MS))
  assert.deepEqual(values, Array.from({ length: 200 }, (_, i) => jitterFor(uid(i))))
  assert.ok(new Set(values).size > 150, 'players do not share one checkpoint instant')
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 10].map(backoffMs), [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, BACKOFF_MAX_MS])
})

test('initial claim: epoch 1, then a checkpoint only after 10 s + jitter, with the server seq', async () => {
  const { journal, store, run, actor, join } = setup()
  const s = await join(A)
  assert.equal(s.epoch, 1)
  assert.equal(journal.statusOf(s), 'claimed')
  journal.note(s, actor('pradera', 1, -60))
  await run(CHECKPOINT_MS - 1)
  assert.equal(store.batches.length, 0, 'never before the checkpoint')
  await run(1 + jitterFor(A))
  assert.deepEqual(store.batches, [[{ userId: A, epoch: 1, seq: 1, areaId: 'pradera', tx: 1, ty: -60, layoutVersion: 'v.pra' }]])
})

test('1,000 steps in 10 s write at most one row; the client moveSequence never becomes the seq (case 22)', async () => {
  const { store, run, actor, join, journal } = setup()
  const s = await join(A)
  const a = actor()
  for (let i = 0; i < 1_000; i++) { a.tx = i % 7; a.moveSequence = 2 ** 53 - 1; journal.note(s, a); await run(10) }
  await run(CHECKPOINT_MS + CHECKPOINT_JITTER_MS)
  assert.equal(store.batches.flat().length, 1)
  assert.equal(store.batches[0][0].seq, 1)
})

test('a portal or a disconnect is urgent: the next tick sends it', async () => {
  const { store, run, actor, join, journal } = setup()
  const s = await join(A)
  journal.note(s, actor('cueva-inicial', 10, 11), { urgent: true })
  await run(0)
  assert.equal(store.batches.length, 1)
  journal.endSession(s, actor('cueva-inicial', 9, 11))
  await run(0)
  assert.deepEqual(store.rows.get(A).location, { areaId: 'cueva-inicial', tx: 9, ty: 11, layoutVersion: 'v.cue' })
})

test('moves while a batch is in flight coalesce into one slot; the newest goes next with a higher seq', async () => {
  const store = fakeStore()
  let release
  let calls = 0
  const save = store.locationSave
  store.locationSave = async batch => { calls++; await new Promise(resolve => { release = resolve }); return save(batch) }
  const { journal, actor, join, clock } = setup({ store })
  const s = await join(A)
  const a = actor('pradera', 1, -60)
  journal.note(s, a, { urgent: true })
  journal.tick(); await settle()
  for (let x = 2; x <= 50; x++) { a.tx = x; journal.note(s, a) }
  assert.equal(journal.stats().pending, 1, 'one slot per player, however many moves')
  journal.tick(); await settle()
  assert.equal(calls, 1, 'a single batch in flight at a time')
  release(); await settle(); await journal.idle()
  clock.advance(CHECKPOINT_MS + CHECKPOINT_JITTER_MS)
  journal.tick(); await settle(); release(); await journal.idle()
  assert.deepEqual(store.batches.map(b => [b[0].seq, b[0].tx]), [[1, 1], [2, 50]])
})

test('a failed batch backs off 1 s, 2 s, 4 s … and retries the same location with the same seq', async () => {
  const { store, run, actor, join, journal } = setup()
  const s = await join(A)
  journal.note(s, actor('pradera', 3, -60), { urgent: true })
  store.down = true
  await run(0)
  await run(999)
  assert.equal(store.batches.length, 1, 'nothing before the first backoff')
  await run(1)
  await run(1_999)
  assert.equal(store.batches.length, 2)
  await run(1)
  assert.equal(store.batches.length, 3)
  assert.ok(journal.stats().backoffMs > 0)
  store.down = false
  await run(4_000)
  assert.deepEqual(store.batches.map(b => b[0].seq), [1, 1, 1, 1])
  assert.equal(store.rows.get(A).seq, 1)
  assert.equal(journal.stats().pending, 0)
})

test('a batch the database applied but whose answer was lost comes back "duplicate" and is confirmed', async () => {
  const { store, run, actor, join, journal } = setup()
  const s = await join(A)
  journal.note(s, actor('pradera', 3, -60), { urgent: true })
  store.applyThenFail = true
  await run(0)
  assert.equal(store.rows.get(A).seq, 1, 'the database did apply it')
  await run(1_000)
  assert.equal(journal.stats().saves.duplicate, 1)
  assert.equal(journal.stats().pending, 0)
})

test('a location that changed while its batch failed gets a NEW seq (a duplicate never hides new data)', async () => {
  const { store, run, actor, join, journal } = setup()
  const s = await join(A)
  const a = actor('pradera', 3, -60)
  journal.note(s, a, { urgent: true })
  store.applyThenFail = true
  await run(0)
  a.tx = 4; journal.note(s, a, { urgent: true })
  await run(1_000)
  assert.deepEqual(store.batches.map(b => [b[0].seq, b[0].tx]), [[1, 3], [2, 4]])
  assert.equal(store.rows.get(A).location.tx, 4)
})

test('a batch is read per user: applied confirms only its user, stale fences only its user, unknown retries only its user', async () => {
  const { store, run, actor, join, journal, fenced } = setup()
  const sa = await join(A), sb = await join(B), sc = await join(C)
  for (const s of [sa, sb, sc]) journal.note(s, actor('pradera', 5, -60), { urgent: true })
  store.rows.get(B).epoch = 9 // B claimed again elsewhere
  store.lose.add(C) // C's answer is missing from the reply
  await run(0)
  assert.deepEqual(fenced, [{ userId: B, epoch: 1 }])
  assert.equal(journal.statusOf(sa), 'claimed')
  assert.equal(journal.statusOf(sb), 'fenced')
  store.lose.clear()
  await run(0)
  assert.deepEqual(store.batches.map(b => b.map(r => r.userId)), [[A, B, C], [C]], 'only C is retried')
  assert.equal(store.batches[1][0].seq, store.batches[0][2].seq, 'same location, same seq')
  // The fenced writer never writes again.
  journal.note(sb, actor('pradera', 6, -60), { urgent: true })
  await run(CHECKPOINT_MS * 3)
  assert.equal(store.batches.flat().filter(r => r.userId === B).length, 1)
})

test('"invalid" for one row drops that row only; a stale answer for an OLD epoch never fences the new session', async () => {
  const { store, run, actor, join, journal, fenced } = setup()
  const sa = await join(A), sb = await join(B)
  journal.note(sa, actor('pradera', 1, -60), { urgent: true })
  journal.note(sb, actor('pradera', 1, -60), { urgent: true })
  store.override.set(A, 'invalid')
  await run(0)
  assert.equal(journal.stats().saves.invalid, 1)
  assert.equal(store.rows.get(B).seq, 1)
  store.override.clear()
  // B's batch is in flight when B reconnects here (new session, epoch 2): its answer is stale for epoch 1.
  let release
  const save = store.locationSave
  store.locationSave = async batch => { await new Promise(resolve => { release = resolve }); return save(batch) }
  journal.note(sb, actor('pradera', 2, -60), { urgent: true })
  journal.tick(); await settle()
  const sb2 = journal.beginSession(B)
  store.locationSave = save
  await journal.claim(sb2)
  release(); await journal.idle(); await settle()
  assert.deepEqual(fenced, [])
  assert.equal(journal.statusOf(sb2), 'claimed')
  assert.equal(journal.stats().saves.staleOldEpoch, 1)
})

test('batches hold at most 200 rows; the rest go in the next ticks', async () => {
  const { store, run, actor, join, journal } = setup()
  for (let i = 0; i < 450; i++) { const s = await join(uid(100 + i)); journal.note(s, actor('pradera', i % 50, -60), { urgent: true }) }
  await run(0); await run(0); await run(0)
  assert.deepEqual(store.batches.map(b => b.length), [MAX_BATCH_ROWS, MAX_BATCH_ROWS, 50])
})

test('checkpoints of players who joined together are spread by their jitter', async () => {
  const { store, run, actor, join, journal } = setup()
  for (let i = 0; i < 100; i++) { const s = await join(uid(i)); journal.note(s, actor('pradera', i, -60)) }
  await run(CHECKPOINT_MS)
  const sizes = []
  for (let t = 0; t < CHECKPOINT_JITTER_MS; t += 500) { const before = store.batches.flat().length; await run(500); sizes.push(store.batches.flat().length - before) }
  assert.equal(store.batches.flat().length, 100)
  assert.ok(Math.max(...sizes) < 60, `no single tick carries everyone: ${sizes}`)
})

test('unclaimed: plays on, never saves, keeps one slot, retries the claim with a bounded backoff', async () => {
  const { store, run, actor, journal, claimed } = setup()
  store.claimDown = true
  const s = journal.beginSession(A)
  assert.deepEqual(await journal.claim(s), { status: 'failed' })
  assert.equal(journal.statusOf(s), 'unclaimed')
  const a = actor('pradera', 1, -60)
  for (let x = 0; x < 100; x++) { a.tx = x; journal.note(s, a, { urgent: x % 2 === 0 }) }
  assert.equal(journal.stats().pending, 1)
  const claimTimes = []
  for (let t = 0; t < 70_000; t += 250) { const before = store.claims.length; await run(250); if (store.claims.length > before) claimTimes.push(t + 250) }
  assert.equal(store.batches.length, 0, 'no location_save without a claim')
  const gaps = claimTimes.map((t, i) => t - (claimTimes[i - 1] ?? 0))
  assert.ok(gaps.every(g => g >= 1_000 && g <= BACKOFF_MAX_MS + 500), `bounded backoff: ${gaps}`)
  assert.ok(gaps.at(-1) >= 16_000, 'it backs off')
  store.claimDown = false
  await run(BACKOFF_MAX_MS + 500)
  assert.equal(journal.statusOf(s), 'claimed')
  assert.ok(claimed.includes('claimed'))
  await run(0)
  assert.deepEqual(store.batches.flat().map(r => r.tx), [99], 'only the latest position, once claimed')
})

test('an unclaimed session that disconnects drops its slot (it could only write by fencing someone)', async () => {
  const { store, run, actor, journal } = setup()
  store.claimDown = true
  const s = journal.beginSession(A)
  await journal.claim(s)
  journal.endSession(s, actor('cueva-inicial', 10, 10))
  assert.equal(journal.stats().dropped.unclaimed, 1)
  const claims = store.claims.length
  await run(60_000)
  assert.equal(store.claims.length, claims, 'no claim retries for a session that left')
  assert.equal(store.batches.length, 0)
})

test('claims of one player are chained: the newest session always gets the highest epoch (double reconnect)', async () => {
  const store = fakeStore()
  const gates = []
  store.claimGate = () => new Promise(resolve => gates.push(resolve))
  const { journal } = setup({ store })
  const first = journal.beginSession(A)
  const firstClaim = journal.claim(first)
  await settle() // the first claim is in flight
  const second = journal.beginSession(A)
  const secondClaim = journal.claim(second)
  await settle()
  assert.equal(gates.length, 1, 'the second claim waits for the first')
  gates.shift()(); await settle(); await settle()
  gates.shift()()
  assert.deepEqual(await firstClaim, { status: 'superseded' })
  assert.equal((await secondClaim).epoch, 2)
  assert.equal(second.epoch, 2)
  assert.equal(journal.statusOf(first), 'replaced')
})

// ── Abandoned or out-of-order claims (review B2) ───────────────────────────

test('conflict: a claim reads the current epoch and claims after it (another instance claimed meanwhile)', async () => {
  const { journal, store, join } = setup()
  store.rows.set(A, { epoch: 5, seq: 3, location: null })
  const s = await join(A)
  assert.equal(s.epoch, 6)
  assert.deepEqual(store.expectations, [0, 5])
  assert.equal(journal.stats().claims.conflicts, 1)
  // The process now knows the epoch: the next session of this player needs one call.
  journal.endSession(s, null)
  const again = journal.beginSession(A)
  await journal.claim(again)
  assert.deepEqual(store.expectations, [0, 5, 6])
  assert.equal(again.epoch, 7)
})

test('an entry is kept while one of its claims is in flight: a new session after a hung claim is chained after it', async () => {
  const store = fakeStore()
  const gates = []
  store.claimGate = () => new Promise(resolve => gates.push(resolve))
  const { journal } = setup({ store })
  const first = journal.beginSession(A)
  const firstClaim = journal.claim(first)
  await settle()
  journal.endSession(first, null) // its socket goes while the claim is pending
  assert.equal(journal.entries.has(A), true, 'not forgotten: a claim of it is still pending')
  const second = journal.beginSession(A)
  const secondClaim = journal.claim(second)
  await settle()
  assert.equal(store.claims.length, 1, 'the new claim waits for the pending one')
  gates.shift()() // the first claim lands (epoch 1), for a session that is gone
  assert.deepEqual(await firstClaim, { status: 'superseded' })
  await settle(); await settle()
  gates.shift()()
  assert.equal((await secondClaim).epoch, 2, 'the live session claims after it')
  assert.deepEqual(store.expectations, [0, 1])
})

test('a claim given up (claimWaitMs) that lands in the store late never displaces the live session (R2)', async () => {
  const store = fakeStore()
  const late = []
  // The first call never answers, but its operation still runs later (an aborted fetch, a slow database).
  store.locationClaim = async (userId, expectedEpoch) => {
    store.claims.push(userId)
    if (late.length === 0 && store.claims.length === 1) { late.push(() => store.claimNow(userId, expectedEpoch)); return new Promise(() => {}) }
    return store.claimNow(userId, expectedEpoch)
  }
  const { journal, run, actor } = setup({ store, claimWaitMs: 20 })
  const first = journal.beginSession(A)
  // The give-up timer is unref'd and the hung call holds no socket: keep the loop alive (Node 22).
  const alive = setInterval(() => {}, 1_000)
  const given = await journal.claim(first).finally(() => clearInterval(alive))
  assert.deepEqual(given, { status: 'failed' })
  assert.equal(journal.stats().claims.abandoned, 1)
  journal.endSession(first, null)
  const second = journal.beginSession(A)
  assert.equal((await journal.claim(second)).epoch, 1)
  assert.deepEqual(late.shift()(), { status: 'conflict', epoch: 1 }, 'the abandoned claim lands late and writes nothing')
  journal.note(second, actor('cueva-inicial'), { urgent: true })
  await run()
  assert.deepEqual(store.rows.get(A).location?.areaId, 'cueva-inicial')
  assert.equal(journal.stats().fenced, 0)
  assert.equal(journal.statusOf(second), 'claimed')
})

test('no claim is ever sent for a session that is no longer live, or no longer the current one', async () => {
  const { journal, store } = setup()
  const gone = journal.beginSession(A)
  journal.endSession(gone, null)
  assert.deepEqual(await journal.claim(gone), { status: 'superseded' })
  const replaced = journal.beginSession(B)
  journal.beginSession(B)
  assert.deepEqual(await journal.claim(replaced), { status: 'superseded' })
  assert.deepEqual(store.claims, [])
  // Between conflict rounds too: a session that ends after a conflict does not claim again.
  store.rows.set(C, { epoch: 4, seq: 0, location: null })
  const s = journal.beginSession(C)
  const original = store.locationClaim
  store.locationClaim = async (userId, expected) => { const answer = await original(userId, expected); journal.endSession(s, null); return answer }
  assert.deepEqual(await journal.claim(s), { status: 'superseded' })
  assert.deepEqual(store.expectations, [0], 'the conflict was read, and nothing was claimed after the session ended')
  assert.equal(store.rows.get(C).epoch, 4)
})

test('a claim that keeps meeting conflicts (a storm of other claims) fails after a few rounds and backs off', async () => {
  const { journal, store } = setup()
  let epoch = 10
  store.locationClaim = async (userId, expected) => { store.claims.push(userId); return { status: 'conflict', epoch: ++epoch } }
  const s = journal.beginSession(A)
  assert.deepEqual(await journal.claim(s), { status: 'failed' })
  assert.equal(store.claims.length, 3)
  assert.equal(journal.statusOf(s), 'unclaimed')
})

test('unknown user: no saves and no retries', async () => {
  const store = fakeStore()
  store.locationClaim = async () => ({ status: 'unknown_user' })
  const { journal, run, actor } = setup({ store })
  const s = journal.beginSession(A)
  await journal.claim(s)
  journal.note(s, actor(), { urgent: true })
  await run(60_000)
  assert.equal(journal.statusOf(s), 'disabled')
  assert.equal(store.batches.length, 0)
})

test('memory is bounded: the oldest disconnected players are evicted (counted), live ones never', async () => {
  const { journal, store, actor, join, clock } = setup({ maxEntries: 5 })
  store.down = true
  const live = []
  for (let i = 0; i < 3; i++) live.push(await join(uid(i)))
  for (let i = 3; i < 10; i++) { const s = await join(uid(i)); journal.endSession(s, actor('pradera', i, -60)); clock.advance(1) }
  assert.ok(journal.stats().entries <= 5)
  assert.equal(journal.stats().dropped.evicted, 5)
  for (const s of live) assert.equal(journal.statusOf(s), 'claimed')
})

test('an area that is not saved (a Dungeon floor, an unknown area) writes nothing; an unchanged location is not rewritten', async () => {
  const { store, run, actor, join, journal } = setup()
  const s = await join(A)
  journal.note(s, actor('dg:cueva-inicial:1', 3, 3), { urgent: true })
  await run(0)
  assert.equal(store.batches.length, 0)
  journal.note(s, actor('pradera', 1, -60), { urgent: true })
  await run(0)
  journal.note(s, actor('pradera', 1, -60), { urgent: true })
  await run(0)
  assert.equal(store.batches.length, 1)
  assert.equal(journal.stats().saves.unchanged, 1)
})

test('rows outside the column bounds are never sent', async () => {
  const { store, run, actor, join, journal } = setup()
  const s = await join(A)
  journal.note(s, actor('pradera', 5000, -60), { urgent: true })
  await run(0)
  assert.equal(store.batches.length, 0)
  assert.equal(journal.stats().dropped.invalid, 1)
})

test('flushAll (shutdown): sends everything pending at once; never waits past its deadline on a hung authority', async () => {
  const { store, actor, join, journal } = setup()
  for (let i = 0; i < 250; i++) { const s = await join(uid(i)); journal.note(s, actor('pradera', i % 40, -60)) }
  const done = await journal.flushAll(3_000)
  assert.deepEqual(done, { sent: 250, left: 0, timedOut: false })
  assert.deepEqual(store.batches.map(b => b.length), [200, 50])
  const hung = setup()
  const s = await hung.join(A)
  hung.journal.note(s, hung.actor(), { urgent: true })
  hung.store.hang = true
  // A hung authority holds no handle here (a real one holds its socket); the
  // journal's own deadline timer is unref'd, so keep the loop alive (Node 22).
  const alive = setInterval(() => {}, 1_000)
  const started = Date.now()
  const result = await hung.journal.flushAll(50).finally(() => clearInterval(alive))
  assert.equal(result.timedOut, true)
  assert.ok(Date.now() - started < 1_000)
})

test('disable (rollback to off at runtime): no claim and no save leaves the process afterwards', async () => {
  const { store, run, actor, join, journal } = setup()
  const s = await join(A)
  journal.note(s, actor(), { urgent: true })
  journal.disable()
  await run(60_000)
  const s2 = journal.beginSession(B)
  assert.deepEqual(await journal.claim(s2), { status: 'superseded' })
  assert.equal(store.batches.length, 0)
  assert.deepEqual(store.claims, [A])
})

test('stats are aggregates only: no user id, area or tile', async () => {
  const { run, actor, join, journal } = setup()
  const s = await join(A)
  journal.note(s, actor('cueva-inicial', 1234, 4321), { urgent: true })
  await run(0)
  const text = JSON.stringify(journal.stats())
  assert.doesNotMatch(text, /aaaaaaaa|cueva|pradera|1234|4321/)
})
