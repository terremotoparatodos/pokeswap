import test from 'node:test'
import assert from 'node:assert/strict'
import { ECO_ENGAGE_RANGE } from './ecoBattles.js'
import { battleStage, facing, wildPoseAt, wildWalkable } from './ecoScene.js'
import { WORLD_MESSAGE } from './worldProtocol.js'
import { lastMessage, messagesOf } from './testing.js'
import { TICK, ended, setup } from './ecoBattlesTestkit.js'

// ECO-BATTLE-SCENE-1: the server decides the battle's scene once, at the reservation — the wild one
// frozen where every client sees it (its shared patrol at that instant, never its home tile), the
// player's Pokémon in front of it — and tells the same scene to the owner, to spectators and to the
// whole area (`stand`). While it runs its owner may walk the area but not leave it nor start another
// activity, and both limits lift with the end.

const view = (s, client, id) => (lastMessage(client, WORLD_MESSAGE.ECO)?.eco ?? lastMessage(client, WORLD_MESSAGE.SNAPSHOT)?.eco).encounters.find(e => e.id === id)

/** Runs until the encounter is seen away from its home tile (so a jump home would show). */
function awayFromHome(s, id) {
  const ok = s.run(60_000, () => {
    const e = s.world.eco.encounter(id)
    const seen = wildPoseAt(e, s.clock.now())
    return seen.tx !== e.tx || seen.ty !== e.ty
  })
  assert.ok(ok, 'the patrol leaves home')
}

test('SC01 the wild one freezes where it is seen, not at home; owner, spectators and the area get the same scene', async () => {
  const s = await setup()
  const a = s.join('eco-a')
  const b = s.join('eco-b')
  const target = s.populated(a)
  awayFromHome(s, target.id)
  const home = s.world.eco.encounter(target.id)
  const seen = wildPoseAt(home, s.clock.now())
  s.standNear(a, target.id, 2)
  const answer = s.engage(a, target.id)
  assert.equal(answer.ok, true)
  const { stage } = answer.battle
  assert.deepEqual(stage.wild, seen)
  assert.notDeepEqual(stage.wild, { tx: home.tx, ty: home.ty }, 'not back at home')
  // in front of it, on a walkable tile, never on the trainer's, facing each other
  assert.equal(Math.abs(stage.pokemon.tx - seen.tx) + Math.abs(stage.pokemon.ty - seen.ty), 1)
  assert.ok(wildWalkable('pradera', stage.pokemon.tx, stage.pokemon.ty))
  assert.notDeepEqual(stage.pokemon, { tx: a.actor.tx, ty: a.actor.ty })
  assert.equal(stage.pokemonFacing, facing(stage.pokemon, seen))
  assert.equal(stage.wildFacing, facing(seen, stage.pokemon))
  // the spectator's public view and the area's list carry the very same tiles
  const pub = messagesOf(b.client, WORLD_MESSAGE.ECO_BATTLE_PUBLIC)[0]
  assert.deepEqual([pub.stage.wild, pub.stage.pokemon, pub.stage.pokemonFacing], [stage.wild, stage.pokemon, stage.pokemonFacing])
  s.world.flush()
  for (const viewer of [a, b]) assert.deepEqual(view(s, viewer.client, target.id).stand, { ...stage.wild, dir: stage.wildFacing }, `${viewer.id}'s area list`)
})

test('SC02 the 3-tile limit is measured from where it is seen: in range of the pose though 4+ from home starts; 4 from the pose does not', async () => {
  const s = await setup()
  const a = s.join('eco-a')
  const target = s.populated(a)
  const found = s.run(120_000, () => {
    const e = s.world.eco.encounter(target.id)
    const seen = wildPoseAt(e, s.clock.now())
    return Math.max(Math.abs(seen.tx - e.tx), Math.abs(seen.ty - e.ty)) >= 2
  })
  assert.ok(found, 'the patrol strays two tiles or more from home')
  const e = s.world.eco.encounter(target.id)
  const seen = wildPoseAt(e, s.clock.now())
  const dx = Math.sign(seen.tx - e.tx) || 0, dy = Math.sign(seen.ty - e.ty) || 0
  // on the far side of the pose, away from home: 3 from the pose, more than 3 from home
  a.actor.areaId = e.areaId; a.actor.tx = seen.tx + dx * ECO_ENGAGE_RANGE; a.actor.ty = seen.ty + dy * ECO_ENGAGE_RANGE
  assert.ok(Math.max(Math.abs(a.actor.tx - e.tx), Math.abs(a.actor.ty - e.ty)) > ECO_ENGAGE_RANGE)
  const near = { ...a.actor }
  a.actor.tx = seen.tx + dx * (ECO_ENGAGE_RANGE + 1); a.actor.ty = seen.ty + dy * (ECO_ENGAGE_RANGE + 1)
  assert.equal(s.engage(a, target.id).reason, 'too-far')
  Object.assign(a.actor, near)
  assert.equal(s.engage(a, target.id, 2).ok, true)
})

test('SC03 the scene stays put: ticks pass and the owner walks away; tiles and facings never change', async () => {
  const s = await setup()
  const a = s.join('eco-a')
  const b = s.join('eco-b')
  const target = s.populated(a)
  s.standNear(a, target.id, 2)
  const { stage } = s.engage(a, target.id).battle
  for (let i = 0; i < 5; i++) {
    a.actor.tx += 2
    s.world.viewerMoved(a.client, a.actor)
    s.run(TICK * 20)
  }
  for (const m of messagesOf(b.client, WORLD_MESSAGE.ECO_BATTLE_PUBLIC)) assert.deepEqual([m.stage.wild, m.stage.pokemon], [stage.wild, stage.pokemon])
  s.world.flush()
  assert.deepEqual(view(s, b.client, target.id).stand, { ...stage.wild, dir: stage.wildFacing })
  assert.equal(s.world.ecoBattles.isBusy(target.id), true, 'walking away never cancels it')
})

test('SC04 no room in front of it: the rule gives no scene (engage answers no-room and reserves nothing)', () => {
  // outside Pradera's hard edge every neighbour is unwalkable
  assert.equal(battleStage({ areaId: 'pradera', trainer: { tx: 0, ty: 0 }, wild: { tx: 99999, ty: 99999 } }), null)
  // a free neighbour is never the trainer's own tile, nor the wild one's
  const spawn = { tx: -5, ty: -69 }
  const free = [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([dx, dy]) => ({ tx: spawn.tx + dx, ty: spawn.ty + dy })).filter(t => wildWalkable('pradera', t.tx, t.ty))
  assert.ok(free.length >= 2)
  for (const trainer of free) {
    const stage = battleStage({ areaId: 'pradera', trainer, wild: spawn })
    assert.notDeepEqual(stage.pokemon, trainer)
    assert.notDeepEqual(stage.pokemon, spawn)
  }
})

test('SC05 during the battle: no other activity, no leaving the area (the server says so); both lift with the end', async () => {
  const s = await setup()
  const a = s.join('eco-a')
  const target = s.populated(a)
  s.standNear(a, target.id, 2)
  const { battle } = s.engage(a, target.id)
  assert.equal(s.world.mayLeaveArea('eco-a'), false)
  const refused = s.world.work(a.actor, { requestId: 7, nodeId: 'pradera:0:0:tree', pokemonInstanceId: 1 }, a.client)
  assert.equal(refused.reason, 'in-battle')
  assert.equal(refused.requestId, 7)
  // paused (owner away inside the grace) still holds them
  s.world.leave(a.client)
  assert.equal(s.world.mayLeaveArea('eco-a'), false)
  const back = s.join('eco-a', { actor: a.actor })
  s.world.ecoFlee(a.actor, { battleId: battle.battleId }, back.client)
  assert.deepEqual(ended(back.client).map(e => e.outcome), ['fled'])
  assert.equal(s.world.mayLeaveArea('eco-a'), true)
  const after = s.world.work(a.actor, { requestId: 8, nodeId: 'pradera:0:0:tree', pokemonInstanceId: 1 }, back.client)
  assert.notEqual(after?.reason, 'in-battle')
  // others are never held
  assert.equal(s.world.mayLeaveArea('eco-b'), true)
})
