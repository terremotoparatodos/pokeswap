import test from 'node:test'
import assert from 'node:assert/strict'
import { world } from './testing/hostAuthority.js'

// WORLD LOCATION-4, review N5: an acquire or activate answer that arrives after the host was
// stopped, drained or displaced never brings it back. The database may already have applied the
// call (an acquired row, an activated host): that exact identity is closed by a bounded cleanup and
// never renewed; no later identity is touched. Barriers (`hold`) apply a call in the authority at
// once and keep its answer until the test releases it.

const tick = () => new Promise(resolve => setImmediate(resolve))
// `settled()` is optional so the same file runs as a negative control against a build without it.
const settle = async h => { for (let i = 0; i < 50; i++) { await h.settled?.(); await tick() } }
const callsAfter = (w, mark) => w.calls.slice(mark)

/** A host whose first acquire failed: unavailable, recovering in the background. */
async function recovering(w) {
  const h = w.host()
  w.authority.down = true
  assert.equal(await h.acquire({ waitMs: 0 }), 'unavailable')
  w.authority.down = false
  return h
}

/** Asserts the host never comes back: no state, admission, readiness, renewal or activation after `mark`. */
function assertNoResurrection(w, h, mark, label) {
  assert.equal(h.state, 'stopped', `${label}: stays stopped`)
  assert.equal(h.admitting, false, `${label}: never admits (no ready, no joins)`)
  assert.equal(h.canClaim, false, `${label}: never claims`)
  assert.equal(h.sessionKey(), null, `${label}: never hands out a session key`)
  const after = callsAfter(w, mark)
  assert.ok(!after.includes('renew'), `${label}: no renewal after the transition (${after})`)
  assert.ok(!after.includes('activate'), `${label}: no activation after the transition (${after})`)
  assert.ok(![...w.hosts.values()].some(row => row.state === 'active'), `${label}: no active host left in the authority`)
}

for (const ending of ['stop', 'displace']) {
  test(`N5-${ending === 'stop' ? 1 : 2}: acquire in flight → ${ending} → the answer: no resurrection; the acquired identity is closed`, async () => {
    const w = world()
    const h = await recovering(w)
    const gate = w.hold('acquire')
    await w.until(() => gate.applied)
    assert.equal(gate.applied, true, 'the database applied the acquire (a starting row exists)')
    const mark = w.calls.length
    await (ending === 'stop' ? h.stop() : h.displace())
    gate.release()
    await settle(h)
    assertNoResurrection(w, h, mark, ending)
    const late = w.hosts.get([...w.hosts.keys()].at(-1))
    assert.equal(late.generation, gate.answer.generation)
    assert.equal(late.state, 'stopped', 'the late identity is closed by the cleanup (else its lease runs out unrenewed)')
    assert.equal(h.counters.lateAnswers, 1)
    if (ending === 'displace') assert.equal(h.displaced, true)
  })
}

for (const ending of ['stop', 'displace']) {
  test(`N5-${ending === 'stop' ? 3 : 4}: activate applied, its answer held → ${ending}: never active locally; that exact identity ends stopped`, async () => {
    const w = world()
    const h = w.host()
    await h.acquire()
    const identity = { ...h.identity }
    const gate = w.hold('activate')
    const activating = h.activate()
    await w.until(() => gate.applied)
    assert.equal(w.hosts.get(identity.hostId).state, 'active', 'the database activated it')
    const mark = w.calls.length
    const ended = ending === 'stop' ? h.stop() : h.displace()
    gate.release()
    await activating; await ended
    await settle(h)
    assertNoResurrection(w, h, mark, ending)
    assert.equal(w.hosts.get(identity.hostId).state, 'stopped')
    assert.equal(callsAfter(w, mark).filter(c => c === 'stop').length, 1, 'closed once (no duplicate cleanup)')
  })
}

test('N5-5: drain during the background recovery (acquire in flight): stopped; the late identity is closed, never activated', async () => {
  const w = world()
  const h = await recovering(w)
  const gate = w.hold('acquire')
  await w.until(() => gate.applied)
  const mark = w.calls.length
  assert.equal(await h.drain(), 'stopped')
  gate.release()
  await settle(h)
  assertNoResurrection(w, h, mark, 'drain')
  assert.equal(w.hosts.get([...w.hosts.keys()].at(-1)).state, 'stopped')
})

test('N5-6: a renewal of an earlier identity answers after the host moved to a new one: it never resets, pauses or stops the new identity', async () => {
  const w = world()
  const h = w.host()
  await h.acquire(); await h.activate()
  const old = { ...h.identity }
  w.forget(old.hostId) // the database lost it: every answer about it is unknown_host
  const gate = w.hold('renew')
  const renewing = h.renew()
  await w.until(() => gate.applied)
  // Meanwhile a claim of the CURRENT identity learned the loss: a new identity is taken.
  h.observe({ status: 'unknown_host' }, old)
  assert.equal(h.state, 'unavailable')
  await w.until(() => h.generation !== null)
  const fresh = h.generation
  gate.release() // the old renewal's unknown_host arrives now
  await renewing
  await w.until(() => h.state === 'active')
  await settle(h)
  assert.equal(h.state, 'active')
  assert.equal(h.generation, fresh, 'the new identity survives the old answer')
  assert.equal(h.counters.identityResets, 1, 'exactly one reset: the confirmed loss')
  assert.equal(h.admitting, true)
  await h.stop(); await settle(h)
})

test('N5-7: an acquire of the recovery that FAILS after the stop never puts the host back to unavailable (nor recovering again)', async () => {
  const w = world()
  const h = await recovering(w)
  let fail = null
  const real = w.store.presenceAcquire
  w.store.presenceAcquire = () => new Promise((_, reject) => { fail = reject }) // a request that times out late
  await w.until(() => fail !== null)
  const mark = w.calls.length
  await h.stop()
  w.store.presenceAcquire = real
  fail(new Error('timeout')) // the transport failure arrives after the stop
  await settle(h)
  assertNoResurrection(w, h, mark, 'stop, then a failed acquire')
  assert.ok(!callsAfter(w, mark).includes('acquire'), 'the recovery does not try again')
})

test('N5: an acquire answer after the stop never blocks the lane and leaves no pending work', async () => {
  const w = world()
  const h = await recovering(w)
  const gate = w.hold('acquire')
  await w.until(() => gate.applied)
  await h.stop()
  w.authority.failing.add('stop') // the cleanup cannot reach the authority: bounded, then the lease runs out
  gate.release()
  await settle(h)
  assert.equal(h.state, 'stopped')
  const late = w.hosts.get([...w.hosts.keys()].at(-1))
  assert.equal(late.state, 'starting', 'cleanup failed: the row stays as it was')
  w.clock.t += 60_000
  assert.ok(late.lease <= w.clock.t, 'never renewed: its lease runs out on its own')
  const stops = w.calls.filter(c => c === 'stop').length
  assert.ok(stops >= 1 && stops <= 3, `bounded cleanup attempts (${stops})`)
  let done = false
  void h.settled?.().then(() => { done = true })
  await tick(); await tick()
  assert.equal(done, true, 'the lane is free')
})
