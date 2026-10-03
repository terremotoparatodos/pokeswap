import test from 'node:test'
import assert from 'node:assert/strict'
import { HOST_CALL_ATTEMPTS, HostLifecycle } from './hostLifecycle.js'

// WORLD LOCATION-4, review F3: activate, drain, stop and renew are serialized in this process,
// so it never holds two of the database's host locks at once (activate: a table lock; renew,
// drain, stop: a row lock). Barriers hold each store call open to force every crossing.

/** A store whose calls wait on barriers the test opens; every call and its order is recorded. */
function barrierStore() {
  const calls = []
  const gates = new Map()
  const answers = {
    presenceActivate: () => ({ status: 'active' }),
    presenceRenew: () => ({ status: 'ok', state: 'active', newerActive: false, leaseLive: true }),
    presenceDrain: () => ({ status: 'ok', state: 'draining' }),
    presenceStop: () => ({ status: 'ok', state: 'stopped' }),
  }
  const failures = {}
  const store = { calls, answers, failures, inFlight: 0, maxInFlight: 0 }
  for (const op of Object.keys(answers)) {
    store[op] = async () => {
      calls.push(op)
      store.inFlight++
      store.maxInFlight = Math.max(store.maxInFlight, store.inFlight)
      try {
        if (gates.has(op)) await gates.get(op).promise
        if (failures[op] > 0) { failures[op]--; throw Object.assign(new Error('deadlock detected'), { code: '40P01' }) }
        return answers[op]()
      } finally { store.inFlight-- }
    }
  }
  store.hold = op => { let open; const promise = new Promise(resolve => { open = resolve }); gates.set(op, { promise, open }) }
  store.open = op => { gates.get(op)?.open(); gates.delete(op) }
  return store
}

const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise(resolve => setImmediate(resolve)) }

function host(store, state = 'active', options = {}) {
  const h = new HostLifecycle({ store, renewMs: 60_000, log: () => {}, sleep: () => Promise.resolve(), ...options })
  h.generation = 7
  h.state = state
  return h
}

test('activate ↔ renew: activate waits for the renew in flight; a renew asked during activate does not start', async () => {
  const store = barrierStore()
  const h = host(store, 'starting')
  store.hold('presenceRenew')
  const renewing = h.renew()
  await settle()
  const activating = h.activate()
  await settle()
  assert.deepEqual(store.calls, ['presenceRenew'], 'activate has not started while the renew holds its lock')
  store.hold('presenceActivate')
  store.open('presenceRenew')
  await renewing
  await settle()
  assert.deepEqual(store.calls, ['presenceRenew', 'presenceActivate'])
  await h.renew() // asked while activate runs: skipped
  assert.deepEqual(store.calls, ['presenceRenew', 'presenceActivate'])
  store.open('presenceActivate')
  assert.equal(await activating, 'active')
  assert.equal(store.maxInFlight, 1, 'never two host calls at once')
})

test('drain ↔ renew: the drain call waits for the renew in flight; claims stop at once; no renew during the drain', async () => {
  const store = barrierStore()
  const h = host(store)
  store.hold('presenceRenew')
  const renewing = h.renew()
  await settle()
  const draining = h.drain()
  assert.equal(h.state, 'draining', 'local state changes at once')
  assert.equal(h.canClaim, false)
  await settle()
  assert.deepEqual(store.calls, ['presenceRenew'])
  store.hold('presenceDrain')
  store.open('presenceRenew')
  await renewing
  await settle()
  await h.renew()
  assert.deepEqual(store.calls, ['presenceRenew', 'presenceDrain'], 'no renew while the drain runs')
  store.open('presenceDrain')
  assert.equal(await draining, 'draining')
  assert.equal(store.maxInFlight, 1)
})

test('stop ↔ renew: stop is immediate locally, its call waits for the renew; nothing renews after', async () => {
  const store = barrierStore()
  const h = host(store)
  store.hold('presenceRenew')
  const renewing = h.renew()
  await settle()
  const stopping = h.stop()
  assert.equal(h.state, 'stopped')
  await settle()
  assert.deepEqual(store.calls, ['presenceRenew'])
  store.open('presenceRenew')
  await renewing
  assert.equal(await stopping, 'stopped')
  assert.deepEqual(store.calls, ['presenceRenew', 'presenceStop'])
  await h.renew()
  assert.deepEqual(store.calls, ['presenceRenew', 'presenceStop'], 'a stopped host never renews')
  assert.equal(h.state, 'stopped', 'the renew that answered ok during the stop did not revive it')
})

test('a drain or stop asked while activate runs wins: the host never comes back to active', async () => {
  const store = barrierStore()
  const h = host(store, 'starting')
  store.hold('presenceActivate')
  const activating = h.activate()
  await settle()
  const stopping = h.stop()
  store.open('presenceActivate')
  await activating
  await stopping
  assert.equal(h.state, 'stopped')
  assert.deepEqual(store.calls, ['presenceActivate', 'presenceStop'])
})

test('lost response: an activate whose answer is lost retries and gets the same answer (idempotent)', async () => {
  const store = barrierStore()
  let applied = false
  store.answers.presenceActivate = () => ({ status: 'active' })
  const real = store.presenceActivate
  store.presenceActivate = async (...args) => {
    const answer = await real(...args)
    if (!applied) { applied = true; throw new Error('socket hang up') } // applied, answer lost
    return answer
  }
  const h = host(store, 'starting')
  assert.equal(await h.activate(), 'active')
  assert.equal(store.calls.filter(c => c === 'presenceActivate').length, 2)
})

test('40P01 (deadlock) is retried a bounded number of times: activate, drain and stop recover; a renew fails once and the next one works', async () => {
  const store = barrierStore()
  store.failures.presenceActivate = 2
  const h = host(store, 'starting')
  assert.equal(await h.activate(), 'active')
  assert.equal(store.calls.filter(c => c === 'presenceActivate').length, 3)

  store.failures.presenceRenew = 1
  await h.renew()
  assert.equal(h.counters.renewFailures, 1)
  await h.renew()
  assert.equal(h.counters.renewals, 1, 'the next renew goes through')

  store.failures.presenceDrain = HOST_CALL_ATTEMPTS - 1
  assert.equal(await h.drain(), 'draining')
  assert.equal(store.calls.filter(c => c === 'presenceDrain').length, HOST_CALL_ATTEMPTS)

  store.failures.presenceStop = HOST_CALL_ATTEMPTS - 1
  assert.equal(await h.stop(), 'stopped')
  assert.equal(store.calls.filter(c => c === 'presenceStop').length, HOST_CALL_ATTEMPTS)
})

test('40P01 forever: every operation gives up after its bound, without throwing and without a pending rejection', async () => {
  const unhandled = []
  const onUnhandled = reason => unhandled.push(reason)
  process.on('unhandledRejection', onUnhandled)
  try {
    const store = barrierStore()
    store.failures.presenceActivate = 1_000
    const starting = host(store, 'starting')
    assert.equal(await starting.activate(), 'stopped', 'unreachable: stops')
    assert.equal(starting.counters.activation, 'unreachable')
    assert.equal(store.calls.filter(c => c === 'presenceActivate').length, 6)

    const draining = host(barrierStore())
    draining.store.failures.presenceDrain = 1_000
    draining.store.failures.presenceStop = 1_000
    assert.equal(await draining.drain(), 'draining', 'the lease runs out on its own')
    assert.equal(draining.store.calls.length, HOST_CALL_ATTEMPTS)
    assert.equal(await draining.stop(), 'stopped')
    await settle(20)
    assert.deepEqual(unhandled, [])
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
})

test('drain refused with host_expired: the host stops and cannot flush (never revived)', async () => {
  const store = barrierStore()
  store.answers.presenceDrain = () => ({ status: 'host_expired' })
  const h = host(store)
  assert.equal(await h.drain(), 'stopped')
  assert.equal(h.canSave, false, 'no final flush from a host whose lease ran out')
  await h.renew()
  assert.deepEqual(store.calls, ['presenceDrain'], 'and it never renews again')
})
