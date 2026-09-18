import { describe, expect, it } from 'vitest'

import { HEALTHY } from './condition'
import {
  MAX_PP_UPS, isLostOnWipe, isValidInstance, maxPPOf, maxPPOfInstance, secureCapture,
  validateInstance, withCondition,
} from './instance'
import type { InstanceCatalogView, PokemonInstance } from './instance'
import { MAX_PARTY_SIZE, addToParty, canWork, removeFromParty, validateParty } from './party'
import type { ActiveParty, PartyMemberView } from './party'
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
  schemaVersion: 2,
  instanceId: 'inst-1',
  speciesId: 1,
  formId: 10,
  experience: 8000,
  natureId: 5,
  abilityId: 100,
  ivs: PERFECT_IVS,
  evs: ZERO_STATS,
  moves: [{ moveId: 200, ppUps: 0 }],
  condition: HEALTHY,
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

  it('refuses a record from another schema version', () => {
    expect(validateInstance({ ...sound, schemaVersion: 1 }, catalog))
      .toContain('schema version 1, expected 2')
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

  it('refuses the same move in two slots', () => {
    const twice = { ...sound, moves: [{ moveId: 200, ppUps: 0 }, { moveId: 200, ppUps: 0 }] }
    expect(validateInstance(twice, catalog)).toContain('move 200 is in two slots')
  })

  it('computes a move’s PP ceiling from the catalog plus its PP Ups', () => {
    expect(maxPPOf(35, 0)).toBe(35)
    expect(maxPPOf(35, MAX_PP_UPS)).toBe(56)
    expect(maxPPOf(10, 3)).toBe(16)
    expect(maxPPOfInstance(sound, 200, catalog)).toBe(35)
    expect(maxPPOfInstance({ ...sound, moves: [{ moveId: 200, ppUps: 3 }] }, 200, catalog)).toBe(56)
    // A move this Pokémon does not know has no ceiling at all.
    expect(maxPPOfInstance(sound, 201, catalog)).toBeNull()
  })

  it('checks the condition against those ceilings', () => {
    const spent = withCondition(sound, { currentHp: 12, pp: { 200: 10 }, majorStatus: 'burn' })
    expect(validateInstance(spent, catalog)).toEqual([])
    const over = withCondition(sound, { currentHp: null, pp: { 200: 36 }, majorStatus: 'none' })
    expect(validateInstance(over, catalog)).toContain('PP of move 200 must be between 0 and 35')
    const stale = withCondition(sound, { currentHp: null, pp: { 201: 3 }, majorStatus: 'none' })
    expect(validateInstance(stale, catalog))
      .toContain('PP recorded for move 201, which this Pokémon does not know')
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

  it('keeps the wear it took inside the dungeon when it is secured', () => {
    const hurt = withCondition(pending, { currentHp: 3, pp: { 200: 1 }, majorStatus: 'poison' })
    const secured = secureCapture(hurt, 'player-1', '2026-02-01T10:30:00.000Z')
    expect(secured.condition).toEqual({ currentHp: 3, pp: { 200: 1 }, majorStatus: 'poison' })
  })

  it('is lost on a wipe, and an owned Pokémon never is', () => {
    expect(isLostOnWipe(pending)).toBe(true)
    expect(isLostOnWipe(sound)).toBe(false)
    // Securing something already owned is a no-op, not a second acquisition.
    expect(secureCapture(sound, 'someone-else', '2026-03-01T00:00:00.000Z')).toBe(sound)
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
