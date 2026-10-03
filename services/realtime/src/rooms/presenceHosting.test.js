import test from 'node:test'
import assert from 'node:assert/strict'
import { PresenceHosting, supportsHost, tabIdOf } from './presenceHosting.js'
import { HOST_DRAINING_CODE, SESSION_REPLACED_CODE } from '../protocol/closeCodes.js'
import { MESSAGE } from '../protocol/messages.js'
import { SESSION_REPLACED } from '../presence/locationService.js'

// WORLD LOCATION-4: admission, close codes and drain of one process, on fakes (no database,
// no room). The room-level and end-to-end behaviour is PresenceRoomClose.test.js and
// scripts/world-location/ordering-harness.mjs.

function client() {
  const sent = []
  const leaves = []
  return { sent, leaves, send: (type, payload) => sent.push([type, payload]), leave: (code, reason) => leaves.push([code, reason]) }
}

function fakeLocation({ restores = true, active = true } = {}) {
  return {
    restores, active, attached: [], shutdowns: [], counters: { shadow: { wouldDrain: 0 } },
    attachHost(host) { this.attached.push(host) },
    async shutdown(deadlineMs) { this.shutdowns.push(deadlineMs); return { sent: 1, applied: 1, duplicate: 0, stale: 0, hostRefused: 0, left: 0, timedOut: false } },
  }
}

function fakeHost(state = 'active') {
  return {
    state, calls: [],
    get admitting() { return this.state === 'active' || this.state === 'unavailable' },
    async whenActive() { this.calls.push('whenActive'); return this.state === 'active' },
    async drain() { this.calls.push('drain'); this.state = 'draining' },
    async stop() { this.calls.push('stop'); this.state = 'stopped' },
    stats: () => ({ fake: true }),
  }
}

function hosting({ location = fakeLocation(), sockets = [] } = {}) {
  const rejected = []
  const h = new PresenceHosting({ location: () => location, sockets: () => sockets, metrics: { rejected: kind => rejected.push(kind) } })
  return { h, location, rejected }
}

const player = userId => ({ kind: 'player', userId })

test('tab ids: only 8-64 url-safe characters count; anything else is no tab', () => {
  assert.equal(tabIdOf({ tabId: 'tab-0123_abc' }), 'tab-0123_abc')
  for (const tabId of ['short', 'x'.repeat(65), 'tab with spaces', '<script>', 42, null, { id: 'tab-object-01' }]) assert.equal(tabIdOf({ tabId }), null, String(tabId))
  assert.equal(tabIdOf(undefined), null)
})

test('a store is a host store only with all five presence operations', () => {
  const ops = { presenceAcquire() {}, presenceActivate() {}, presenceRenew() {}, presenceDrain() {}, presenceStop() {} }
  assert.equal(supportsHost(ops), true)
  assert.equal(supportsHost({ ...ops, presenceStop: undefined }), false)
  assert.equal(supportsHost(null), false)
})

test('closeReplaced: protocol 3 → closing {replaced} then 4409; older → 4001 (reason only when named), nothing new sent', async () => {
  const { h } = hosting()
  const modern = client()
  await h.admit(modern, { presenceProtocol: 3 }, player('u1'), () => null)
  h.closeReplaced(modern, { named: false })
  assert.deepEqual(modern.sent, [[MESSAGE.CLOSING, { reason: 'replaced' }]])
  assert.deepEqual(modern.leaves, [[SESSION_REPLACED_CODE, SESSION_REPLACED]])
  for (const [protocol, named, expected] of [[2, true, [4001, SESSION_REPLACED]], [2, false, [4001, undefined]], [undefined, true, [4001, SESSION_REPLACED]], ['3', true, [4001, SESSION_REPLACED]]]) {
    const old = client()
    await h.admit(old, { presenceProtocol: protocol }, player('u2'), () => null)
    h.closeReplaced(old, { named })
    assert.deepEqual(old.sent, [], `protocol ${protocol}`)
    assert.deepEqual(old.leaves, [expected], `protocol ${protocol}`)
  }
})

test('closeDraining: 4503 for everyone; closing {draining} only for protocol 3', async () => {
  const { h } = hosting()
  const modern = client()
  const old = client()
  await h.admit(modern, { presenceProtocol: 3 }, player('a'), () => null)
  await h.admit(old, { presenceProtocol: 2 }, player('b'), () => null)
  h.closeDraining(modern)
  h.closeDraining(old)
  assert.deepEqual(modern.sent, [[MESSAGE.CLOSING, { reason: 'draining' }]])
  assert.deepEqual([modern.leaves, old.leaves, old.sent], [[[HOST_DRAINING_CODE, 'host-draining']], [[HOST_DRAINING_CODE, 'host-draining']], []])
})

test('admit: a resume from another tab yields (4409, counted); the same tab, no live session, a guest or a fresh join pass', async () => {
  const { h, rejected } = hosting()
  const live = client()
  await h.admit(live, { presenceProtocol: 3, tabId: 'tab-live-0001' }, player('u'), () => null)
  const liveOf = () => live
  await assert.rejects(h.admit(client(), { presenceProtocol: 3, tabId: 'tab-other-001', resume: true }, player('u'), liveOf), e => e.code === SESSION_REPLACED_CODE && e.message === 'session-replaced')
  assert.deepEqual(rejected, ['resume'])
  await h.admit(client(), { presenceProtocol: 3, tabId: 'tab-live-0001', resume: true }, player('u'), liveOf)
  await h.admit(client(), { presenceProtocol: 3, tabId: 'tab-other-001', resume: true }, player('u'), () => null)
  await h.admit(client(), { presenceProtocol: 3, tabId: 'tab-other-001' }, player('u'), liveOf)
  await h.admit(client(), { presenceProtocol: 3, tabId: 'tab-other-001', resume: true }, { kind: 'guest' }, liveOf)
  await h.admit(client(), { presenceProtocol: 2, resume: true }, player('u'), liveOf) // no tab id: not a resume
  assert.deepEqual(rejected, ['resume'])
})

test('admit: 4503 while draining, or when the host does not become active in time; an unavailable host admits (no persistence)', async () => {
  const { h } = hosting()
  h.host = fakeHost('starting')
  await assert.rejects(h.admit(client(), {}, player('u'), () => null), e => e.code === HOST_DRAINING_CODE)
  assert.deepEqual(h.host.calls, ['whenActive'])
  h.host = fakeHost('unavailable')
  await h.admit(client(), {}, player('u'), () => null)
  h.host = fakeHost('active')
  h.draining = true
  await assert.rejects(h.admit(client(), {}, player('u'), () => null), e => e.code === HOST_DRAINING_CODE && e.message === 'host-draining')
})

test('drain: draining at once, host → draining, then the location flush; idempotent', async () => {
  const { h, location } = hosting()
  h.host = fakeHost('active')
  const first = h.drain({ deadlineMs: 1_234 })
  assert.equal(h.draining, true, 'joins and moves are refused before the flush even starts')
  assert.deepEqual(await first, { sent: 1, applied: 1, duplicate: 0, stale: 0, hostRefused: 0, left: 0, timedOut: false })
  assert.deepEqual(location.shutdowns, [1_234])
  assert.equal(h.host.state, 'draining')
  await h.drain()
  assert.equal(h.draining, true)
})

test('a newer host in on: drain, close every socket with 4503, stop; in shadow: count wouldDrain only', async () => {
  const sockets = [client(), client()]
  const on = hosting({ sockets })
  on.h.configure(fakeHost('active'))
  on.h.host.onNewerActive()
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(on.h.host.calls, ['drain', 'stop'])
  assert.deepEqual(sockets.map(s => s.leaves), [[[HOST_DRAINING_CODE, 'host-draining']], [[HOST_DRAINING_CODE, 'host-draining']]])
  on.h.host.onExpired() // already draining: nothing twice
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(sockets[0].leaves.length, 1)

  const shadowSockets = [client()]
  const shadow = hosting({ location: fakeLocation({ restores: false }), sockets: shadowSockets })
  shadow.h.configure(fakeHost('active'))
  shadow.h.host.onNewerActive()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(shadow.location.counters.shadow.wouldDrain, 1)
  assert.deepEqual([shadow.h.host.calls, shadowSockets[0].leaves, shadow.h.draining], [[], [], false])
})

test('configure without reaction models the renew window; prepare needs active location and a host store', async () => {
  const { h, location } = hosting()
  const host = fakeHost('active')
  h.configure(host, { reactToHostChanges: false })
  assert.equal(host.onNewerActive, undefined)
  assert.deepEqual(location.attached, [host])
  assert.equal(await h.prepare({}), null, 'a store without host operations: no host')
  const off = hosting({ location: fakeLocation({ active: false }) })
  assert.equal(await off.h.prepare({ presenceAcquire() {}, presenceActivate() {}, presenceRenew() {}, presenceDrain() {}, presenceStop() {} }), null, 'location off: no host')
})

test('shuttingDown: nothing is admitted afterwards; protocol 3 hears why', async () => {
  const { h } = hosting()
  const modern = client()
  await h.admit(modern, { presenceProtocol: 3 }, player('u'), () => null)
  h.shuttingDown([modern])
  assert.deepEqual(modern.sent, [[MESSAGE.CLOSING, { reason: 'draining' }]])
  await assert.rejects(h.admit(client(), {}, player('v'), () => null), e => e.code === HOST_DRAINING_CODE)
  h.resetDraining()
  await h.admit(client(), {}, player('v'), () => null)
})

test('displaced in on (activation refused, newer host, expired lease): stays alive and stopped — /readyz 503, joins 4503, never exits', async () => {
  const exits = []
  const realExit = process.exit
  process.exit = code => { exits.push(code) }
  try {
    const sockets = [client()]
    const on = hosting({ sockets })
    on.h.log = () => {}
    on.h.configure(fakeHost('active'))
    on.h.host.onNewerActive()
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(on.h.host.calls, ['drain', 'stop'], 'drained, then stopped: no renew, no claim (a stopped host has no key)')
    assert.equal(on.h.serving, false, '/readyz 503')
    await assert.rejects(on.h.admit(client(), {}, player('u'), () => null), e => e.code === HOST_DRAINING_CODE, 'joins 4503')
    assert.equal(on.h.draining, true, 'movement stays frozen')
    assert.equal(on.h.stats().displaced, 'newer host active')

    const refused = hosting()
    refused.h.log = () => {}
    refused.h.configure(fakeHost('stopped'))
    refused.h.host.onActivationRefused('newer_active')
    assert.equal(refused.h.serving, false)
    await assert.rejects(refused.h.admit(client(), {}, player('u'), () => null), e => e.code === HOST_DRAINING_CODE)

    const expired = hosting({ sockets: [client()] })
    expired.h.log = () => {}
    expired.h.configure(fakeHost('active'))
    expired.h.host.onExpired()
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(expired.h.serving, false)
    assert.equal(expired.h.stats().displaced, 'lease expired')
    assert.deepEqual(exits, [], 'no displaced host ever calls process.exit')
  } finally {
    process.exit = realExit
  }
})

test('shadow never refuses a join for its host: a stopped or starting host admits (no key), and /readyz stays ready', async () => {
  const shadow = hosting({ location: fakeLocation({ restores: false }) })
  for (const state of ['stopped', 'starting']) {
    shadow.h.host = fakeHost(state)
    await shadow.h.admit(client(), {}, player('u'), () => null)
    assert.equal(shadow.h.serving, true, state)
  }
  const on = hosting()
  on.h.host = fakeHost('stopped')
  await assert.rejects(on.h.admit(client(), {}, player('u'), () => null), e => e.code === HOST_DRAINING_CODE)
  assert.equal(on.h.serving, false)
  on.h.host = null
  assert.equal(on.h.serving, true, 'no host (location off): ready as before')
})
