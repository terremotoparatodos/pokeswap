import assert from 'node:assert/strict'
import test from 'node:test'
import { setup } from './ecoBattlesTestkit.js'
import { prepareBundledBattles } from './ecoBattles.js'
import { lastMessage, settle } from './testing.js'
import { WORLD_MESSAGE as M } from './worldProtocol.js'

const A = '11111111-1111-4111-8111-111111111111'
const playerReads = () => ({ loadNodes: async () => [], playerState: async () => ({ xp: {}, materials: {}, pokemon: [] }) })

test('synthetic room construction never looks up the owned read capability', async () => {
  const playerData = playerReads()
  Object.defineProperty(playerData, 'readEcoCombatants', { get() { throw new Error('synthetic must not inspect owned reads') } })
  const s = await setup({ playerData })
  assert.equal(s.world.ecoBattles.combatantMode, 'synthetic')
  assert.equal(s.world.ecoBattles.combatants.state(A).speciesId, 25)
})

test('owned room wires the authoritative reader with its receiver for refresh, selection and start', async () => {
  const calls = []
  const playerData = playerReads()
  // SCRIPTED slot/progression only: attributes are built by the real catalog/M-1.
  playerData.readEcoCombatants = async function (id, slot) {
    assert.equal(this, playerData)
    calls.push([id, slot])
    return [{ slot: { pokemon_id: 25, owner_id: A, is_locked: false, first_owner_id: A, owned_since: null },
      progression: { user_id: A, pokemon_id: 25, xp: 4356, level: 12, moves: ['thunder-shock', 'quick-attack'] } }]
  }
  const s = await setup({ playerData, ecoCombatantMode: 'owned', prepare: prepareBundledBattles })
  assert.deepEqual(calls, [], 'construction wires the capability without reading rows')
  const a = s.join(A)
  await settle()
  assert.deepEqual(calls, [[A, null]])
  assert.equal((await s.world.ecoCombatantSelect(a.actor, { requestId: 1, slotPokemonId: 25 }, a.client)).ok, true)
  const target = s.populated(a)
  s.standNear(a, target.id)
  const started = await s.world.ecoEngage(a.actor, { requestId: 2, encounterId: target.id }, a.client)
  assert.equal(started.ok, true)
  assert.deepEqual(calls, [[A, null], [A, 25], [A, 25]], 'start revalidates the selected authoritative slot')
  assert.equal(started.battle.snapshot.combatants['player-0'].instance.ownership.ownerId, A)
  assert.equal(s.world.ecoFlee(a.actor, { battleId: started.battle.battleId }, a.client), true)
})

test('owned room with player data but no combatant reader fails closed without a synthetic default', async () => {
  const s = await setup({ playerData: playerReads(), ecoCombatantMode: 'owned', prepare: prepareBundledBattles })
  const a = s.join(A)
  await settle()
  assert.equal(lastMessage(a.client, M.ECO_COMBATANT_STATE).reason, 'read-unavailable')
  assert.equal((await s.world.ecoCombatantSelect(a.actor, { requestId: 1, slotPokemonId: 25 }, a.client)).reason, 'read-unavailable')
  const target = s.populated(a)
  s.standNear(a, target.id)
  assert.equal((await s.world.ecoEngage(a.actor, { requestId: 2, encounterId: target.id }, a.client)).reason, 'no-combatant')
  const choice = s.world.ecoBattles.combatants.state(A)
  assert.equal(choice.mode, 'owned')
  assert.equal(choice.speciesId, null)
  assert.equal(choice.selectedSlotPokemonId, null)
  assert.deepEqual(choice.options, [])
  assert.equal(s.world.ecoBattles.active, 0)
})
