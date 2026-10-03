import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BACKOFF_MAX_MS, CHECKPOINT_JITTER_MS, CHECKPOINT_MS, LocationJournal, MAX_BATCH_ROWS, MAX_CLAIM_ATTEMPTS, backoffMs, jitterFor, persistableIdentity,
} from './locationJournal.js'
import { activeHost } from './hostLifecycle.js'
import { manualClock, settle, within } from '../world/testing.js'

// WORLD LOCATION-2/4: the journal on a fake store that applies the same rules as the
// ordering migration: world_location_claim_keyed (a strictly greater key takes the row, the
// same key adopts it, a smaller one is superseded; only from an active host) and
// world_location_save_keyed (epoch + seq CAS, the writer must own the row).

const uid = n => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`
const A = uid(1), B = uid(2), C = uid(3)
const locate = actor => ['ciudad-corazon', 'pradera', 'cueva-inicial'].includes(actor.areaId)
  ? { areaId: actor.areaId, tx: actor.tx, ty: actor.ty, layoutVersion: `v.${actor.areaId.slice(0, 3)}` } : null
const greater = (a, b) => a.generation > b.og || (a.generation === b.og && a.seq > b.os)

function fakeStore() {
  const rows = new Map()
  /** generation → { state, leaseLive }: hosts the store knows; absent = active. */
  const hosts = new Map()
  const hostOf = generation => hosts.get(generation) ?? { state: 'active', leaseLive: true }
  const newerActive = generation => [...hosts.entries()].some(([g, h]) => g > generation && h.state === 'active' && h.leaseLive)
  const store = {
    rows, hosts, claims: [], keys: [], batches: [],
    down: false, hang: false, claimDown: false, lose: new Set(), override: new Map(),
    async locationClaim(userId, key) {
      store.claims.push(userId)
      store.keys.push({ ...key })
      if (store.claimDown) throw new Error('authority down')
      if (store.claimGate) await store.claimGate(userId, key)
      return store.claimNow(userId, key)
    },
    /** world_location_claim_keyed. */
    claimNow(userId, key) {
      const host = hostOf(key.generation)
      if (host.state !== 'active') return { status: 'host_inactive', state: host.state }
      if (!host.leaseLive) return { status: 'host_expired' }
      const row = rows.get(userId) ?? { epoch: 0, seq: 0, location: null, og: 0, os: 0, session: null }
      if (greater(key, row)) {
        const next = { ...row, epoch: row.epoch + 1, seq: 0, og: key.generation, os: key.seq, session: key.sessionId }
        rows.set(userId, next)
        return { status: 'claimed', epoch: next.epoch, location: next.location, newerActive: newerActive(key.generation) }
      }
      if (row.og === key.generation && row.os === key.seq) {
        if (row.session !== key.sessionId) throw new Error('key_reused')
        return { status: 'claimed', epoch: row.epoch, location: row.location, newerActive: newerActive(key.generation) }
      }
      return { status: 'superseded', newerActive: newerActive(key.generation) }
    },
    async locationSave(batch, writer) {
      store.batches.push(batch.map(r => ({ ...r })))
      if (store.hang) return new Promise(() => {})
      if (store.down) throw new Error('authority down')
      const host = hostOf(writer.generation)
      if (host.state === 'starting' || host.state === 'stopped') return { status: 'host_inactive', state: host.state }
      if (!host.leaseLive) return { status: 'host_expired', state: host.state }
      const results = new Map()
      for (const r of batch) {
        const row = rows.get(r.userId)
        let result
        if (!row || row.epoch !== r.epoch || row.og !== writer.generation) result = 'stale'
        else if (r.seq <= row.seq) result = 'duplicate'
        else { row.seq = r.seq; row.location = { areaId: r.areaId, tx: r.tx, ty: r.ty, layoutVersion: r.layoutVersion }; result = 'applied' }
        if (store.override.has(r.userId)) result = store.override.get(r.userId)
        if (!store.lose.has(r.userId)) results.set(r.userId, result)
      }
      if (store.applyThenFail) { store.applyThenFail = false; throw new Error('timeout after commit') }
      return { status: 'ok', results, newerActive: newerActive(writer.generation) }
    },
  }
  return store
}

function setup(options = {}) {
  const clock = manualClock(1_000_000)
  const store = options.store ?? fakeStore()
  const host = options.host ?? activeHost({ generation: 1 })
  const observed = []
  const observe = host.observe.bind(host)
  host.observe = answer => { observed.push(answer); observe(answer) }
  const fenced = []
  const claimed = []
  const journal = new LocationJournal({
    store, host, locate, now: clock.now, log: () => {},
    onFenced: (userId, epoch) => fenced.push({ userId, epoch }), onClaimed: (session, result) => claimed.push(result.status), ...options.journal,
  })
  const run = async (ms = 0) => { clock.advance(ms); journal.tick(); await settle(); await journal.idle(); await settle() }
  const actor = (areaId = 'pradera', tx = 0, ty = -60) => ({ areaId, tx, ty, dir: 'down', moveSequence: 0 })
  const begin = userId => journal.beginSession(userId, host.sessionKey())
  const join = async userId => { const s = begin(userId); await journal.claim(s); return s }
  return { clock, store, host, journal, run, actor, begin, join, fenced, claimed, observed }
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

test('initial claim: one call with the session key, epoch 1, then a checkpoint only after 10 s + jitter', async () => {
  const { journal, store, run, actor, join } = setup()
  const s = await join(A)
  assert.equal(s.epoch, 1)
  assert.equal(journal.statusOf(s), 'claimed')
  assert.equal(store.claims.length, 1, 'one round trip per join (no conflict read)')
  assert.deepEqual(store.keys[0], s.key)
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
  store.locationSave = async (batch, writer) => { calls++; await new Promise(resolve => { release = resolve }); return save(batch, writer) }
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
  store.rows.get(B).epoch = 9 // B was taken by a greater key elsewhere
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
  const { store, run, actor, join, journal, fenced, begin } = setup()
  const sa = await join(A), sb = await join(B)
  journal.note(sa, actor('pradera', 1, -60), { urgent: true })
  journal.note(sb, actor('pradera', 1, -60), { urgent: true })
  store.override.set(A, 'invalid')
  await run(0)
  assert.equal(journal.stats().saves.invalid, 1)
  assert.equal(store.rows.get(B).seq, 1)
  store.override.clear()
  // B's batch is in flight when B reconnects here (new session, greater key): its answer is stale for epoch 1.
  let release
  const save = store.locationSave
  store.locationSave = async (batch, writer) => { await new Promise(resolve => { release = resolve }); return save(batch, writer) }
  journal.note(sb, actor('pradera', 2, -60), { urgent: true })
  journal.tick(); await settle()
  const sb2 = begin(B)
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

// ── Claims by key (WORLD LOCATION-4) ───────────────────────────────────────

test('unclaimed: plays on, never saves, keeps one slot, retries with the SAME key and a bounded backoff, then gives up', async () => {
  const { store, run, actor, journal, claimed, begin } = setup()
  store.claimDown = true
  const s = begin(A)
  assert.deepEqual(await journal.claim(s), { status: 'failed' })
  assert.equal(journal.statusOf(s), 'unclaimed')
  const a = actor('pradera', 1, -60)
  for (let x = 0; x < 100; x++) { a.tx = x; journal.note(s, a, { urgent: x % 2 === 0 }) }
  assert.equal(journal.stats().pending, 1)
  const claimTimes = []
  for (let t = 0; t < 120_000; t += 250) { const before = store.claims.length; await run(250); if (store.claims.length > before) claimTimes.push(t + 250) }
  assert.equal(store.batches.length, 0, 'no location_save without a claim')
  assert.equal(store.claims.length, MAX_CLAIM_ATTEMPTS, 'bounded: never retried forever')
  assert.ok(store.keys.every(k => JSON.stringify(k) === JSON.stringify(s.key)), 'every retry carries the same key')
  const gaps = claimTimes.map((t, i) => t - (claimTimes[i - 1] ?? 0))
  assert.ok(gaps.every(g => g >= 1_000 && g <= BACKOFF_MAX_MS + 500), `bounded backoff: ${gaps}`)
  assert.equal(journal.statusOf(s), 'unpersisted')
  assert.equal(journal.stats().pending, 0)
  assert.ok(claimed.every(c => c === 'failed'))
})

test('unclaimed, then the authority comes back: the retry (same key) claims and only the latest position is saved', async () => {
  const { store, run, actor, journal, begin } = setup()
  store.claimDown = true
  const s = begin(A)
  await journal.claim(s)
  const a = actor('pradera', 1, -60)
  for (let x = 0; x < 10; x++) { a.tx = x; journal.note(s, a, { urgent: true }) }
  store.claimDown = false
  await run(1_500)
  assert.equal(journal.statusOf(s), 'claimed')
  await run(0)
  assert.deepEqual(store.batches.flat().map(r => r.tx), [9])
})

test('an unclaimed session that disconnects drops its slot (it owns no row)', async () => {
  const { store, run, actor, journal, begin } = setup()
  store.claimDown = true
  const s = begin(A)
  await journal.claim(s)
  journal.endSession(s, actor('cueva-inicial', 10, 10))
  assert.equal(journal.stats().dropped.unclaimed, 1)
  const claims = store.claims.length
  await run(60_000)
  assert.equal(store.claims.length, claims, 'no claim retries for a session that left')
  assert.equal(store.batches.length, 0)
})

test('a lost answer: the retry with the same key adopts the claim the database already made (same epoch, no bump)', async () => {
  const store = fakeStore()
  const original = store.locationClaim
  let lose = true
  store.locationClaim = async (userId, key) => { const answer = await original(userId, key); if (lose) { lose = false; throw new Error('answer lost') } return answer }
  const { journal, run, begin } = setup({ store })
  const s = begin(A)
  assert.deepEqual(await journal.claim(s), { status: 'failed' })
  assert.equal(store.rows.get(A).epoch, 1, 'the database applied it')
  await run(1_500)
  assert.equal(journal.statusOf(s), 'claimed')
  assert.equal(s.epoch, 1, 'adopted: the same epoch')
  assert.equal(store.rows.get(A).epoch, 1)
})

test('superseded is final: no re-read, no new key, no further claim, no save', async () => {
  const { journal, store, run, actor, begin, claimed } = setup()
  // A greater key (another host's newer session) already owns the row.
  store.rows.set(A, { epoch: 7, seq: 2, location: null, og: 5, os: 1, session: 'x' })
  const s = begin(A)
  assert.deepEqual(await journal.claim(s), { status: 'superseded' })
  assert.equal(journal.statusOf(s), 'superseded')
  journal.note(s, actor('pradera', 9, -60), { urgent: true })
  await run(120_000)
  assert.equal(store.claims.length, 1, 'never claimed again')
  assert.equal(store.batches.length, 0)
  assert.deepEqual(claimed, ['superseded'])
  assert.equal(store.rows.get(A).epoch, 7)
})

test('same process, double reconnect: the newer session (greater seq) owns the row whatever the order the claims land in', async () => {
  for (const order of ['older first', 'newer first']) {
    const store = fakeStore()
    const gates = new Map()
    store.claimGate = (userId, key) => new Promise(resolve => gates.set(key.seq, resolve))
    const { journal, begin } = setup({ store })
    const older = begin(A)
    const olderClaim = journal.claim(older)
    const newer = begin(A) // accepted after: replaces the older one in this process
    const newerClaim = journal.claim(newer)
    await settle()
    assert.equal(gates.size, 2, 'claims are not chained: both are in flight')
    const [first, second] = order === 'older first' ? [older, newer] : [newer, older]
    gates.get(first.key.seq)(); await settle(); await settle()
    gates.get(second.key.seq)()
    await olderClaim; await newerClaim
    assert.equal(journal.statusOf(newer), 'claimed', order)
    assert.equal(store.rows.get(A).os, newer.key.seq, `${order}: the newer key owns the row`)
    assert.equal(journal.statusOf(older), 'replaced')
  }
})

// ── T3 / T4 / T7 at the journal: two hosts, one store ──────────────────────

function twoHosts() {
  const store = fakeStore()
  const P = setup({ store, host: activeHost({ generation: 1 }) }) // the old instance
  const Q = setup({ store, host: activeHost({ generation: 2 }) }) // the current one
  return { store, P, Q }
}

for (const [name, schedule] of Object.entries({
  // T3: the old session's claim is in flight while the new one claims on the other host.
  'T3 (old claim in flight)': async ({ store, P, Q }) => {
    let release
    store.claimGate = (userId, key) => key.generation === 1 ? new Promise(resolve => { release = resolve }) : null
    const a = P.begin(A); const aClaim = P.journal.claim(a)
    await settle()
    const b = Q.begin(A); await Q.journal.claim(b)
    release(); await aClaim
    return { a, b }
  },
  // T4: the old claim is abandoned (no answer), lands late, and its retry carries the same key.
  'T4 (old claim abandoned, lands late, retried)': async ({ store, P, Q }) => {
    const late = []
    let held = false
    const original = store.locationClaim
    store.locationClaim = async (userId, key) => {
      if (key.generation === 1 && !held) { held = true; store.keys.push({ ...key }); late.push(() => store.claimNow(userId, key)); return new Promise(() => {}) }
      return original(userId, key)
    }
    P.journal.claimWaitMs = 20
    const a = P.begin(A)
    assert.deepEqual(await within(P.journal.claim(a), 2_000, 'an abandoned claim'), { status: 'failed' })
    const b = Q.begin(A); await Q.journal.claim(b)
    assert.equal(late.shift()().status, 'superseded', 'the abandoned operation lands late and writes nothing')
    await P.run(1_500) // the retry, same key
    return { a, b }
  },
  // T7: natural latency, both orders.
  'T7 (old lands first)': async ({ P, Q }) => {
    const a = P.begin(A); await P.journal.claim(a)
    const b = Q.begin(A); await Q.journal.claim(b)
    return { a, b }
  },
  'T7 (new lands first)': async ({ P, Q }) => {
    const b = Q.begin(A); await Q.journal.claim(b)
    const a = P.begin(A); await P.journal.claim(a)
    return { a, b }
  },
})) {
  test(`${name}: the newer host's session owns the row; the old one never re-imposes, never writes after losing it`, async () => {
    const ctx = twoHosts()
    const { store, P, Q } = ctx
    const { a, b } = await schedule(ctx)
    assert.equal(store.rows.get(A).og, 2, 'the row is the newer host\'s')
    assert.equal(Q.journal.statusOf(b), 'claimed')
    assert.ok(['superseded', 'claimed'].includes(P.journal.statusOf(a)))
    const epoch = store.rows.get(A).epoch
    // The old session keeps acting: none of it reaches the row.
    P.journal.note(a, P.actor('cueva-inicial', 1, 1), { urgent: true })
    await P.run(0); await P.run(CHECKPOINT_MS * 3)
    for (let i = 0; i < 5; i++) await P.run(BACKOFF_MAX_MS)
    Q.journal.note(b, Q.actor('pradera', 4, -60), { urgent: true })
    await Q.run(0)
    assert.equal(store.rows.get(A).epoch, epoch, 'no claim of the old session ever landed after the new one')
    assert.deepEqual(store.rows.get(A).location, { areaId: 'pradera', tx: 4, ty: -60, layoutVersion: 'v.pra' })
    assert.ok(store.keys.filter(k => k.generation === 1).every(k => JSON.stringify(k) === JSON.stringify(a.key)), 'the old session never claimed with another key')
    assert.notEqual(P.journal.statusOf(a), 'claimed', 'the old session ends superseded or fenced')
  })
}

// ── The host decides (WORLD LOCATION-4 C2) ─────────────────────────────────

test('no key (host not active, or no host): the session plays on unpersisted and never claims or saves', async () => {
  const host = activeHost({ generation: 3 })
  host.state = 'starting'
  const { journal, store, actor, run } = setup({ host })
  const s = journal.beginSession(A, host.sessionKey())
  assert.equal(s.key, null)
  assert.deepEqual(await journal.claim(s), { status: 'replaced' })
  journal.note(s, actor(), { urgent: true })
  await run(60_000)
  assert.equal(journal.statusOf(s), 'unpersisted')
  assert.equal(store.claims.length, 0)
  assert.equal(store.batches.length, 0)
  assert.equal(journal.stats().claims.noKey, 1)
})

test('host refusals: expired pauses (retried once the host can claim), inactive and unknown end it; none loops', async () => {
  const { journal, store, host, run, begin, observed } = setup()
  store.hosts.set(1, { state: 'active', leaseLive: false })
  const s = begin(A)
  assert.deepEqual(await journal.claim(s), { status: 'failed' })
  assert.equal(observed.at(-1).status, 'host_expired')
  assert.equal(host.canClaim, false, 'the host paused itself')
  await run(60_000)
  assert.equal(store.claims.length, 1, 'no claim while the host cannot claim')
  store.hosts.set(1, { state: 'active', leaseLive: true })
  host.paused = false
  await run(2_000)
  assert.equal(journal.statusOf(s), 'claimed')

  const second = setup()
  second.store.hosts.set(1, { state: 'stopped', leaseLive: false })
  const t = second.begin(B)
  await second.journal.claim(t)
  assert.equal(second.host.state, 'stopped')
  await second.run(120_000)
  assert.equal(second.store.claims.length, 1, 'an inactive host never claims again')
})

test('saves follow the host: refused batches are kept (expired) or dropped (inactive); a draining host flushes but never claims', async () => {
  const { journal, store, host, run, actor, join, begin } = setup()
  const s = await join(A)
  journal.note(s, actor('pradera', 2, -60), { urgent: true })
  store.hosts.set(1, { state: 'active', leaseLive: false })
  await run(0)
  assert.equal(journal.stats().saves.hostRefused, 1)
  assert.equal(journal.stats().pending, 1, 'expired: kept for when the lease revives')
  store.hosts.set(1, { state: 'draining', leaseLive: true })
  host.paused = false
  await host.drain()
  assert.equal(host.canSave, true)
  assert.equal(host.canClaim, false)
  const done = await journal.flushAll(3_000)
  assert.equal(done.applied, 1, 'the final flush of a row it owns')
  const late = begin(B)
  assert.equal(late.key, null, 'a draining host gives no keys')
  store.hosts.set(1, { state: 'stopped', leaseLive: false })
  journal.note(s, actor('pradera', 3, -60), { urgent: true })
  await journal.flushAll(3_000)
  assert.equal(journal.stats().dropped.hostInactive, 1, 'inactive: dropped and counted, not retried')
})

test('a host that cannot save sends nothing: paused (lease expired), starting or stopped', async () => {
  for (const state of ['paused', 'starting', 'stopped']) {
    const { journal, store, host, run, actor, join } = setup()
    const s = await join(A)
    journal.note(s, actor('pradera', 2, -60), { urgent: true })
    if (state === 'paused') host.paused = true
    else host.state = state
    await run(0); await run(5_000)
    assert.equal(store.batches.length, 0, state)
    assert.equal(journal.stats().pending, 1, state + ': kept, not lost')
  }
})

test('newerActive in any answer reaches the host once', async () => {
  const { journal, store, host, run, actor, join, observed } = setup()
  store.hosts.set(9, { state: 'active', leaseLive: true })
  const s = await join(A)
  journal.note(s, actor('pradera', 2, -60), { urgent: true })
  await run(0)
  assert.ok(observed.filter(o => o.newerActive).length >= 2, 'claim and save both report it')
  assert.equal(host.counters.newerActive, 1, 'the host acts on it once')
})

test('unknown user: no saves and no retries', async () => {
  const store = fakeStore()
  store.locationClaim = async () => ({ status: 'unknown_user' })
  const { journal, run, actor, begin } = setup({ store })
  const s = begin(A)
  await journal.claim(s)
  journal.note(s, actor(), { urgent: true })
  await run(60_000)
  assert.equal(journal.statusOf(s), 'disabled')
  assert.equal(store.batches.length, 0)
})

test('no claim is ever sent for a session that is no longer live, or no longer the current one', async () => {
  const { journal, store, begin } = setup()
  const gone = begin(A)
  journal.endSession(gone, null)
  assert.deepEqual(await journal.claim(gone), { status: 'replaced' })
  const replaced = begin(B)
  begin(B)
  assert.deepEqual(await journal.claim(replaced), { status: 'replaced' })
  assert.deepEqual(store.claims, [])
})

test('a claim given up (claimWaitMs) never hangs the journal', async () => {
  const store = fakeStore()
  store.locationClaim = async () => new Promise(() => {})
  const { journal, begin } = setup({ store, journal: { claimWaitMs: 20 } })
  const s = begin(A)
  const given = await within(journal.claim(s), 2_000, 'a claim on a hung store')
  assert.deepEqual(given, { status: 'failed' })
  assert.equal(journal.stats().claims.abandoned, 1)
})

test('memory is bounded: the oldest disconnected players are evicted (counted), live ones never', async () => {
  const { journal, store, actor, join, clock } = setup({ journal: { maxEntries: 5 } })
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

test('flushAll (shutdown): sends everything pending at once and counts applied vs stale; never waits past its deadline', async () => {
  const { store, actor, join, journal } = setup()
  const sessions = []
  for (let i = 0; i < 250; i++) { const s = await join(uid(i)); sessions.push(s); journal.note(s, actor('pradera', i % 40, -60)) }
  store.rows.get(uid(7)).epoch = 99 // one row was taken by a newer session meanwhile
  const done = await journal.flushAll(3_000)
  assert.deepEqual(done, { sent: 250, applied: 249, duplicate: 0, stale: 1, left: 0, timedOut: false })
  assert.deepEqual(store.batches.map(b => b.length), [200, 50])
  const hung = setup()
  const s = await hung.join(A)
  hung.journal.note(s, hung.actor(), { urgent: true })
  hung.store.hang = true
  const started = Date.now()
  const result = await within(hung.journal.flushAll(50), 2_000, 'flushAll on a hung authority')
  assert.equal(result.timedOut, true)
  assert.equal(result.left, 1)
  assert.ok(Date.now() - started < 1_000)
})

test('disable (rollback to off at runtime): no claim and no save leaves the process afterwards', async () => {
  const { store, run, actor, join, journal, begin } = setup()
  const s = await join(A)
  journal.note(s, actor(), { urgent: true })
  journal.disable()
  await run(60_000)
  const s2 = begin(B)
  assert.deepEqual(await journal.claim(s2), { status: 'replaced' })
  assert.equal(store.batches.length, 0)
  assert.deepEqual(store.claims, [A])
})

test('stats are aggregates only: no user id, area, tile or key', async () => {
  const { run, actor, join, journal } = setup()
  const s = await join(A)
  journal.note(s, actor('cueva-inicial', 1234, 4321), { urgent: true })
  await run(0)
  const text = JSON.stringify(journal.stats())
  assert.doesNotMatch(text, /aaaaaaaa|cueva|pradera|1234|4321/)
  assert.doesNotMatch(text, new RegExp(s.key.sessionId))
})
