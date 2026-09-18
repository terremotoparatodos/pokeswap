// The three-layer boundary of R32.2.1, tested from both sides: what survives a
// battle, and what must not.

import { describe, expect, it } from 'vitest'

import { HEALTHY, isFainted, pruneCondition, remainingPP, validateCondition } from './condition'
import type { PokemonConditionState } from './condition'
import type { PokemonInstance } from './instance'
import { enterBattle, leaveBattle, megaEvolve } from './runtime'
import { PERFECT_IVS, ZERO_STATS } from './stats'

const CHARIZARD_MEGA_X = 10034

const instance: PokemonInstance = {
  schemaVersion: 2,
  instanceId: 'inst-1',
  speciesId: 6,
  formId: 6,
  experience: 400000,
  natureId: 5,
  abilityId: 66,
  ivs: PERFECT_IVS,
  evs: ZERO_STATS,
  moves: [{ moveId: 200, ppUps: 0 }, { moveId: 201, ppUps: 1 }],
  condition: HEALTHY,
  state: 'owned',
  ownership: { ownerId: 'p1', originalTrainerId: 'p1' },
  acquisition: { source: 'starter', at: '2026-01-01T00:00:00.000Z', catalogVersion: '1.oras.test' },
  shiny: false,
  gender: 'male',
  nickname: null,
}

const worn: PokemonConditionState = { currentHp: 37, pp: { 200: 4 }, majorStatus: 'burn' }

describe('what a battle leaves behind', () => {
  it('keeps HP', () => {
    expect(leaveBattle(instance, worn).condition.currentHp).toBe(37)
  })

  it('keeps spent PP', () => {
    expect(leaveBattle(instance, worn).condition.pp).toEqual({ 200: 4 })
  })

  it('keeps the major status: winning heals nothing', () => {
    expect(leaveBattle(instance, worn).condition.majorStatus).toBe('burn')
    for (const status of ['poison', 'badlyPoisoned', 'paralysis', 'freeze', 'sleep'] as const) {
      expect(leaveBattle(instance, { ...worn, majorStatus: status }).condition.majorStatus).toBe(status)
    }
  })

  it('keeps a faint: a fainted Pokémon walks out fainted', () => {
    const after = leaveBattle(instance, { ...worn, currentHp: 0 })
    expect(isFainted(after.condition)).toBe(true)
  })

  it('carries the wear into the next fight rather than resetting it', () => {
    const after = leaveBattle(instance, worn)
    const next = enterBattle({ instance: after, maxHp: 120 })
    // The runtime holds no health and no PP: the battle reads them from the
    // condition, which is exactly what it left there.
    expect(next).not.toHaveProperty('currentHp')
    expect(next).not.toHaveProperty('pp')
    expect(after.condition).toEqual(worn)
  })
})

describe('what a battle takes with it', () => {
  const fought = {
    ...enterBattle({ instance, maxHp: 120 }),
    stages: { atk: -2, spe: 1 },
    confusedFor: 3,
    protected: true,
    actionBar: 0.8,
    volatiles: ['leechSeed'],
    activeFormId: CHARIZARD_MEGA_X,
  }

  const after = leaveBattle(instance, worn)

  it('drops confusion', () => {
    expect(fought.confusedFor).toBe(3)
    expect(after).not.toHaveProperty('confusedFor')
    expect(JSON.stringify(after)).not.toContain('confused')
  })

  it('drops stat stages', () => {
    expect(after).not.toHaveProperty('stages')
    expect(JSON.stringify(after)).not.toContain('stages')
  })

  it('drops Protect', () => {
    expect(after).not.toHaveProperty('protected')
    expect(JSON.stringify(after)).not.toContain('protected')
  })

  it('drops the action bar and any other volatile', () => {
    expect(after).not.toHaveProperty('actionBar')
    expect(after).not.toHaveProperty('volatiles')
    expect(JSON.stringify(after)).not.toContain('leechSeed')
  })

  it('drops a Mega form: the instance is still the base form', () => {
    const mega = megaEvolve(enterBattle({ instance, maxHp: 120 }), CHARIZARD_MEGA_X)
    expect(mega.activeFormId).toBe(CHARIZARD_MEGA_X)
    expect(instance.formId).toBe(6)
    expect(after.formId).toBe(6)
    expect(JSON.stringify(after)).not.toContain(String(CHARIZARD_MEGA_X))
  })

  it('starts a fight from the instance’s own form, never a Mega', () => {
    expect(enterBattle({ instance, maxHp: 120 }).activeFormId).toBe(instance.formId)
  })
})

describe('the condition itself', () => {
  it('derives fainting from HP, with no second flag to disagree with it', () => {
    expect(isFainted(HEALTHY)).toBe(false)
    expect(isFainted({ ...HEALTHY, currentHp: 1 })).toBe(false)
    expect(isFainted({ ...HEALTHY, currentHp: 0 })).toBe(true)
    expect(Object.keys(HEALTHY)).toEqual(['currentHp', 'pp', 'majorStatus'])
  })

  it('treats an absent PP entry as a full one', () => {
    expect(remainingPP(HEALTHY, 200, 35)).toBe(35)
    expect(remainingPP(worn, 200, 35)).toBe(4)
  })

  it('clamps negative HP on the way out of a battle', () => {
    expect(leaveBattle(instance, { ...worn, currentHp: -40 }).condition.currentHp).toBe(0)
  })

  it('forgets PP for a move the Pokémon no longer knows', () => {
    const stale: PokemonConditionState = { currentHp: 10, pp: { 200: 2, 999: 1 }, majorStatus: 'none' }
    expect(leaveBattle(instance, stale).condition.pp).toEqual({ 200: 2 })
    expect(pruneCondition(stale, moveId => moveId === 999).pp).toEqual({ 999: 1 })
  })

  it('validates HP, status and PP', () => {
    const max = (moveId: number): number | null => (moveId === 200 ? 35 : null)
    expect(validateCondition(worn, max)).toEqual([])
    expect(validateCondition({ ...worn, currentHp: -1 }, max)).toHaveLength(1)
    expect(validateCondition({ ...worn, currentHp: 1.5 }, max)).toHaveLength(1)
    expect(validateCondition({ ...worn, majorStatus: 'confused' as never }, max)).toHaveLength(1)
    expect(validateCondition({ ...worn, pp: { 200: 99 } }, max)).toHaveLength(1)
    expect(validateCondition({ ...worn, pp: { 777: 1 } }, max)).toHaveLength(1)
  })
})

describe('serialization', () => {
  it('survives a round trip through JSON unchanged', () => {
    const after = leaveBattle(instance, worn)
    expect(JSON.parse(JSON.stringify(after))).toEqual(after)
  })

  it('holds no class, no Date and no function anywhere', () => {
    const after = leaveBattle(instance, worn)
    const walk = (value: unknown): void => {
      expect(typeof value).not.toBe('function')
      expect(value).not.toBeInstanceOf(Date)
      if (value && typeof value === 'object') {
        expect([Object.prototype, Array.prototype]).toContain(Object.getPrototypeOf(value))
        Object.values(value as Record<string, unknown>).forEach(walk)
      }
    }
    walk(after)
  })
})
