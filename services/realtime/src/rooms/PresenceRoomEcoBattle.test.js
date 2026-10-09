import test from 'node:test'
import assert from 'node:assert/strict'
import { PresenceRoom, configureWorld, liveActorForTesting } from './PresenceRoom.js'
import { MESSAGE } from '../protocol/messages.js'
import { cavesIn } from '../world/caves.js'
import { caveInterior } from '../world/caveLayouts.js'
import { createDemoSkillPolicy } from '../world/demoSkillPolicy.js'
import { createStaticOwnership } from '../world/pokemonOwnership.js'
import { WORLD_PROTOCOL } from '../world/worldProtocol.js'
import { crossTo, fakeClient, lastMessage, messagesOf, routeBetween } from '../world/testing.js'

// ECO-BATTLE-SCENE-1 inside the presence room: while the world says its player is in a test battle
// (`mayLeaveArea` false), a crossing is refused by the service like any crossing the rules do not
// allow — nothing moves and the client is told where it really is — even standing on the portal. A
// same-area request (a resync) is not a crossing and stays allowed. Free again, the same request
// crosses. The battle side of `mayLeaveArea` is covered in world/ecoBattles.scene.test.js.

const CAVE = cavesIn('pradera')[0]
const INSIDE = caveInterior(CAVE.interiorAreaId)

test('room: a player held by a test battle cannot cross the cave mouth; a resync still answers; free, it crosses', async t => {
  const world = configureWorld({ skills: createDemoSkillPolicy({ durationMs: 3_000 }), ownership: createStaticOwnership({}) })
  let held = false
  world.mayLeaveArea = playerId => !(held && playerId === 'eco-held')
  const room = new PresenceRoom()
  room.onCreate()
  let now = Date.now()
  const realNow = Date.now
  Date.now = () => now
  const client = fakeClient('eco-held-session')
  t.after(() => {
    Date.now = realNow
    room.onLeave(client)
    room.setSimulationInterval(null)
    room.clock.clear()
  })
  await room.onJoin(client, { worldProtocol: WORLD_PROTOCOL, presenceProtocol: 2 }, { kind: 'player', userId: 'eco-held', username: 'HELD', token: null })
  room.ready(client)
  const self = () => {
    const entry = [...client.messages].reverse().find(e => e.type === MESSAGE.SELF || (e.type === MESSAGE.SNAPSHOT && e.payload.self))
    return entry.type === MESSAGE.SELF ? entry.payload : entry.payload.self
  }
  let sequence = 0
  const step = direction => { now += 200; sequence = Math.max(sequence, self().moveSequence) + 1; room.move(client, { direction, running: false, sequence }) }
  crossTo(room, client, liveActorForTesting('eco-held'), 'pradera')
  for (const direction of routeBetween('pradera', self(), CAVE.mouth)) step(direction)
  assert.deepEqual({ areaId: self().areaId, tx: self().tx, ty: self().ty }, { areaId: 'pradera', ...CAVE.mouth })

  // a battle starts (held): refused on the mouth itself, told where it is
  held = true
  const errors = messagesOf(client, MESSAGE.ERROR).length
  room.changeArea(client, { areaId: INSIDE.id })
  assert.equal(messagesOf(client, MESSAGE.ERROR).length, errors + 1)
  assert.equal(lastMessage(client, MESSAGE.ERROR).reason, 'area transition denied')
  const refused = lastMessage(client, MESSAGE.SNAPSHOT).self
  assert.deepEqual({ areaId: refused.areaId, tx: refused.tx, ty: refused.ty }, { areaId: 'pradera', ...CAVE.mouth })
  assert.equal(liveActorForTesting('eco-held').areaId, 'pradera')

  // a resync of its own area is not a crossing: answered, no error
  room.changeArea(client, { areaId: 'pradera' })
  assert.equal(messagesOf(client, MESSAGE.ERROR).length, errors + 1)

  // free again (the battle ended): the same request crosses
  held = false
  room.changeArea(client, { areaId: INSIDE.id })
  const inside = lastMessage(client, MESSAGE.SNAPSHOT).self
  assert.deepEqual({ areaId: inside.areaId, tx: inside.tx, ty: inside.ty }, { areaId: INSIDE.id, tx: INSIDE.arrival.tx, ty: INSIDE.arrival.ty })
})
