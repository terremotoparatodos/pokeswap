import test from 'node:test'
import assert from 'node:assert/strict'
import { MESSAGE } from '../protocol/messages.js'
import { HOST_DRAINING_CODE, SESSION_REPLACED_CODE } from '../protocol/closeCodes.js'
import { HostLifecycle } from '../presence/hostLifecycle.js'
import { SESSION_REPLACED } from '../presence/locationService.js'
import { openLocalDatabase, serviceQuery } from '../world/persistence/dev/localDatabase.js'
import { createSqlPlayerData } from '../world/persistence/playerData.js'
import { createDemoSkillPolicy } from '../world/demoSkillPolicy.js'
import { createStaticOwnership } from '../world/pokemonOwnership.js'
import { lastMessage, openDirection } from '../world/testing.js'
import { WORLD_PROTOCOL } from '../world/worldProtocol.js'

// WORLD LOCATION-4 (design §5): how the room closes sockets. A replacement is 4409 for clients
// that declare presenceProtocol 3 (4001 for older ones); a drain or shutdown is 4503 for every
// client, preceded by `presence:closing` for protocol 3; an automatic reconnection (resume)
// never displaces another tab. Each test runs its own module copy (its own drain state) on one
// embedded Postgres with the real migrations.

let db = null
let data = null
test.after(async () => { await db?.close() })
let userCount = 0
const nextUser = () => `cccccccc-0000-4000-8000-${String(++userCount).padStart(12, '0')}`
let instances = 0

function client(id) {
  const messages = []
  const leaves = []
  return { sessionId: id, userData: undefined, messages, leaves, send: (type, payload) => messages.push({ type, payload }), leave: (code, reason) => leaves.push([code, reason]) }
}

async function newHost() {
  const host = new HostLifecycle({ store: data, renewMs: 600_000, leaseMs: 120_000, log: () => {} })
  await host.acquire()
  await host.activate()
  return host
}

async function closeRoom(t, { mode = 'on' } = {}) {
  if (!db) { db = await openLocalDatabase(); data = createSqlPlayerData(serviceQuery(db)) }
  const module = await import(new URL(`./PresenceRoom.js?instance=close-${++instances}`, import.meta.url).href)
  const host = await newHost()
  module.configureWorld({ skills: createDemoSkillPolicy({ durationMs: 3_000 }), ownership: createStaticOwnership({}) })
  module.configurePresenceHost(host)
  const service = module.configureLocationPersistence({ mode, store: data, host, now: () => Date.now(), hydrationTimeoutMs: 200 })
  service.journal?.stop()
  const room = new module.PresenceRoom()
  room.onCreate()
  const clients = []
  // Awaited: the file closes the database after the last test, never under a host's last call.
  t.after(async () => {
    for (const c of clients) room.onLeave(c)
    room.setSimulationInterval(null)
    room.clock.clear()
    module.configureLocationPersistence({ mode: 'off' })
    module.configurePresenceHost(null)
    await host.stop()
  })
  const join = async (userId, options = {}) => {
    await db.query('INSERT INTO auth.users VALUES ($1) ON CONFLICT DO NOTHING', [userId])
    const c = client(`${userId}-${clients.length}`)
    await room.onJoin(c, { worldProtocol: WORLD_PROTOCOL, presenceProtocol: 3, ...options }, { kind: 'player', userId, username: 'P', token: null })
    clients.push(c)
    room.ready(c)
    return c
  }
  const placed = async (c, userId) => {
    const started = performance.now()
    while (!(module.liveActorForTesting(userId) && lastMessage(c, MESSAGE.SNAPSHOT)?.self)) {
      if (performance.now() - started > 4_000) throw new Error('timed out waiting for placement')
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    return c
  }
  return { module, host, service, room, join, placed }
}

const closings = c => c.messages.filter(m => m.type === MESSAGE.CLOSING).map(m => m.payload.reason)

test('replacement: protocol 3 hears presence:closing {replaced} and closes with 4409; protocol 2 keeps the legacy 4001', async t => {
  const r = await closeRoom(t)
  const modern = nextUser()
  const first = await r.placed(await r.join(modern, { tabId: 'tab-aaaaaaaa' }), modern)
  assert.equal(lastMessage(first, MESSAGE.SNAPSHOT).presenceProtocol, 3, 'the snapshot echoes the close codes it speaks')
  await r.join(modern, { tabId: 'tab-bbbbbbbb' }) // a fresh join (another tab, a reload): replaces
  assert.deepEqual(closings(first), ['replaced'])
  assert.deepEqual(first.leaves, [[SESSION_REPLACED_CODE, SESSION_REPLACED]])

  const legacy = nextUser()
  const old = await r.placed(await r.join(legacy, { presenceProtocol: 2 }), legacy)
  await r.join(legacy, { presenceProtocol: 2 })
  assert.deepEqual(closings(old), [], 'an older client never receives the new message')
  assert.deepEqual(old.leaves, [[4001, SESSION_REPLACED]])
})

test('resume: an automatic reconnection never displaces another tab (4409 at join); the same tab or nobody live is admitted', async t => {
  const r = await closeRoom(t)
  const u = nextUser()
  const live = await r.placed(await r.join(u, { tabId: 'tab-live-0001' }), u)
  await assert.rejects(r.join(u, { tabId: 'tab-other-001', resume: true }), error => error.code === SESSION_REPLACED_CODE && /session-replaced/.test(error.message))
  assert.deepEqual(live.leaves, [], 'the live session is untouched')
  assert.deepEqual(closings(live), [])

  // The same tab resuming (its socket dropped and the server has not noticed yet) takes over its own session.
  const again = await r.join(u, { tabId: 'tab-live-0001', resume: true })
  assert.deepEqual(live.leaves, [[SESSION_REPLACED_CODE, SESSION_REPLACED]])
  r.room.onLeave(live)
  await r.placed(again, u)

  // Nobody live: a resume is an ordinary join.
  const lone = nextUser()
  await r.placed(await r.join(lone, { tabId: 'tab-lone-0001', resume: true }), lone)

  // A malformed tabId is ignored: no resume check, the join is fresh.
  const other = nextUser()
  const first = await r.placed(await r.join(other, { tabId: 'tab-good-0001' }), other)
  await r.join(other, { tabId: '<b>', resume: true })
  assert.deepEqual(first.leaves, [[SESSION_REPLACED_CODE, SESSION_REPLACED]])
})

test('drain: the host drains, pending locations are saved, joins are refused with 4503 and movement is frozen', async t => {
  const r = await closeRoom(t)
  const u = nextUser()
  const c = await r.placed(await r.join(u, { tabId: 'tab-drain-001' }), u)
  const before = lastMessage(c, MESSAGE.SNAPSHOT).self
  r.room.move(c, { direction: openDirection(before.areaId, before), running: false, sequence: before.moveSequence + 1 })
  const result = await r.module.drainPresence({ deadlineMs: 2_000 })
  assert.equal(r.host.state, 'draining')
  assert.equal(result.left, 0)
  assert.equal(result.timedOut, false)
  await assert.rejects(r.join(nextUser()), error => error.code === HOST_DRAINING_CODE)
  const at = [...c.messages].reverse().find(m => m.type === MESSAGE.SELF)?.payload ?? before
  r.room.move(c, { direction: openDirection(at.areaId, at), running: false, sequence: at.moveSequence + 1 })
  const answer = [...c.messages].reverse().find(m => m.type === MESSAGE.SELF).payload
  assert.deepEqual({ tx: answer.tx, ty: answer.ty }, { tx: at.tx, ty: at.ty }, 'nothing moves while draining')
  assert.deepEqual(c.messages.filter(m => m.type === MESSAGE.ERROR).at(-1).payload, { code: 'invalid-intent', reason: 'host draining' })
})

test('shutdown: the room closes every socket with 4503 (never Colyseus 4001); presence:closing only for protocol 3', async t => {
  const r = await closeRoom(t)
  const a = nextUser()
  const b = nextUser()
  const modern = await r.placed(await r.join(a, { tabId: 'tab-shut-0001' }), a)
  const legacy = await r.placed(await r.join(b, { presenceProtocol: 2 }), b)
  r.room.clients.push(modern, legacy)
  const codes = []
  r.room.disconnect = async code => { codes.push(code) }
  r.room.onBeforeShutdown()
  assert.deepEqual(codes, [HOST_DRAINING_CODE])
  assert.deepEqual(closings(modern), ['draining'])
  assert.deepEqual(closings(legacy), [])
  await assert.rejects(r.join(nextUser()), error => error.code === HOST_DRAINING_CODE, 'no join once shutting down')
})

test('on: a newer active host seen on renew drains this one: every socket 4503 (closing for protocol 3), then the host stops', async t => {
  const r = await closeRoom(t)
  const a = nextUser()
  const b = nextUser()
  const modern = await r.placed(await r.join(a, { tabId: 'tab-newer-001' }), a)
  const legacy = await r.placed(await r.join(b, { presenceProtocol: 2 }), b)
  const newer = await newHost()
  t.after(() => newer.stop())
  await r.host.renew()
  const started = performance.now()
  while (r.host.state !== 'stopped' && performance.now() - started < 4_000) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(r.host.state, 'stopped')
  assert.deepEqual(modern.leaves, [[HOST_DRAINING_CODE, 'host-draining']])
  assert.deepEqual(legacy.leaves, [[HOST_DRAINING_CODE, 'host-draining']], 'an older client reconnects too (as on 1006)')
  assert.deepEqual(closings(modern), ['draining'])
  assert.deepEqual(closings(legacy), [])
})

test('shadow: a newer active host only counts wouldDrain; nobody is closed and the host keeps its state', async t => {
  const r = await closeRoom(t, { mode: 'shadow' })
  const a = nextUser()
  const c = await r.placed(await r.join(a, { tabId: 'tab-shadow-01' }), a)
  const newer = await newHost()
  t.after(() => newer.stop())
  await r.host.renew()
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(r.service.stats().shadow.wouldDrain, 1)
  assert.deepEqual(c.leaves, [])
  assert.deepEqual(closings(c), [])
  assert.equal(r.host.state, 'active')
  await r.join(nextUser()) // still admitting
})

// ── Compatibility: today's clients against this server (design §5.2, C5) ─────

test('compat: a protocol-2 client sending resume without a tab id is a fresh join (old clients never get the resume rule)', async t => {
  const r = await closeRoom(t)
  const u = nextUser()
  const first = await r.placed(await r.join(u, { presenceProtocol: 2 }), u)
  const second = await r.join(u, { presenceProtocol: 2, resume: true })
  assert.deepEqual(first.leaves, [[4001, SESSION_REPLACED]], 'replaced as before WORLD LOCATION-4')
  assert.deepEqual(closings(first), [])
  await r.placed(second, u)
})

test('compat: a client older than protocol 2 (no presenceProtocol) is replaced with 4001, hears nothing new, and still joins', async t => {
  const r = await closeRoom(t)
  const u = nextUser()
  const first = await r.placed(await r.join(u, { presenceProtocol: undefined }), u)
  assert.equal(lastMessage(first, MESSAGE.SNAPSHOT).presenceProtocol, 3, 'an extra snapshot field older clients ignore')
  await r.join(u, { presenceProtocol: undefined })
  assert.deepEqual(first.leaves, [[4001, SESSION_REPLACED]])
  assert.deepEqual(closings(first), [])
})

test('compat: a malformed presenceProtocol or tab id changes nothing (treated as an old client, fresh join)', async t => {
  const r = await closeRoom(t)
  const u = nextUser()
  const first = await r.placed(await r.join(u, { presenceProtocol: '3', tabId: 'x' }), u)
  await r.join(u, { presenceProtocol: 3.5, tabId: { id: 'tab-object-01' }, resume: true })
  assert.deepEqual(first.leaves, [[4001, SESSION_REPLACED]], 'a string protocol is not protocol 3: legacy close')
  assert.deepEqual(closings(first), [])
})
