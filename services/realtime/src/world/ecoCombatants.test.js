import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareBundledBattles, ECO_DISCONNECT_GRACE_MS } from './ecoBattles.js'
import { setup } from './ecoBattlesTestkit.js'
import { WORLD_MESSAGE as M } from './worldProtocol.js'
import { lastMessage, messagesOf } from './testing.js'

const select = (s, p, speciesId, extra = {}) => s.world.ecoCombatantSelect(p.actor, { requestId: 1, speciesId, ...extra }, p.client)

test('valid, independent and idempotent choices; invalid and forged attributes leave state unchanged', async () => {
  const s = await setup()
  const a = s.join('a'), b = s.join('b')
  assert.equal(lastMessage(a.client, M.ECO_COMBATANT_STATE).speciesId, 25)
  assert.equal(select(s, a, 43).ok, true)
  assert.equal(select(s, a, 43).speciesId, 43)
  assert.equal(select(s, b, 74).speciesId, 74)
  for (const [id, extra, reason] of [[999, {}, 'invalid-species'], ['43', {}, 'invalid'], [25, { level: 100 }, 'invalid'],
    [25, { moves: [1] }, 'invalid'], [25, { stats: { hp: 999 } }, 'invalid'], [25, { playerId: 'b' }, 'invalid'], [25, { requestId: 0 }, 'invalid']]) {
    const result = select(s, a, id, extra)
    assert.equal(result.reason, reason)
    assert.equal(result.speciesId, 43)
  }
  s.world.snapshot(a.client, a.actor)
  assert.equal(lastMessage(a.client, M.ECO_COMBATANT_STATE).speciesId, 43)
  assert.equal(lastMessage(b.client, M.ECO_COMBATANT_STATE).speciesId, 74)
})

test('active reservation and disconnected grace reject changes; reconnect keeps choice and the frozen battle', async () => {
  const s = await setup({ prepare: prepareBundledBattles })
  const a = s.join('a'), viewer = s.join('viewer')
  select(s, a, 10)
  const target = s.populated(a)
  s.standNear(a, target.id)
  const { battle } = s.world.ecoEngage(a.actor, { requestId: 1, encounterId: target.id, playerSpeciesId: 25, stats: { hp: 999 } }, a.client)
  assert.equal(battle.snapshot.combatants['player-0'].instance.speciesId, 10, 'engage cannot override server choice')
  const view = lastMessage(viewer.client, M.ECO_BATTLE_PUBLIC)
  assert.equal(view.combatants['player-0'].speciesId, 10)
  assert.equal(view.combatants['player-0'].maxHp, battle.snapshot.combatants['player-0'].stats.hp)
  assert.equal(select(s, a, 25).reason, 'in-battle')
  s.world.leave(a.client)
  // A current replacement without ECO pauses the reservation but cannot change selection.
  const nonEco = s.join('a', { eco: false, actor: a.actor })
  assert.equal(select(s, nonEco, 25).reason, 'client-outdated')
  const direct = s.world.ecoBattles.combatants.select(a.actor, { requestId: 2, speciesId: 25 }, nonEco.client, nonEco.client)
  assert.equal(direct.reason, 'in-battle', 'server guard includes disconnected grace, even before a tick')
  s.clock.advance(ECO_DISCONNECT_GRACE_MS - 1)
  const rejoined = s.join('a', { actor: a.actor })
  assert.equal(lastMessage(rejoined.client, M.ECO_COMBATANT_STATE).speciesId, 10)
  const resumed = lastMessage(rejoined.client, M.ECO_ENGAGE_RESULT)
  assert.equal(resumed.battle.battleId, battle.battleId)
  assert.equal(resumed.battle.snapshot.combatants['player-0'].instance.speciesId, 10)
  assert.equal(select(s, rejoined, 25).reason, 'in-battle')
  s.world.ecoFlee(rejoined.actor, { battleId: battle.battleId }, rejoined.client)
  assert.equal(select(s, rejoined, 41).speciesId, 41)
  s.world.leave(rejoined.client)
  const again = s.join('a', { actor: a.actor })
  assert.equal(lastMessage(again.client, M.ECO_COMBATANT_STATE).speciesId, 41)
  const fresh = await setup()
  assert.equal(lastMessage(fresh.join('a').client, M.ECO_COMBATANT_STATE).speciesId, 25, 'restart may forget choice')
})

test('off, guest, outdated, replaced socket and unavailable factory fail closed', async () => {
  const off = await setup({ ecoExperiment: false })
  assert.equal(select(off, off.join('a'), 43).reason, 'disabled')
  const s = await setup()
  assert.equal(select(s, s.join('guest', { guest: true }), 43).reason, 'not-player')
  assert.equal(select(s, s.join('old', { eco: false }), 43).reason, 'client-outdated')
  const old = s.join('a')
  select(s, old, 43)
  const current = s.join('a', { actor: old.actor })
  const result = select(s, old, 74)
  assert.equal(result.reason, 'not-current-socket')
  assert.equal(result.speciesId, null)
  assert.equal(lastMessage(current.client, M.ECO_COMBATANT_STATE).speciesId, 43)
  const failed = await setup({ prepare: async () => ({ ok: false, reason: 'catalog-unavailable' }) })
  assert.equal(select(failed, failed.join('a'), 43).reason, 'battle-unavailable')
})

test('initial snapshot waits for factory preparation and does not send choices to retired sockets', async () => {
  let finish
  const s = await setup()
  s.world.ecoBattles.status = 'loading'
  s.world.ecoBattles.ready = new Promise(resolve => { finish = resolve })
  const old = s.join('a'), current = s.join('a', { actor: old.actor })
  assert.equal(messagesOf(current.client, M.ECO_COMBATANT_STATE).length, 0)
  finish()
  await s.world.ecoBattles.ready
  assert.equal(messagesOf(old.client, M.ECO_COMBATANT_STATE).length, 0)
  assert.equal(lastMessage(current.client, M.ECO_COMBATANT_STATE).speciesId, 25)
})
