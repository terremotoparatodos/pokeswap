import test from 'node:test'
import assert from 'node:assert/strict'
import { ECO_BATTLE_MAX_MS, ECO_DISCONNECT_GRACE_MS, ECO_ENGAGE_RANGE, EcoBattles, prepareBundledBattles } from './ecoBattles.js'
import { WORLD_MESSAGE } from './worldProtocol.js'
import { fakeClient, lastMessage, messagesOf } from './testing.js'
import { TICK, ended, realCycle, setup } from './ecoBattlesTestkit.js'

// ECO-GAMEPLAY-2 (experimental, development only): authoritative reservations of ECO encounters for
// test battles (docs/design/ECO_GAMEPLAY_2_CONTRACT.md, §7 for clocks and exit order). The plan's
// cases are tagged A01–A12. Most use a SCRIPTED battle (the outcome is whatever the test says) to
// drive every exit deterministically; the last ones run the REAL test-battle bundle through the
// whole reservation cycle (fixed seed 7).


test('A01 two players dispute one encounter: one battles, the other sees it busy (both orders)', async () => {
  for (const order of [['a', 'b'], ['b', 'a']]) {
    const s = await setup()
    const players = { a: s.join(`eco-${order[0]}-first`), b: s.join(`eco-${order[1]}-second`) }
    const target = s.populated(players.a)
    s.standNear(players.a, target.id, 1)
    s.standNear(players.b, target.id, 2)
    const first = s.engage(players.a, target.id)
    const second = s.engage(players.b, target.id)
    assert.equal(first.ok, true)
    assert.equal(first.battle.fixture, true)
    assert.equal(first.battle.fixtureLabel, 'fixture de prueba')
    assert.deepEqual(second, { requestId: 1, encounterId: target.id, ok: false, reason: 'busy' })
    assert.equal(s.scripted.made.length, 1, 'one battle, never two')
    s.world.flush()
    for (const p of [players.a, players.b]) assert.equal(s.ecoOf(p.client).encounters.find(e => e.id === target.id).busy, true, 'busy for everyone')
    assert.ok(s.ecoOf(players.b.client).encounters.filter(e => e.id !== target.id).every(e => e.busy === false))
    assert.equal(lastMessage(players.b.client, WORLD_MESSAGE.ECO_BATTLE), undefined, 'the other player learns nothing of the battle')
  }
})

test('A02 actions before the core: current socket, own battle, own actionId — even an already-accepted one', async () => {
  const s = await setup()
  const a = s.join('eco-a')
  const b = s.join('eco-b')
  const target = s.populated(a)
  s.standNear(a, target.id)
  const { battle } = s.engage(a, target.id)
  const core = s.scripted.made[0]
  assert.equal(s.action(a, battle.battleId, 1).kind, 'accepted')
  assert.equal(core.submits.length, 1)
  assert.equal(core.submits[0].controllerId, 'eco-a', 'the controller is the transport player')
  // another player, with the battle id it somehow learnt
  assert.equal(s.action(b, battle.battleId, 1, undefined, 'eco-a:2'), 'no-battle')
  // the owner, with an actionId of someone else, or another battle id
  assert.equal(s.action(a, battle.battleId, 2, undefined, 'eco-b:2'), 'not-your-battle')
  assert.equal(s.action(a, 'eco-battle-x-00000000', 2), 'not-your-battle')
  // a replaced socket: the new one takes over; the old one is refused even for the accepted actionId
  const old = a.client
  const a2 = s.join('eco-a', { actor: a.actor })
  assert.equal(s.world.ecoBattleAction(a.actor, { actionId: 'eco-a:1', battleId: battle.battleId }, old), 'not-your-battle')
  assert.equal(core.submits.length, 1, 'no refused action reached the core (its ledger would have answered first)')
  assert.equal(lastMessage(old, WORLD_MESSAGE.ECO_BATTLE).snapshot, undefined, 'a refusal carries no snapshot')
  assert.equal(lastMessage(a2.client, WORLD_MESSAGE.ECO_ENGAGE_RESULT).resumed, true, 'the new socket got the running battle after its snapshot')
  assert.equal(s.action(a2, battle.battleId, 2).kind, 'accepted')
  // the old socket closing afterwards changes nothing
  s.world.leave(old)
  assert.equal(s.reservation('eco-a').client, a2.client)
  // guests, and clients that did not declare the ECO protocol
  const guest = s.join('guest', { guest: true })
  assert.equal(s.world.ecoBattleAction(null, { battleId: battle.battleId, actionId: 'eco-a:3' }, guest.client), 'not-your-battle')
  const outdated = s.join('eco-c', { eco: false })
  assert.equal(s.world.ecoBattleAction(outdated.actor, { battleId: battle.battleId }, outdated.client), 'client-outdated')
  assert.equal(core.submits.length, 2)
})

test('A03 identity, area and distance are the server\'s: range boundary 3 / 4, other area, guest', async () => {
  const s = await setup()
  const a = s.join('eco-a')
  const target = s.populated(a)
  s.standNear(a, target.id, ECO_ENGAGE_RANGE + 1)
  assert.equal(s.engage(a, target.id).reason, 'too-far')
  a.actor.tx -= 2 * (ECO_ENGAGE_RANGE + 1) // the other side, out of range too
  assert.equal(s.engage(a, target.id).reason, 'too-far')
  s.standNear(a, target.id)
  a.actor.ty += ECO_ENGAGE_RANGE + 1
  assert.equal(s.engage(a, target.id).reason, 'too-far', 'Chebyshev: one axis is enough')
  a.actor.areaId = 'ciudad-corazon'
  assert.equal(s.engage(a, target.id).reason, 'other-area')
  const guest = s.join('guest', { guest: true })
  assert.equal(s.world.ecoEngage(null, { requestId: 1, encounterId: target.id }, guest.client).reason, 'not-player')
  // a socket that is not the player's current one
  assert.equal(s.world.ecoEngage(a.actor, { requestId: 1, encounterId: target.id }, fakeClient('stray')).reason, 'client-outdated')
  const stale = a.client
  s.join('eco-a', { actor: a.actor })
  s.standNear(a, target.id)
  assert.equal(s.world.ecoEngage(a.actor, { requestId: 1, encounterId: target.id }, stale).reason, 'not-current-socket')
  assert.equal(s.scripted.made.length, 0)
  const fresh = { ...a, client: s.sockets.get('eco-a') }
  s.standNear(fresh, target.id, ECO_ENGAGE_RANGE)
  assert.equal(s.engage(fresh, target.id).ok, true, `exactly ${ECO_ENGAGE_RANGE} tiles is in range`)
})

test('A04 only a live individual id: unknown, retired, old generation and malformed ids are refused', async () => {
  const s = await setup()
  const a = s.join('eco-a')
  const target = s.populated(a)
  s.standNear(a, target.id)
  assert.equal(s.engage(a, 'not an id').reason, 'invalid')
  assert.equal(s.world.ecoEngage(a.actor, { requestId: 0, encounterId: target.id }, a.client).reason, 'invalid')
  assert.equal(s.engage(a, target.id.replace(/^eco-[^:]+/, 'eco-other')).reason, 'not-alive', 'another namespace (an older process)')
  const [ns, area, nest, generation, member] = target.id.split(':')
  assert.equal(s.engage(a, [ns, area, nest, Number(generation) + 7, member].join(':')).reason, 'not-alive', 'a generation that does not exist')
  assert.equal(s.world.ecoDevRetire(a.actor, { requestId: 1, encounterId: target.id }, a.client).ok, true)
  assert.equal(s.engage(a, target.id).reason, 'not-alive', 'a retired individual')
  assert.equal(s.scripted.made.length, 0)
})

test('A05 one reservation per player; late and repeated intents are no-ops', async () => {
  const s = await setup()
  const a = s.join('eco-a')
  const target = s.populated(a)
  const other = s.ecoOf(a.client).encounters.find(e => e.id !== target.id)
  s.standNear(a, target.id)
  const { battle } = s.engage(a, target.id)
  s.standNear(a, other.id)
  assert.equal(s.engage(a, other.id).reason, 'already-battling')
  s.standNear(a, target.id)
  const again = s.engage(a, target.id, 2)
  assert.equal(again.ok, true)
  assert.equal(again.battle.battleId, battle.battleId, 'the same battle again, never a second one')
  assert.equal(s.scripted.made.length, 1)
  s.scripted.made[0].result = 'defeat'
  s.run(TICK)
  assert.equal(ended(a.client).length, 1)
  assert.equal(s.action(a, battle.battleId, 1), 'no-battle', 'an action after the end')
  assert.equal(s.world.ecoFlee(a.actor, { battleId: battle.battleId }, a.client), false, 'a flee after the end')
  assert.equal(lastMessage(a.client, WORLD_MESSAGE.ECO_BATTLE).result.reason, 'no-battle')
  s.run(TICK)
  assert.equal(ended(a.client).length, 1, 'one end, once')
  assert.equal(s.scripted.made[0].submits.length, 0)
})

test('A06 capture and items never reach the core through the transport (real bundle)', async () => {
  const s = await setup({ prepare: prepareBundledBattles, random: () => 7.5 / 0x7fffffff })
  const a = s.join('eco-a')
  const target = s.populated(a)
  s.standNear(a, target.id)
  const { battle } = s.engage(a, target.id)
  const capture = s.action(a, battle.battleId, 1, { kind: 'capture', combatantId: 'player-0', targetId: 'wild-0', ballId: 'poke-ball' })
  const item = s.action(a, battle.battleId, 2, { kind: 'useItem', combatantId: 'player-0', targetId: 'player-0', item: { itemId: 'potion' } })
  for (const r of [capture, item]) assert.equal(r.reason, 'NOT_ALLOWED_IN_SANDBOX')
  assert.equal(s.reservation('eco-a').battle.joinAck('eco-a').nextActionSequence, 1, 'nothing entered the ledger')
})

test('A07 victory retires exactly that individual for everyone, once; the nest respawns as before', async () => {
  const s = await setup()
  const a = s.join('eco-a')
  const b = s.join('eco-b')
  const target = s.populated(a)
  let retires = 0
  const original = s.world.eco.retireVictory.bind(s.world.eco)
  s.world.eco.retireVictory = (...args) => { retires++; return original(...args) }
  s.standNear(a, target.id)
  const { battle } = s.engage(a, target.id)
  // a test retirement cannot skip the battle, not even by its owner
  assert.equal(s.world.ecoDevRetire(a.actor, { requestId: 5, encounterId: target.id }, a.client).reason, 'busy')
  assert.equal(s.world.ecoDevRetire(b.actor, { requestId: 5, encounterId: target.id }, b.client).reason, 'busy')
  const others = s.ecoOf(a.client).encounters.filter(e => e.id !== target.id).map(e => e.id)
  s.scripted.made[0].result = 'victory'
  s.run(TICK)
  assert.equal(retires, 1)
  assert.deepEqual(ended(a.client), [{ battleId: battle.battleId, encounterId: target.id, outcome: 'victory', retired: true, snapshot: { battleId: battle.battleId, timeMs: 0 } }])
  assert.deepEqual(ended(b.client), [], 'the end is the owner\'s')
  for (const p of [a, b]) {
    const seen = s.ecoOf(p.client).encounters.map(e => e.id)
    assert.equal(seen.includes(target.id), false, 'gone for everyone')
    for (const id of others) if (s.world.eco.encounter(id)) assert.ok(seen.includes(id), 'only that individual')
  }
  // a second retirement, from anywhere, is a no-op
  assert.equal(s.world.ecoDevRetire(a.actor, { requestId: 6, encounterId: target.id }, a.client).reason, 'not-alive')
  assert.equal(s.world.eco.retireVictory(target.id), false)
  assert.equal(s.engage(a, target.id).reason, 'not-alive')
  s.run(TICK * 4)
  assert.equal(ended(a.client).length, 1)
  const [ns, area, nest, generation] = target.groupId.split(':')
  assert.ok(s.run(300_000, () => s.ecoOf(b.client).encounters.some(e => e.id.startsWith(`${ns}:${area}:${nest}:`) && Number(e.id.split(':')[3]) > Number(generation))), 'the existing respawn cycle')
})

test('A08 defeat, draw, flight and expiry release without retiring; the encounter can be fought again', async () => {
  for (const exit of ['defeat', 'draw', 'fled', 'expired']) {
    const s = await setup()
    const a = s.join('eco-a')
    const target = s.populated(a)
    let retires = 0
    s.world.eco.retireVictory = () => { retires++; return true }
    s.standNear(a, target.id)
    const { battle } = s.engage(a, target.id)
    const core = s.scripted.made[0]
    if (exit === 'fled') {
      assert.equal(s.world.ecoFlee(a.actor, { battleId: 'eco-battle-x-00000000' }, a.client), false, 'another battle id')
      assert.equal(s.world.ecoFlee(a.actor, { battleId: battle.battleId }, a.client), true)
    } else if (exit === 'expired') {
      s.run(ECO_BATTLE_MAX_MS - TICK)
      assert.equal(core.elapsed, ECO_BATTLE_MAX_MS - TICK)
      assert.equal(ended(a.client).length, 0, 'still running one tick before the limit')
      s.clock.advance(1_000) // a late tick: the last step is cut at the limit exactly
      s.world.tick()
      assert.equal(core.elapsed, ECO_BATTLE_MAX_MS)
    } else {
      core.result = exit
      s.run(TICK)
    }
    assert.deepEqual(ended(a.client).map(e => [e.outcome, e.retired]), [[exit, false]])
    assert.equal(retires, 0)
    s.world.flush()
    const seen = s.ecoOf(a.client).encounters.find(e => e.id === target.id)
    if (s.world.eco.encounter(target.id)) {
      assert.equal(seen.busy, false, 'free again')
      s.standNear(a, target.id)
      const again = s.engage(a, target.id, 2)
      assert.equal(again.ok, true)
      assert.notEqual(again.battle.battleId, battle.battleId, 'a new battle')
      assert.equal(s.action(a, battle.battleId, 1), 'not-your-battle', 'the old battle id cannot touch the new reservation')
    }
  }
})

test('A08b the rules decide first: a battle decided on the step that reaches the limit is not expired', async () => {
  const s = await setup()
  const a = s.join('eco-a')
  const target = s.populated(a)
  s.standNear(a, target.id)
  s.engage(a, target.id)
  const core = s.scripted.made[0]
  s.run(ECO_BATTLE_MAX_MS - TICK)
  const advance = core.advance
  core.advance = ms => { const step = advance(ms); core.result = 'defeat'; return { ...step, outcome: 'defeat' } }
  s.run(TICK)
  assert.deepEqual(ended(a.client).map(e => e.outcome), ['defeat'])
})

test('A09 disconnection pauses the battle clock; reconnection inside the grace resumes it; the grace releases', async () => {
  const s = await setup()
  const a = s.join('eco-a')
  const target = s.populated(a)
  s.standNear(a, target.id)
  const { battle } = s.engage(a, target.id)
  const core = s.scripted.made[0]
  s.run(1_000)
  const before = core.elapsed
  s.world.leave(a.client)
  s.sockets.delete('eco-a')
  s.run(ECO_DISCONNECT_GRACE_MS - 1_000)
  assert.equal(core.elapsed, before, 'no battle time passes while the owner is away')
  assert.equal(s.world.ecoBattles.isBusy(target.id), true, 'still reserved: nobody else can take it')
  // nobody watched Pradera: hidden (idle), not gone — the reservation does not read it as vanished
  assert.equal(s.world.eco.encounter(target.id), null)
  assert.equal(s.world.eco.alive(target.id), true)
  const b = s.join('eco-b')
  s.run(500) // the area is simulated again at its next population tick
  s.standNear(b, target.id)
  assert.equal(s.engage(b, target.id).reason, 'busy')
  // back inside the grace, with a new socket: the same battle, never a second one
  const back = s.join('eco-a', { actor: a.actor })
  const resumed = lastMessage(back.client, WORLD_MESSAGE.ECO_ENGAGE_RESULT)
  assert.equal(resumed.resumed, true)
  assert.equal(resumed.battle.battleId, battle.battleId)
  assert.equal(resumed.battle.expiresInMs, ECO_BATTLE_MAX_MS - before)
  assert.equal(resumed.battle.joinAck.controllerId, 'eco-a')
  s.run(TICK)
  assert.equal(core.elapsed, before + TICK, 'resumes from where it paused (the pause is not battle time)')
  assert.equal(s.scripted.made.length, 1)
  // gone again, past the grace: released (nothing retired), counted from the close of the CURRENT socket
  s.world.leave(back.client)
  s.sockets.delete('eco-a')
  s.run(ECO_DISCONNECT_GRACE_MS - TICK)
  assert.equal(s.world.ecoBattles.isBusy(target.id), true)
  s.run(250)
  assert.equal(s.world.ecoBattles.isBusy(target.id), false, 'released at most one ECO tick after the grace')
  assert.equal(s.world.ecoBattles.stats().ended.disconnected, 1)
  assert.ok(s.world.eco.encounter(target.id), 'not retired')
  // a reconnection after the release gets no battle back
  const late = s.join('eco-a', { actor: a.actor })
  assert.equal(lastMessage(late.client, WORLD_MESSAGE.ECO_ENGAGE_RESULT), undefined)
  assert.equal(s.action(late, battle.battleId, 1), 'no-battle')
})

test('A10 races: flight vs victory, victory vs flight, victory vs test retirement, leaving the area', async () => {
  // flight first: the battle stops; a "victory" afterwards cannot retire anything
  {
    const s = await setup()
    const a = s.join('eco-a')
    const target = s.populated(a)
    s.standNear(a, target.id)
    const { battle } = s.engage(a, target.id)
    s.scripted.made[0].result = 'victory'
    assert.equal(s.world.ecoFlee(a.actor, { battleId: battle.battleId }, a.client), true)
    s.run(TICK * 2)
    assert.deepEqual(ended(a.client).map(e => [e.outcome, e.retired]), [['fled', false]])
    assert.ok(s.world.eco.encounter(target.id))
  }
  // victory first: the flight that arrives later is a no-op; a test retirement finds nothing
  {
    const s = await setup()
    const a = s.join('eco-a')
    const target = s.populated(a)
    s.standNear(a, target.id)
    const { battle } = s.engage(a, target.id)
    s.scripted.made[0].result = 'victory'
    s.run(TICK)
    assert.equal(s.world.ecoFlee(a.actor, { battleId: battle.battleId }, a.client), false)
    assert.equal(s.world.ecoDevRetire(a.actor, { requestId: 1, encounterId: target.id }, a.client).reason, 'not-alive')
    assert.deepEqual(ended(a.client).map(e => e.outcome), ['victory'])
  }
  // leaving the area releases (no retire); the battle does not follow
  {
    const s = await setup()
    const a = s.join('eco-a')
    const target = s.populated(a)
    s.standNear(a, target.id)
    s.engage(a, target.id)
    a.actor.areaId = 'ciudad-corazon'
    s.world.actorPlaced(a.actor)
    assert.deepEqual(ended(a.client).map(e => [e.outcome, e.retired]), [['left-area', false]])
    assert.equal(s.world.ecoBattles.isBusy(target.id), false)
  }
  // the encounter vanishing under a battle (not by a victory) releases it as `vanished`
  {
    const s = await setup()
    const a = s.join('eco-a')
    const target = s.populated(a)
    s.standNear(a, target.id)
    s.engage(a, target.id)
    const alive = s.world.eco.alive.bind(s.world.eco)
    s.world.eco.alive = id => (id === target.id ? false : alive(id))
    s.run(TICK)
    assert.deepEqual(ended(a.client).map(e => e.outcome), ['vanished'])
  }
})

test('A11 fail closed: no admission, no battles, failed creation, experiment off, outdated client', async () => {
  const off = await setup({ ecoExperiment: false })
  const p = off.join('eco-a')
  assert.equal(off.world.ecoBattles, null)
  assert.equal(off.world.ecoEngage(p.actor, { requestId: 1, encounterId: 'eco-x:pradera:n:1:0' }, p.client).reason, 'disabled')
  assert.equal(off.world.ecoBattleAction(p.actor, {}, p.client), 'disabled')
  // the bundle (or catalog) did not load: encounters are seen, never fought
  const none = await setup({ prepare: async () => ({ ok: false, reason: 'catalog-unavailable' }) })
  const a = none.join('eco-a')
  const target = none.populated(a)
  none.standNear(a, target.id)
  assert.equal(none.world.ecoBattles.status, 'unavailable')
  assert.equal(none.engage(a, target.id).reason, 'battle-unavailable')
  const thrown = await setup({ prepare: async () => { throw new Error('boom') } })
  assert.equal(thrown.world.ecoBattles.status, 'unavailable')
  // the authority could not be created: nothing stays reserved
  const failing = await setup()
  const f = failing.join('eco-a')
  const t2 = failing.populated(f)
  failing.standNear(f, t2.id)
  failing.scripted.battles.fail = true
  assert.equal(failing.engage(f, t2.id).reason, 'battle-unavailable')
  assert.equal(failing.world.ecoBattles.isBusy(t2.id), false)
  failing.scripted.battles.fail = false
  assert.equal(failing.engage(f, t2.id).ok, true)
  // no admitted population
  const unadmitted = new EcoBattles({ population: { status: 'unavailable' }, now: () => 0, send: () => {}, prepare: async () => ({ ok: true, battles: {} }), log: () => {} })
  await unadmitted.ready
  const c = fakeClient('x')
  assert.equal(unadmitted.engage({ id: 'x' }, { requestId: 1, encounterId: 'eco-x:pradera:n:1:0' }, c, c).reason, 'unavailable')
  // a client that did not declare the ECO protocol
  const s = await setup()
  const old = s.join('eco-old', { eco: false })
  assert.equal(s.world.ecoEngage(old.actor, { requestId: 1, encounterId: 'eco-x:pradera:n:1:0' }, old.client).reason, 'client-outdated')
})

test('A12 nothing persists: no player data, ownership or store is touched by a whole battle cycle', async () => {
  const touched = []
  const playerData = new Proxy({ loadNodes: async () => [], playerState: async () => ({ xp: {}, materials: {}, pokemon: [] }) }, {
    get(target, key) { if (typeof key === 'string' && !['loadNodes', 'playerState', 'then'].includes(key)) touched.push(key); return target[key] },
  })
  const s = await setup({ playerData })
  const a = s.join('eco-a')
  const target = s.populated(a)
  s.standNear(a, target.id)
  const { battle } = s.engage(a, target.id)
  s.action(a, battle.battleId, 1)
  s.scripted.made[0].result = 'victory'
  s.run(TICK)
  s.standNear(a, s.ecoOf(a.client).encounters[0].id)
  s.engage(a, s.ecoOf(a.client).encounters[0].id, 2)
  s.world.ecoFlee(a.actor, { battleId: s.reservation('eco-a').battleId }, a.client)
  assert.deepEqual(touched.filter(key => key !== 'metrics'), [], 'only the reads every world join already makes')
  assert.equal(s.world.authority.store.size, 0, 'no world node changed')
})

// ── Review findings on 001197f (F1–F3): regressions ──

test('F1 a socket replaced by one WITHOUT the ECO protocol (or an outdated one) loses the battle at once, before its onLeave', async () => {
  for (const kind of ['no-eco', 'outdated']) {
    const s = await setup()
    const a = s.join('eco-a')
    const target = s.populated(a)
    s.standNear(a, target.id)
    const { battle } = s.engage(a, target.id)
    const core = s.scripted.made[0]
    assert.equal(s.action(a, battle.battleId, 1).kind, 'accepted')
    const old = a.client
    // the new socket becomes the player's current one; the old one's onLeave has not run yet
    let fresh
    if (kind === 'no-eco') fresh = s.join('eco-a', { eco: false, actor: a.actor }).client
    else { fresh = fakeClient('eco-a-outdated'); s.sockets.set('eco-a', fresh); s.world.join(fresh, {}, { kind: 'player', userId: 'eco-a', token: null }) }
    const before = old.messages.length
    assert.equal(s.world.ecoBattleAction(a.actor, { actionId: 'eco-a:1', battleId: battle.battleId }, old), 'not-your-battle', `${kind}: replay of an accepted action`)
    assert.equal(s.action(a, battle.battleId, 2), 'not-your-battle', `${kind}: a new action`)
    assert.equal(s.world.ecoFlee(a.actor, { battleId: battle.battleId }, old), false, `${kind}: flee`)
    assert.equal(core.submits.length, 1, 'nothing reached the ledger')
    const elapsed = core.elapsed
    s.run(1_000)
    assert.equal(core.elapsed, elapsed, 'paused: no socket of the player can follow it')
    const after = old.messages.slice(before)
    assert.ok(after.every(m => m.type !== WORLD_MESSAGE.ECO_BATTLE || m.payload.snapshot === undefined), 'no snapshot to the replaced socket')
    assert.deepEqual(after.filter(m => m.type === WORLD_MESSAGE.ECO_BATTLE_END), [])
    assert.equal(s.world.ecoBattles.isBusy(target.id), true, 'still reserved inside the grace')
    // the old socket's late onLeave changes nothing; an ECO socket inside the grace takes the battle back
    s.world.leave(old)
    const back = s.join('eco-a', { actor: a.actor })
    assert.equal(lastMessage(back.client, WORLD_MESSAGE.ECO_ENGAGE_RESULT).battle.battleId, battle.battleId)
    assert.equal(s.action(back, battle.battleId, 2).kind, 'accepted')
    s.world.leave(fresh)
    assert.equal(s.reservation('eco-a').client, back.client, 'the intermediate socket leaving does not pause it again')
  }
})

test('F2 a reconnection is checked against the grace BEFORE resuming: before, at and after the limit, with no tick in between', async () => {
  for (const [offset, resumes] of [[ECO_DISCONNECT_GRACE_MS - 1, true], [ECO_DISCONNECT_GRACE_MS, false], [ECO_DISCONNECT_GRACE_MS + 1, false]]) {
    const s = await setup()
    const a = s.join('eco-a')
    const b = s.join('eco-b') // keeps Pradera active
    const target = s.populated(a)
    s.standNear(a, target.id)
    const { battle } = s.engage(a, target.id)
    s.world.leave(a.client)
    s.sockets.delete('eco-a')
    s.clock.advance(offset) // no tick: the limit falls between callbacks
    const back = s.join('eco-a', { actor: a.actor })
    const resumed = lastMessage(back.client, WORLD_MESSAGE.ECO_ENGAGE_RESULT)
    if (resumes) {
      assert.equal(resumed?.battle.battleId, battle.battleId, `+${offset} ms resumes`)
      s.run(TICK)
      assert.equal(s.world.ecoBattles.isBusy(target.id), true)
    } else {
      assert.equal(resumed, undefined, `+${offset} ms is past the grace: nothing to resume`)
      assert.equal(s.world.ecoBattles.isBusy(target.id), false, 'released at once, not at the next tick')
      assert.deepEqual(s.world.ecoBattles.stats().ended, { disconnected: 1 })
      assert.ok(s.world.eco.alive(target.id), 'not retired')
      assert.equal(s.action(back, battle.battleId, 1), 'no-battle')
      // the same player may engage it again (a new battle), and so may anyone else
      s.standNear(b, target.id)
      assert.equal(s.engage(b, target.id).ok, true)
    }
  }
  // the engage path too: an engage after the grace (no tick yet) does not resume the old battle
  const s = await setup()
  const a = s.join('eco-a')
  s.join('eco-b')
  const target = s.populated(a)
  s.standNear(a, target.id)
  const { battle } = s.engage(a, target.id)
  s.world.leave(a.client)
  s.clock.advance(ECO_DISCONNECT_GRACE_MS)
  const back = s.join('eco-a', { eco: false, actor: a.actor }) // no automatic resume for a non-ECO socket
  back.client.messages.length = 0
  const eco = s.join('eco-a', { actor: a.actor })
  s.standNear(eco, target.id)
  const again = s.engage(eco, target.id, 9)
  assert.equal(again.ok, true)
  assert.notEqual(again.battle.battleId, battle.battleId, 'a new battle, never the expired one')
})

test('F3 alive is the exact individual: shown or hidden (idle) is alive; retired, never spawned or cleared is not', async () => {
  const s = await setup()
  const a = s.join('eco-a')
  const target = s.populated(a)
  const [ns, area, nest, generation, member] = target.id.split(':')
  assert.equal(s.world.eco.alive(target.id), true)
  assert.equal(s.world.eco.alive([ns, area, nest, Number(generation) + 100, member].join(':')), false, 'a generation that never spawned')
  assert.equal(s.world.eco.alive([ns, area, nest, generation, 99].join(':')), false, 'a member that never spawned')
  assert.equal(s.world.eco.alive(target.id.replace(/^eco-[^:]+/, 'eco-other')), false)
  // hidden, not gone: nobody watches the area (idle)
  s.world.leave(a.client)
  s.run(1_000)
  assert.equal(s.world.eco.encounter(target.id), null)
  assert.equal(s.world.eco.alive(target.id), true)
  // dormant clears the individuals: no longer alive
  s.run(5 * 60_000 + 5_000)
  assert.equal(s.world.eco.alive(target.id), false)
  // a retired individual is not alive
  const s2 = await setup()
  const p = s2.join('eco-a')
  const t2 = s2.populated(p)
  assert.equal(s2.world.ecoDevRetire(p.actor, { requestId: 1, encounterId: t2.id }, p.client).ok, true)
  assert.equal(s2.world.eco.alive(t2.id), false)
})

test('F3 an individual that disappears under a reservation (server-side transition) ends it as vanished, nothing retired twice', async () => {
  const s = await setup()
  const a = s.join('eco-a')
  const target = s.populated(a)
  s.standNear(a, target.id)
  s.engage(a, target.id)
  // a server-side removal of the reserved individual (no client path exists: dev retire answers busy)
  assert.equal(s.world.eco.retireVictory(target.id), true)
  s.run(TICK)
  assert.deepEqual(ended(a.client).map(e => [e.outcome, e.retired]), [['vanished', false]])
  assert.equal(s.world.ecoBattles.isBusy(target.id), false)
})

// ── The REAL test-battle bundle through the whole reservation cycle (fixed seed 7) ──
// Reproductions with a FIXED seed: in the sandbox the server draws a random seed per battle, so a
// human reproduces the outcome kind, not these exact times. The species is forced (the bundle's
// start is wrapped) because which species stands near the player is the population's draw.


test('seed 7 · Rattata · Impactrueno (#84): victory around 11 s, retired once', async () => {
  const { s, a, target, battle } = await realCycle(19)
  assert.equal(s.action(a, battle.battleId, 1, { kind: 'useMove', combatantId: 'player-0', moveId: 84, targetId: 'wild-0' }).kind, 'accepted')
  s.run(30_000, () => ended(a.client).length > 0)
  const [end] = ended(a.client)
  assert.equal(end.outcome, 'victory')
  assert.equal(end.retired, true)
  assert.ok(end.snapshot.timeMs > 10_000 && end.snapshot.timeMs < 12_000, `battle time ${end.snapshot.timeMs}`)
  assert.equal(s.world.eco.encounter(target.id), null)
  assert.ok(messagesOf(a.client, WORLD_MESSAGE.ECO_BATTLE).some(m => m.events.some(e => e.event.type === 'BATTLE_ENDED')))
})

test('seed 7 · Geodude · no orders: defeat around 24 s, released and not retired', async () => {
  const { s, a, target } = await realCycle(74)
  s.run(60_000, () => ended(a.client).length > 0)
  const [end] = ended(a.client)
  assert.deepEqual([end.outcome, end.retired], ['defeat', false])
  assert.ok(end.snapshot.timeMs > 22_000 && end.snapshot.timeMs < 26_000, `battle time ${end.snapshot.timeMs}`)
  assert.ok(s.world.eco.encounter(target.id), 'still in the world')
  assert.equal(s.world.ecoBattles.isBusy(target.id), false)
})

test('seed 7 · Metapod · Onda Trueno (#86) then Doble Equipo (#104) at ~65 s: alive at 120 s → expired, released', async () => {
  const { s, a, target, battle, elapsed } = await realCycle(11)
  assert.equal(s.action(a, battle.battleId, 1, { kind: 'useMove', combatantId: 'player-0', moveId: 86, targetId: 'wild-0' }).kind, 'accepted')
  s.run(70_000, () => elapsed() >= 65_000)
  assert.equal(s.action(a, battle.battleId, 2, { kind: 'useMove', combatantId: 'player-0', moveId: 104, targetId: 'player-0' }).kind, 'accepted')
  s.run(ECO_BATTLE_MAX_MS, () => ended(a.client).length > 0)
  const [end] = ended(a.client)
  assert.deepEqual([end.outcome, end.retired], ['expired', false])
  assert.equal(end.snapshot.timeMs, ECO_BATTLE_MAX_MS, 'battle time stops at the limit exactly')
  assert.equal(end.snapshot.outcome.kind, 'ongoing', 'undecided by the rules')
  assert.ok(s.world.eco.encounter(target.id), 'still in the world')
  assert.equal(s.action(a, battle.battleId, 3), 'no-battle')
})
