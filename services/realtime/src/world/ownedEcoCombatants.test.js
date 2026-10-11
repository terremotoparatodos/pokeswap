import assert from 'node:assert/strict'
import test from 'node:test'
import { setup } from './ecoBattlesTestkit.js'
import { prepareBundledBattles, ECO_DISCONNECT_GRACE_MS } from './ecoBattles.js'
import { lastMessage, settle, keysDeep } from './testing.js'
import { WORLD_MESSAGE as M } from './worldProtocol.js'
import { worldDependencies } from './worldConfig.js'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
// Scripted read adapter, NOT real account data. Stats come from catalog/M-1, not from this fixture.
const row = (user, species = 25, moves = ['thunder-shock', 'quick-attack']) => ({
  slot: { pokemon_id: species, owner_id: user, is_locked: false, first_owner_id: user, owned_since: null },
  progression: { user_id: user, pokemon_id: species, xp: 4356, level: 12, moves },
})
async function owned() {
  const source = new Map([[A, [row(A), row(A, 19, ['tackle'])]], [B, [row(B, 43, ['absorb'])]]])
  let read = async (id, slot) => structuredClone((source.get(id) ?? []).filter(row => slot === null || row.slot.pokemon_id === slot))
  let reads = 0
  const playerData = { loadNodes: async () => [], playerState: async () => ({ xp: {}, materials: {}, pokemon: [] }),
    readEcoCombatants: (...args) => { reads++; return read(...args) } }
  const s = await setup({ prepare: prepareBundledBattles, ecoCombatantMode: 'owned', playerData })
  return { ...s, source, setRead: fn => { read = fn }, reads: () => reads }
}
const select = (s, a, slot = 25, extra = {}) => s.world.ecoCombatantSelect(a.actor, { requestId: 1, slotPokemonId: slot, ...extra }, a.client)
const engage = (s, a, target) => s.world.ecoEngage(a.actor, { requestId: 1, encounterId: target.id }, a.client)

test('owned choices are private, independent and strict; benchmark/guest/forged data have no read access', async () => {
  const s = await owned(), a = s.join(A), b = s.join(B)
  await settle()
  assert.equal(lastMessage(a.client, M.ECO_COMBATANT_STATE).mode, 'owned')
  assert.equal(lastMessage(a.client, M.ECO_COMBATANT_STATE).speciesId, null)
  assert.equal((await select(s, a)).speciesId, 25)
  assert.equal((await select(s, b, 43)).speciesId, 43)
  assert.equal((await select(s, a, 43)).reason, 'not-owner')
  for (const extra of [{ stats: {} }, { moves: [] }, { speciesId: 25 }, { level: 100 }, { userId: B }]) assert.equal((await select(s, a, 25, extra)).reason, 'invalid')
  const benchmark = s.join('benchmark-one'), guest = s.join('guest', { guest: true })
  await settle()
  const count = s.reads()
  assert.equal((await select(s, benchmark)).reason, 'not-player')
  assert.equal((await select(s, guest)).reason, 'not-player')
  assert.equal(s.reads(), count)
  assert.equal(s.world.ecoBattles.combatants.state(A).speciesId, 25)
  assert.equal(s.world.ecoBattles.combatants.state(B).speciesId, 43)
})

test('fresh lock/sale is refused at selection and engage without a reservation or fixture fallback', async () => {
  const s = await owned(), a = s.join(A)
  await settle()
  s.source.get(A)[0].slot.is_locked = true
  assert.equal((await select(s, a)).reason, 'locked')
  s.source.get(A)[0].slot.is_locked = false
  await select(s, a)
  const target = s.populated(a); s.standNear(a, target.id)
  s.source.get(A)[0].slot.is_locked = true
  assert.equal((await engage(s, a, target)).reason, 'locked')
  s.source.set(A, [])
  assert.equal((await engage(s, a, target)).reason, 'not-owner')
  assert.equal(s.world.ecoBattles.active, 0)
})

test('pending reads serialize selection/engage and recheck the live socket before confirming', async () => {
  const s = await owned(), a = s.join(A)
  await settle()
  let answer
  s.setRead(() => new Promise(resolve => { answer = resolve }))
  const selecting = select(s, a)
  assert.equal((await select(s, a, 19)).reason, 'selection-pending')
  s.setRead(async () => [row(A)])
  const replacement = s.join(A, { actor: a.actor })
  answer([row(A)])
  assert.equal((await selecting).ok, false)
  assert.equal(s.world.ecoBattles.combatants.state(A).speciesId, null)
  // Resolve the replacement's own refresh; it must not be invalidated by the old operation.
  await settle()
  await s.world.ecoBattles.combatants.refresh(replacement.actor, replacement.client)
})

test('start rechecks movement, replacement, choice and encounter contention after asynchronous data', async () => {
  for (const mutation of ['move', 'replace', 'choice', 'contend']) {
    const s = await owned(), a = s.join(A), b = s.join(B)
    await settle(); await select(s, a); await select(s, b, 43)
    const target = s.populated(a); s.standNear(a, target.id); s.standNear(b, target.id)
    let release
    s.setRead((id) => id === A ? new Promise(resolve => { release = resolve }) : Promise.resolve([row(B, 43, ['absorb'])]))
    const starting = engage(s, a, target)
    assert.equal((await select(s, a, 19)).reason, 'selection-pending')
    if (mutation === 'move') { a.actor.tx += 100 }
    if (mutation === 'replace') { s.setRead(async () => [row(A)]); s.join(A, { actor: a.actor }) }
    if (mutation === 'choice') s.world.ecoBattles.combatants.choices.delete(A)
    if (mutation === 'contend') assert.equal((await engage(s, b, target)).ok, true)
    release([row(A)])
    assert.equal((await starting).ok, false, mutation)
    assert.equal(s.world.ecoBattles.byPlayer.has(A), false, mutation)
  }
})

test('real authority snapshot, public view, grace/reconnect and flee preserve the chosen owned instance', async () => {
  const s = await owned(), a = s.join(A), viewer = s.join(B)
  await settle(); await select(s, a)
  const target = s.populated(a); s.standNear(a, target.id)
  const result = await engage(s, a, target)
  assert.equal(result.ok, true)
  const c = result.battle.snapshot.combatants['player-0']
  assert.equal(c.instance.instanceId, 'legacy-slot:25')
  assert.equal(c.instance.ownership.ownerId, A)
  const publicView = lastMessage(viewer.client, M.ECO_BATTLE_PUBLIC)
  assert.equal(publicView.combatants['player-0'].speciesId, c.instance.speciesId)
  assert.equal(publicView.combatants['player-0'].maxHp, c.stats.hp)
  for (const field of ['ownerId', 'instanceId', 'ivs', 'evs', 'moves', 'experience', 'natureId']) assert.equal(keysDeep(publicView).has(field), false, field)
  assert.equal((await select(s, a, 19)).reason, 'in-battle')
  s.world.leave(a.client)
  assert.equal(s.world.ecoBattles.combatants.inBattle(A), true)
  const a2 = s.join(A, { actor: a.actor }); await settle()
  assert.equal((await select(s, a2, 19)).reason, 'in-battle')
  const resumed = await engage(s, a2, target)
  assert.equal(resumed.battle.battleId, result.battle.battleId)
  s.world.ecoFlee(a2.actor, { battleId: result.battle.battleId }, a2.client)
  await select(s, a2, 19)
  const next = await engage(s, a2, target)
  assert.equal(next.battle.snapshot.combatants['player-0'].instance.speciesId, 19)
  assert.notEqual(next.battle.battleId, result.battle.battleId)
  s.world.leave(a2.client); s.clock.advance(ECO_DISCONNECT_GRACE_MS + 1); s.world.tick()
  assert.equal(s.world.ecoBattles.active, 0)
})

test('owned mode remains development-only and invalid modes cannot silently become synthetic', () => {
  for (const env of [{ NODE_ENV: 'production', WORLD_ECO_COMBATANT_MODE: 'owned' },
    { WORLD_ECO_COMBATANT_MODE: 'owned' }, { WORLD_ECO_COMBATANT_MODE: 'typo' }]) assert.throws(() => worldDependencies(env))
  assert.equal(worldDependencies({ WORLD_ECO_EXPERIMENT: 'on', WORLD_ECO_COMBATANT_MODE: 'owned' }).ecoCombatantMode, 'owned')
  assert.equal(worldDependencies({ WORLD_ECO_EXPERIMENT: 'on', WORLD_ECO_COMBATANT_MODE: 'synthetic' }).ecoCombatantMode, 'synthetic')
})
