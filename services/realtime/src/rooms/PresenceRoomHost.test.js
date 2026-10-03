import test from 'node:test'
import assert from 'node:assert/strict'
import { PresenceRoom, configurePresenceHost } from './PresenceRoom.js'
import { HostLifecycle } from '../presence/hostLifecycle.js'
import { HOST_DRAINING_CODE } from '../protocol/closeCodes.js'

// WORLD LOCATION-4 (design §3.3.2): the room admits joins only while its host admits them.
// Between listen and activation a join waits; a draining or stopped host refuses with 4503.

function client(id) {
  return { sessionId: id, userData: undefined, messages: [], send() {}, leave() {} }
}

/** A host whose activation the test controls (no database). */
function startingHost() {
  const host = new HostLifecycle({ store: null, log: () => {} })
  host.state = 'starting'
  host.generation = 1
  return host
}

test.afterEach(() => configurePresenceHost(null))

test('a join that arrives before activation waits for it, then is admitted', async () => {
  const room = new PresenceRoom()
  const host = configurePresenceHost(startingHost())
  let admitted = false
  const joining = room.onJoin(client('g1'), {}, { kind: 'guest', token: null }).then(() => { admitted = true })
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(admitted, false, 'not before the host is active')
  host.state = 'active'
  host.observe({}) // no-op answer; activation settles the waiters through activate() in production
  for (const waiter of [...host.waiters]) waiter()
  await joining
  assert.equal(admitted, true)
})

test('a draining or stopped host refuses joins with 4503 host-draining (the client reconnects elsewhere)', async () => {
  const room = new PresenceRoom()
  for (const state of ['draining', 'stopped']) {
    const host = configurePresenceHost(startingHost())
    host.state = state
    await assert.rejects(room.onJoin(client(`g-${state}`), {}, { kind: 'guest', token: null }), error => error.code === HOST_DRAINING_CODE && /host-draining/.test(error.message))
  }
})

test('a starting host that never activates refuses after the wait (2 s)', async () => {
  const room = new PresenceRoom()
  configurePresenceHost(startingHost())
  // The wait's timer is unref'd (a live server keeps the loop busy); here the test keeps it alive.
  const keepAlive = setInterval(() => {}, 100)
  const started = performance.now()
  try {
    await assert.rejects(room.onJoin(client('g-late'), {}, { kind: 'guest', token: null }), error => error.code === HOST_DRAINING_CODE)
  } finally { clearInterval(keepAlive) }
  assert.ok(performance.now() - started >= 1_900)
})

test('without a host (location off) joins are admitted at once, as before', async () => {
  const room = new PresenceRoom()
  const c = client('g-off')
  await room.onJoin(c, {}, { kind: 'guest', token: null })
  assert.deepEqual(c.userData, { observer: { areaId: 'ciudad-corazon', tx: 31, ty: 20 } })
  room.onLeave(c)
})
