// CLOUD READINESS-3 precondition — evidence, NOT a product test. Runs the REAL PresenceRoom of the
// checkout (same harness as services/realtime/src/rooms/PresenceRoomClose.test.js) in `on`, with
// the sequence the real client produces (colyseusPresence.overlap.test.ts): the page's CURRENT
// socket (resume, tab T) is live; then its ABANDONED first join (fresh, same tab T) reaches the
// server. Observed on ad6a98e: the abandoned join replaces the live one (4409), and the page,
// which already left the abandoned room, ends up "replaced" with no other tab anywhere.
//   node --test docs/design/cloud-readiness-3/evidence/lateAbandonedJoin.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'

const R = new URL('../../../../services/realtime/src/', import.meta.url)
const { MESSAGE } = await import(new URL('protocol/messages.js', R))
const { SESSION_REPLACED_CODE } = await import(new URL('protocol/closeCodes.js', R))
const { HostLifecycle } = await import(new URL('presence/hostLifecycle.js', R))
const { openLocalDatabase, serviceQuery } = await import(new URL('world/persistence/dev/localDatabase.js', R))
const { createSqlPlayerData } = await import(new URL('world/persistence/playerData.js', R))
const { createDemoSkillPolicy } = await import(new URL('world/demoSkillPolicy.js', R))
const { createStaticOwnership } = await import(new URL('world/pokemonOwnership.js', R))
const { lastMessage } = await import(new URL('world/testing.js', R))
const { WORLD_PROTOCOL } = await import(new URL('world/worldProtocol.js', R))

test('same process: a late abandoned join of the page replaces the page\'s live socket (observed)', async () => {
  const db = await openLocalDatabase()
  const data = createSqlPlayerData(serviceQuery(db))
  const module = await import(new URL('rooms/PresenceRoom.js?instance=late-abandoned', R).href)
  const host = new HostLifecycle({ store: data, renewMs: 600_000, leaseMs: 120_000, log: () => {} })
  await host.acquire(); await host.activate()
  module.configureWorld({ skills: createDemoSkillPolicy({ durationMs: 3_000 }), ownership: createStaticOwnership({}) })
  module.configurePresenceHost(host)
  const service = module.configureLocationPersistence({ mode: 'on', store: data, host, now: () => Date.now(), hydrationTimeoutMs: 200 })
  service.journal?.stop()
  const room = new module.PresenceRoom(); room.onCreate()
  const userId = 'dddddddd-0000-4000-8000-000000000001'
  await db.query('INSERT INTO auth.users VALUES ($1)', [userId])
  const sock = id => { const messages = []; const leaves = []; return { sessionId: id, messages, leaves, send: (type, payload) => messages.push({ type, payload }), leave: (code, reason) => leaves.push([code, reason]) } }
  const join = async (c, options) => { await room.onJoin(c, { worldProtocol: WORLD_PROTOCOL, presenceProtocol: 3, ...options }, { kind: 'player', userId, username: 'P', token: null }); room.ready(c) }
  const placed = async c => { const t0 = performance.now(); while (!lastMessage(c, MESSAGE.SNAPSHOT)?.self) { if (performance.now() - t0 > 4_000) throw new Error('placement'); await new Promise(r => setTimeout(r, 5)) } }

  const current = sock('current'); await join(current, { tabId: 'tab-page-0001', resume: true }); await placed(current)
  const abandoned = sock('abandoned'); await join(abandoned, { tabId: 'tab-page-0001' })   // first join, late
  try {
    assert.deepEqual(current.leaves.map(l => l[0]), [SESSION_REPLACED_CODE], 'the live current socket is closed as replaced (4409)')
    assert.equal(abandoned.leaves.length, 0, 'the abandoned socket now owns the player on the server')
  } finally {
    room.onLeave(abandoned); room.onLeave(current)
    room.setSimulationInterval(null); room.clock.clear()
    module.configureLocationPersistence({ mode: 'off' }); module.configurePresenceHost(null)
    await host.stop(); await db.close()
  }
})
