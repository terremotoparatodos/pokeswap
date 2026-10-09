import test from 'node:test'
import assert from 'node:assert/strict'
import { ECO_BATTLE_MAX_MS, ECO_DISCONNECT_GRACE_MS } from './ecoBattles.js'
import { PUBLIC_EVENT_FIELDS } from './ecoBattlePublic.js'
import { WORLD_MESSAGE } from './worldProtocol.js'
import { lastMessage, messagesOf } from './testing.js'
import { TICK, ended, realCycle, setup } from './ecoBattlesTestkit.js'

// ECO-BATTLE-SPECTATORS-1: the other ECO viewers of an area receive each test battle's public view
// (world:eco-battle-public) at the moments its owner is told of a change — never the owner, never
// another area, never a client without the ECO protocol. Arriving in the area brings the running
// battles as they are now; leaving stops them. Scripted battles drive routing and exits; the REAL
// bundle (seed 7) checks synchronisation with the owner and the absence of private data.

const publics = client => messagesOf(client, WORLD_MESSAGE.ECO_BATTLE_PUBLIC)
const SECRETS = ['joinAck', 'controller', '"moves"', '"pp"', 'selected', 'actionId', 'serverTimeMs', 'lastMoveId', 'PP_CHANGED', 'ACTION_STARTED', 'ACTION_READY', '"atk"', '"spa"']

test('S01 routing: the area\'s other ECO viewers (players and guests) get it; the owner, another area and a client without ECO do not', async () => {
  const s = await setup()
  const a = s.join('eco-a')
  const b = s.join('eco-b')
  const guest = s.join('eco-guest', { guest: true })
  const plain = s.join('eco-plain', { eco: false })
  const away = s.join('eco-away', { areaId: 'cueva-inicial' })
  const target = s.populated(a)
  s.standNear(a, target.id, 2)
  const before = a.actor.tx
  s.engage(a, target.id)
  for (const viewer of [b, guest]) {
    const [first] = publics(viewer.client)
    assert.ok(first, `${viewer.id} sees the battle start`)
    assert.deepEqual([first.seq, first.connected, first.areaId, first.encounterId], [1, true, 'pradera', target.id])
    assert.deepEqual(first.stage, { owner: { tx: before, ty: a.actor.ty }, wild: { tx: target.tx, ty: target.ty } })
    assert.equal(first.events, undefined, 'the start carries no effects')
  }
  for (const other of [a, plain, away]) assert.equal(publics(other.client).length, 0, `${other.id} gets nothing`)
  s.run(TICK * 3)
  assert.equal(publics(b.client).length, 4, 'one per owner message with events (the scripted battle emits every tick)')
  assert.deepEqual(publics(b.client).map(m => m.seq), [1, 2, 3, 4])
  assert.deepEqual(publics(a.client), [], 'the owner keeps only its own channel')
  assert.equal(messagesOf(b.client, WORLD_MESSAGE.ECO_BATTLE).length, 0)
  assert.equal(messagesOf(b.client, WORLD_MESSAGE.ECO_ENGAGE_RESULT).length, 0)
})

test('S02 synchronised with the owner (real bundle, seed 7, Rattata): same revisions, times, HP and drawable events, in order; the end last', async () => {
  const { s, a, battle } = await realCycle(19)
  const b = s.join('eco-b')
  assert.equal(s.action(a, battle.battleId, 1, { kind: 'useMove', combatantId: 'player-0', moveId: 84, targetId: 'wild-0' }).kind, 'accepted')
  s.run(30_000, () => ended(a.client).length > 0)
  assert.equal(ended(a.client)[0].outcome, 'victory')

  const watched = publics(b.client)
  const seqs = watched.map(m => m.seq)
  assert.deepEqual(seqs, [...seqs].sort((x, y) => x - y))
  assert.equal(new Set(seqs).size, seqs.length, 'seq strictly increasing')
  // the late join (b arrived after the start) brings the current state, without effects
  assert.equal(watched[0].events, undefined)
  // every owner message with events has its public twin
  const owned = messagesOf(a.client, WORLD_MESSAGE.ECO_BATTLE).filter(m => m.events.length)
  const twins = watched.filter(m => m.events)
  assert.equal(twins.length, owned.length)
  owned.forEach((mine, i) => {
    const theirs = twins[i]
    assert.equal(theirs.revision, mine.snapshot.revision)
    assert.equal(theirs.timeMs, mine.snapshot.timeMs)
    for (const id of ['player-0', 'wild-0']) {
      const own = mine.snapshot.combatants[id]
      assert.equal(theirs.combatants[id].currentHp, own.condition.currentHp ?? own.stats.hp) // null = full HP
    }
    const drawable = mine.events.filter(e => PUBLIC_EVENT_FIELDS[e.event.type])
    assert.deepEqual(theirs.events.map(e => [e.sequence, e.event.type]), drawable.map(e => [e.sequence, e.event.type]))
  })
  // the end: last, once, with the outcome and the final state
  const last = watched.at(-1)
  assert.deepEqual(last.ended, { outcome: 'victory' })
  assert.equal(watched.filter(m => m.ended).length, 1)
  assert.equal(last.revision, ended(a.client)[0].snapshot.revision)
  s.run(1_000)
  assert.equal(publics(b.client).length, watched.length, 'nothing after the end')
})

test('S03 arriving mid-battle shows the current state once (no past effects); leaving stops it; coming back gets what is running now', async () => {
  const { s, a } = await realCycle(74)
  s.run(5_000)
  const b = s.join('eco-b')
  const [arrival] = publics(b.client)
  assert.equal(publics(b.client).length, 1)
  assert.equal(arrival.events, undefined, 'no historic effects')
  assert.equal(arrival.revision, s.reservation('eco-a').battle.snapshot().revision, 'the state as it is now')
  // b leaves Pradera: nothing more from there
  b.actor.areaId = 'cueva-inicial'
  s.world.actorPlaced(b.actor)
  s.world.snapshot(b.client, b.actor)
  const count = publics(b.client).length
  s.run(5_000)
  assert.equal(publics(b.client).length, count, 'another area: nothing')
  // back: the running battle again, from the server, as it is now
  b.actor.areaId = 'pradera'
  s.world.actorPlaced(b.actor)
  s.world.snapshot(b.client, b.actor)
  const back = publics(b.client).at(-1)
  assert.equal(publics(b.client).length, count + 1)
  assert.equal(back.events, undefined)
  assert.equal(back.revision, s.reservation('eco-a').battle.snapshot().revision)
  assert.ok(back.revision > arrival.revision)
  assert.equal(ended(a.client).length, 0, 'the battle never stopped')
})

test('S04 every exit is told once with its outcome, and nothing follows: fled, left-area, expired, disconnected, vanished', async () => {
  for (const exit of ['fled', 'left-area', 'expired', 'disconnected', 'vanished']) {
    const s = await setup()
    const a = s.join('eco-a')
    const b = s.join('eco-b')
    const target = s.populated(a)
    s.standNear(a, target.id)
    const { battle } = s.engage(a, target.id)
    if (exit === 'fled') s.world.ecoFlee(a.actor, { battleId: battle.battleId }, a.client)
    if (exit === 'left-area') { a.actor.areaId = 'ciudad-corazon'; s.world.actorPlaced(a.actor) }
    if (exit === 'expired') s.run(ECO_BATTLE_MAX_MS + TICK)
    if (exit === 'disconnected') { s.world.leave(a.client); s.sockets.delete('eco-a'); s.run(ECO_DISCONNECT_GRACE_MS + 500) }
    if (exit === 'vanished') { const alive = s.world.eco.alive.bind(s.world.eco); s.world.eco.alive = id => (id === target.id ? false : alive(id)); s.run(TICK) }
    const ends = publics(b.client).filter(m => m.ended)
    assert.deepEqual(ends.map(m => m.ended.outcome), [exit], exit)
    const count = publics(b.client).length
    assert.equal(publics(b.client).at(-1).ended.outcome, exit, `${exit}: the end is the last message`)
    s.run(1_000)
    assert.equal(publics(b.client).length, count, `${exit}: nothing after`)
  }
})

test('S05 pause and resume reach spectators even when the battle\'s revision does not change', async () => {
  const { s, a } = await realCycle(74)
  const b = s.join('eco-b')
  s.run(2_000)
  s.world.leave(a.client)
  s.sockets.delete('eco-a')
  const paused = publics(b.client).at(-1)
  assert.equal(paused.connected, false)
  s.run(3_000)
  assert.equal(publics(b.client).at(-1), paused, 'paused: no battle time, no messages')
  s.join('eco-a', { actor: a.actor })
  const resumed = publics(b.client).at(-1)
  assert.equal(resumed.connected, true)
  assert.equal(resumed.revision, paused.revision, 'no battle time passed: same revision')
  assert.equal(resumed.timeMs, paused.timeMs)
  assert.ok(resumed.seq > paused.seq, 'still a newer message')
})

test('S06 two battles at once in one area: a third viewer sees both; each owner sees only the other one', async () => {
  const s = await setup()
  const a = s.join('eco-a')
  const b = s.join('eco-b')
  const c = s.join('eco-c')
  s.populated(a)
  const [first, second] = s.ecoOf(a.client).encounters
  s.standNear(a, first.id)
  s.standNear(b, second.id)
  const one = s.engage(a, first.id).battle.battleId
  const two = s.engage(b, second.id).battle.battleId
  s.run(TICK * 2)
  const ids = client => new Set(publics(client).map(m => m.battleId))
  assert.deepEqual([...ids(c.client)].sort(), [one, two].sort())
  assert.deepEqual([...ids(a.client)], [two])
  assert.deepEqual([...ids(b.client)], [one])
  // each battle keeps its own counter
  for (const id of [one, two]) {
    const seqs = publics(c.client).filter(m => m.battleId === id).map(m => m.seq)
    assert.deepEqual(seqs, seqs.map((_, i) => i + 1))
  }
  // a late viewer gets both, and a joining owner never its own
  const d = s.join('eco-d')
  assert.deepEqual(publics(d.client).map(m => m.battleId).sort(), [one, two].sort())
  const again = s.join('eco-a', { actor: a.actor })
  assert.deepEqual(publics(again.client).map(m => m.battleId), [two])
})

test('S07 no private data on the wire (real bundle, a whole battle, start to end)', async () => {
  const { s, a, battle } = await realCycle(19)
  const b = s.join('eco-b')
  s.action(a, battle.battleId, 1, { kind: 'useMove', combatantId: 'player-0', moveId: 84, targetId: 'wild-0' })
  s.run(30_000, () => ended(a.client).length > 0)
  assert.ok(publics(b.client).length > 3)
  for (const message of publics(b.client)) {
    const text = JSON.stringify(message)
    for (const secret of [...SECRETS, 'eco-a']) assert.ok(!text.includes(secret), `no ${secret} in ${text.slice(0, 80)}`)
  }
  assert.equal(lastMessage(b.client, WORLD_MESSAGE.ECO_BATTLE), undefined)
})
