import { describe, expect, it } from 'vitest'

import {
  MAX_PP_UPS, isLostOnWipe, isValidInstance, maxPPOf, secureCapture, validateInstance,
} from './instance'
import type { InstanceCatalogView, PokemonInstance } from './instance'
import { MAX_PARTY_SIZE, addToParty, canWork, removeFromParty, validateParty } from './party'
import type { ActiveParty, PartyMemberView } from './party'
import { enterBattle, isFainted, leaveBattle } from './runtime'
import { PERFECT_IVS, ZERO_STATS } from './stats'

/** A catalog with one species, one form and two moves — enough to validate against. */
const catalog: InstanceCatalogView = {
  form: id => (id === 10 ? { speciesId: 1, abilities: { slot1: 100, slot2: null, hidden: 101 } } : null),
  species: id => (id === 1 ? { id } : null),
  move: id => (id === 200 ? { pp: 35 } : id === 201 ? { pp: 10 } : null),
  nature: id => (id === 5 ? { id } : null),
  ability: id => (id === 100 || id === 101 ? { id } : null),
}

const sound: PokemonInstance = {
  schemaVersion: 1,
  instanceId: 'inst-1',
  speciesId: 1,
  formId: 10,
  experience: 8000,
  natureId: 5,
  abilityId: 100,
  ivs: PERFECT_IVS,
  evs: ZERO_STATS,
  moves: [{ moveId: 200, ppUps: 0, currentPP: 35 }],
  currentHp: null,
  state: 'owned',
  ownership: { ownerId: 'player-1', originalTrainerId: 'player-1' },
  acquisition: { source: 'starter', at: '2026-01-01T00:00:00.000Z', catalogVersion: '1.oras.test' },
  shiny: false,
  gender: 'male',
  nickname: null,
}

describe('validateInstance', () => {
  it('accepts a sound record', () => {
    expect(validateInstance(sound, catalog)).toEqual([])
    expect(isValidInstance(sound, catalog)).toBe(true)
  })

  it('reports every problem at once, not just the first', () => {
    const broken: PokemonInstance = {
      ...sound,
      speciesId: 2,
      natureId: 99,
      ivs: { ...PERFECT_IVS, spe: 40 },
      experience: -1,
    }
    const issues = validateInstance(broken, catalog)
    expect(issues.length).toBeGreaterThanOrEqual(4)
    expect(issues.join(' ')).toContain('experience')
  })

  it('refuses an ability the form cannot have', () => {
    expect(validateInstance({ ...sound, abilityId: 101 }, catalog)).toEqual([])
    expect(validateInstance({ ...sound, abilityId: 999 }, catalog))
      .toContain('ability 999 is not in the catalog')
  })

  it('refuses a form that belongs to another species', () => {
    expect(validateInstance({ ...sound, speciesId: 1, formId: 11 }, catalog))
      .toContain('form 11 is not in the catalog')
  })

  it('checks PP against the move plus its PP Ups', () => {
    expect(maxPPOf(35, 0)).toBe(35)
    expect(maxPPOf(35, MAX_PP_UPS)).toBe(56)
    expect(maxPPOf(10, 3)).toBe(16)
    const over = { ...sound, moves: [{ moveId: 200, ppUps: 0, currentPP: 36 }] }
    expect(validateInstance(over, catalog)).toContain('PP of move 200 must be between 0 and 35')
    const upped = { ...sound, moves: [{ moveId: 200, ppUps: 3, currentPP: 56 }] }
    expect(validateInstance(upped, catalog)).toEqual([])
  })

  it('refuses the same move in two slots', () => {
    const twice = { ...sound, moves: [
      { moveId: 200, ppUps: 0, currentPP: 35 },
      { moveId: 200, ppUps: 0, currentPP: 35 },
    ] }
    expect(validateInstance(twice, catalog)).toContain('move 200 is in two slots')
  })
})

describe('a dungeon capture (I-1)', () => {
  const pending: PokemonInstance = {
    ...sound,
    state: 'expeditionPending',
    ownership: { ownerId: null, originalTrainerId: null },
    acquisition: { source: 'dungeon_capture', at: '2026-02-01T10:00:00.000Z', catalogVersion: '1.oras.test', ref: 'exp-7' },
  }

  it('is valid while it belongs to nobody, and invalid once it claims an owner', () => {
    expect(validateInstance(pending, catalog)).toEqual([])
    const stamped = { ...pending, ownership: { ownerId: 'player-1', originalTrainerId: null } }
    expect(validateInstance(stamped, catalog)).toContain('a pending capture cannot have an owner yet (I-1)')
  })

  it('becomes the player’s on a successful extraction, keeping its origin', () => {
    const secured = secureCapture(pending, 'player-1', '2026-02-01T10:30:00.000Z')
    expect(secured.state).toBe('owned')
    expect(secured.ownership).toEqual({ ownerId: 'player-1', originalTrainerId: 'player-1' })
    expect(secured.acquisition.source).toBe('dungeon_capture')
    expect(secured.acquisition.ref).toBe('exp-7')
    expect(validateInstance(secured, catalog)).toEqual([])
  })

  it('is lost on a wipe, and an owned Pokémon never is', () => {
    expect(isLostOnWipe(pending)).toBe(true)
    expect(isLostOnWipe(sound)).toBe(false)
    // Securing something already owned is a no-op, not a second acquisition.
    expect(secureCapture(sound, 'someone-else', '2026-03-01T00:00:00.000Z')).toBe(sound)
  })
})

describe('runtime state', () => {
  const battle = enterBattle({ instance: sound, maxHp: 120, maxPP: { 200: 35 } })

  it('starts from the instance, full health when it carries no damage', () => {
    expect(battle.currentHp).toBe(120)
    expect(battle.pp).toEqual({ 200: 35 })
    expect(battle.status).toBe('none')
    expect(battle.stages).toEqual({})
    expect(battle.activeFormId).toBe(sound.formId)
  })

  it('carries damage and spent PP into the next fight', () => {
    const hurt = { ...sound, currentHp: 40, moves: [{ moveId: 200, ppUps: 0, currentPP: 12 }] }
    const state = enterBattle({ instance: hurt, maxHp: 120, maxPP: { 200: 35 } })
    expect(state.currentHp).toBe(40)
    expect(state.pp[200]).toBe(12)
  })

  it('brings only HP and PP back out, never a Mega or a stat stage', () => {
    const after = leaveBattle(sound, {
      ...battle,
      activeFormId: 999,
      currentHp: 31,
      pp: { 200: 4 },
      status: 'burn',
      stages: { atk: -2 },
    })
    expect(after.currentHp).toBe(31)
    expect(after.moves[0].currentPP).toBe(4)
    expect(after.formId).toBe(sound.formId)
    expect(after).not.toHaveProperty('status')
    expect(after).not.toHaveProperty('stages')
  })

  it('clamps what comes back and knows a faint', () => {
    expect(leaveBattle(sound, { ...battle, currentHp: -20 }).currentHp).toBe(0)
    expect(leaveBattle(sound, { ...battle, currentHp: 999 }).currentHp).toBe(120)
    expect(isFainted({ ...battle, currentHp: 0 })).toBe(true)
    expect(isFainted(battle)).toBe(false)
  })
})

describe('the active party (A-1)', () => {
  const members: Record<string, PartyMemberView> = {
    a: { ownerId: 'p1', state: 'owned' },
    b: { ownerId: 'p1', state: 'owned' },
    c: { ownerId: 'p2', state: 'owned' },
    d: { ownerId: null, state: 'expeditionPending' },
  }
  const check = (party: ActiveParty): string[] =>
    validateParty({ party, member: id => members[id] ?? null })

  it('accepts up to six of one’s own Pokémon', () => {
    expect(check({ ownerId: 'p1', memberIds: ['a', 'b'] })).toEqual([])
    expect(MAX_PARTY_SIZE).toBe(6)
  })

  it('refuses a seventh, a duplicate, a stranger’s and a pending capture', () => {
    expect(check({ ownerId: 'p1', memberIds: ['a', 'a', 'a', 'a', 'a', 'a', 'a'] })[0])
      .toContain('at most 6')
    expect(check({ ownerId: 'p1', memberIds: ['a', 'a'] })).toContain('a is in the party twice')
    expect(check({ ownerId: 'p1', memberIds: ['c'] })).toContain('c belongs to someone else')
    expect(check({ ownerId: 'p1', memberIds: ['d'] })).toContain('d is still a pending capture')
    expect(check({ ownerId: 'p1', memberIds: ['ghost'] })).toContain('ghost is not a Pokémon of this collection')
  })

  it('only lets a party member work a profession', () => {
    const party: ActiveParty = { ownerId: 'p1', memberIds: ['a'] }
    expect(canWork(party, 'a')).toBe(true)
    expect(canWork(party, 'b')).toBe(false)
  })

  it('adds and removes without ever breaking the limit', () => {
    let party: ActiveParty = { ownerId: 'p1', memberIds: [] }
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) party = addToParty(party, id)
    expect(party.memberIds).toHaveLength(6)
    expect(addToParty(party, 'a')).toBe(party)
    party = removeFromParty(party, 'a')
    expect(party.memberIds).not.toContain('a')
    expect(removeFromParty(party, 'a')).toBe(party)
  })
})
