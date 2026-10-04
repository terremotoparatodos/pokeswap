import test from 'node:test'
import assert from 'node:assert/strict'
import { world } from './testing/hostAuthority.js'
import { LocationJournal } from './locationJournal.js'

// WORLD LOCATION-4, review N6: answers are bound to the identity that sent them. After the host
// takes a new identity (generation 1 lost, recovered healthy as 2), nothing about generation 1 —
// unknown_host, host_inactive, host_expired, newerActive, a claim or a save still in flight — may
// reset, pause or displace generation 2; the sessions keyed by generation 1 lose their
// persistence (unpersisted, never fenced, never closed, never written under generation 2), and a
// new session of generation 2 keeps its authority. Real HostLifecycle and LocationJournal over
// the in-memory authority of testing/hostAuthority.js.

const tick = () => new Promise(resolve => setImmediate(resolve))
const user = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const actor = tx => ({ loc: { areaId: 'ciudad-corazon', tx, ty: 1, layoutVersion: 'v1' } })

async function setup() {
  const w = world()
  const newer = []
  const h = w.host({ onNewerActive: () => newer.push(w.clock.t) })
  await h.acquire(); await h.activate()
  const fenced = []
  const j = new LocationJournal({ store: w.store, host: h, locate: a => a.loc, now: () => w.clock.t, onFenced: (...args) => fenced.push(args), log: () => {}, claimWaitMs: 60_000 })
  const flush = async () => { j.tick(w.clock.t); await j.idle(); await tick() }
  const join = async (n, { claim = true } = {}) => { const s = j.beginSession(user(n), h.sessionKey()); if (claim) await j.claim(s); return s }
  const move = async (s, tx) => { j.note(s, actor(tx), { urgent: true }); await flush() }
  /** The database lost generation 1 (as `mode` holds it), the host learned it and recovered as a new identity. */
  const lose = async (mode = 'forgotten') => {
    const old = { ...h.identity }
    const row = w.hosts.get(old.hostId)
    if (mode === 'forgotten') w.forget(old.hostId)
    if (mode === 'stopped') row.state = 'stopped'
    if (mode === 'expired') row.lease = w.clock.t // active, lease run out
    // 'active': the old row stays active and live (it will see the new identity as newer)
    h.observe(mode === 'stopped' ? { status: 'host_inactive', state: 'stopped' } : { status: 'unknown_host' }, old) // the confirmed loss
    await w.until(() => h.state === 'active' && h.generation !== old.generation)
    for (let i = 0; i < 20; i++) { await h.settled?.(); await tick() }
    return old
  }
  return { w, h, j, fenced, newer, flush, join, move, lose }
}

for (const mode of ['forgotten', 'stopped', 'expired', 'active']) {
  const answer = { forgotten: 'unknown_host', stopped: 'host_inactive', expired: 'host_expired', active: 'newerActive' }[mode]
  test(`N6 (${answer}): generation 1 lost, healthy as 2; its old sessions never reset, pause or displace 2, are never fenced nor written under 2`, async () => {
    const t = await setup()
    const { w, h, j } = t
    const players = [await t.join(1), await t.join(2), await t.join(3)]
    for (const [i, s] of players.entries()) await t.move(s, 10 + i)
    w.authority.failing.add('claim')
    const unclaimed = await t.join(4) // a claim that failed: it would retry with its generation-1 key
    w.authority.failing.delete('claim')
    assert.equal(j.statusOf(unclaimed), 'unclaimed')
    const old = await t.lose(mode)
    const fresh = { ...h.identity }
    assert.notEqual(fresh.generation, old.generation)

    // Several ticks: the old sessions' retries and positions, and explicit old-identity answers.
    for (const [i, s] of players.entries()) j.note(s, actor(50 + i), { urgent: true })
    for (let round = 0; round < 8; round++) { w.clock.t += 5_000; await h.renew(); await t.flush() }
    h.observe({ status: 'unknown_host' }, old)
    h.observe({ status: 'host_inactive', state: 'stopped' }, old)
    h.observe({ status: 'host_expired' }, old)
    h.observe({ status: 'ok', newerActive: true }, old)
    await tick()

    assert.deepEqual({ ...h.identity }, fresh, 'generation 2 untouched')
    assert.equal(h.counters.identityResets, 1, 'exactly one reset: the confirmed loss')
    assert.equal(h.paused, false, 'never paused by an old answer')
    assert.equal(h.state, 'active')
    assert.deepEqual(t.newer, [], 'never displaced by an old newerActive')
    assert.deepEqual(t.fenced, [], 'no false fencing')
    for (const s of [...players, unclaimed]) assert.equal(j.statusOf(s), 'unpersisted')
    for (const n of [1, 2, 3]) {
      const row = w.rows.get(user(n))
      assert.equal(row.ownerGeneration, old.generation, 'still owned by generation 1 (nothing taken)')
      assert.equal(row.writtenBy, old.generation, 'never written under generation 2')
      assert.equal(row.location.tx, 10 + n - 1, 'the last position generation 1 saved')
    }

    // A new session of generation 2 keeps its authority.
    const renewed = await t.join(1)
    assert.equal(j.statusOf(renewed), 'claimed')
    await t.move(renewed, 77)
    const row = w.rows.get(user(1))
    assert.equal(row.ownerGeneration, fresh.generation)
    assert.equal(row.writtenBy, fresh.generation)
    assert.equal(row.location.tx, 77)
    assert.deepEqual(t.fenced, [])
    const stats = j.stats()
    assert.ok(stats.claims.identityLost >= 4, `the degraded sessions are counted (${stats.claims.identityLost})`)
    await h.stop()
  })
}

test('N6: a claim of generation 1 in flight when the identity is lost: its answer neither resets 2 nor gives the session persistence', async () => {
  const t = await setup()
  const { w, h, j } = t
  const gate = w.hold('claim', { late: true }) // reaches the database after the loss
  const s = j.beginSession(user(9), h.sessionKey())
  const claiming = j.claim(s)
  await w.until(() => gate.sent)
  const old = await t.lose('forgotten')
  gate.release()
  const result = await claiming
  assert.equal(gate.answer.status, 'unknown_host', 'the database answers about generation 1')
  assert.notEqual(result.status, 'claimed')
  assert.equal(j.statusOf(s), 'unpersisted')
  assert.equal(h.counters.identityResets, 1)
  assert.notEqual(h.generation, old.generation)
  j.note(s, actor(5), { urgent: true })
  await t.flush()
  assert.equal(w.rows.get(user(9)), undefined, 'nothing written for it, under any identity')
  await h.stop()
})

test('N6: a save of generation 1 in flight when the identity is lost: its refusal neither resets 2 nor fences the session', async () => {
  const t = await setup()
  const { w, h, j } = t
  const s = await t.join(11)
  await t.move(s, 20)
  const gate = w.hold('save', { late: true })
  j.note(s, actor(21), { urgent: true })
  j.tick(w.clock.t)
  await w.until(() => gate.sent)
  const old = await t.lose('forgotten')
  gate.release()
  await j.idle(); await tick()
  assert.equal(gate.answer.status, 'unknown_host')
  assert.equal(h.counters.identityResets, 1, 'the old batch refusal is about generation 1: ignored')
  assert.notEqual(h.generation, old.generation)
  assert.deepEqual(t.fenced, [])
  assert.equal(j.statusOf(s), 'unpersisted')
  j.note(s, actor(22), { urgent: true })
  await t.flush()
  assert.equal(w.rows.get(user(11)).location.tx, 20, 'the last position generation 1 saved; nothing under 2')
  await h.stop()
})

test('N6: a save of generation 1 that reaches the database after the loss and is answered stale: no fence, no close, unpersisted', async () => {
  const t = await setup()
  const { w, h, j } = t
  const s = await t.join(13)
  await t.move(s, 40)
  const gate = w.hold('save', { late: true })
  j.note(s, actor(41), { urgent: true })
  j.tick(w.clock.t)
  await w.until(() => gate.sent)
  const old = await t.lose('active') // generation 1's row stays active and live: the save passes the host gate
  w.rows.get(user(13)).ownerGeneration = old.generation + 50 // the owner CAS refuses it (the row is no longer generation 1's)
  gate.release()
  await j.idle(); await tick()
  assert.equal(gate.answer.results.get(user(13)), 'stale')
  assert.deepEqual(t.fenced, [], 'a stale caused by the lost identity never fences (no 4409)')
  assert.equal(j.statusOf(s), 'unpersisted')
  assert.equal(j.stats().saves.identityLost, 1)
  assert.equal(h.counters.identityResets, 1)
  await h.stop()
})

test('N6: a save of generation 1 applied but answered after the loss: counted, then the session is unpersisted (no fence)', async () => {
  const t = await setup()
  const { w, h, j } = t
  const s = await t.join(12)
  const gate = w.hold('save') // applied at once under generation 1, answered after the loss
  j.note(s, actor(30), { urgent: true })
  j.tick(w.clock.t)
  await w.until(() => gate.applied)
  await t.lose('active')
  gate.release()
  await j.idle(); await tick()
  assert.equal(w.rows.get(user(12)).location.tx, 30, 'written legitimately by generation 1 before the loss')
  assert.equal(h.counters.identityResets, 1)
  assert.deepEqual(t.newer, [], 'the answer carried newerActive about generation 1: ignored')
  assert.deepEqual(t.fenced, [])
  j.note(s, actor(31), { urgent: true })
  w.clock.t += 60_000
  await t.flush()
  assert.equal(j.statusOf(s), 'unpersisted')
  assert.equal(w.rows.get(user(12)).location.tx, 30)
  await h.stop()
})
