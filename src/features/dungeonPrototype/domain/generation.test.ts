// D1 — the dungeon is a function of its seed, and its floors get harder.

import { describe, expect, it } from 'vitest'
import { poolFor } from '../data/speciesFixtures'
import { generateDungeon, generateFloor } from './floorPlan'
import { DEFAULT_KEY_CONFIG, emptyKeyState, keyChance, rollFloorKey } from './floorKey'
import {
  DUNGEON_TIERS, dungeonProfile, FLOOR_LIMITS, floorCount, floorDifficulty, floorRange, TIER_CONFIG,
} from './tiers'

describe('dungeon length', () => {
  it.each(DUNGEON_TIERS)('keeps tier %s inside the 5–30 floor product limit', tier => {
    const { min, max } = floorRange(tier)
    expect(min).toBeGreaterThanOrEqual(FLOOR_LIMITS.min)
    expect(max).toBeLessThanOrEqual(FLOOR_LIMITS.max)
    for (let seed = 1; seed <= 40; seed++) {
      const floors = floorCount(seed, tier)
      expect(floors).toBeGreaterThanOrEqual(min)
      expect(floors).toBeLessThanOrEqual(max)
    }
  })

  it('clamps a configuration that would exceed the product limit', () => {
    const range = floorRange('S', { ...TIER_CONFIG.S, floors: { min: 2, max: 99 } })
    expect(range).toEqual({ min: FLOOR_LIMITS.min, max: FLOOR_LIMITS.max })
  })

  it('shows name, tier and floor count before entering', () => {
    const profile = dungeonProfile(1234, 'B', 'cave')
    expect(profile.name).toContain('Cueva')
    expect(profile.tier).toBe('B')
    expect(profile.floors).toBeGreaterThanOrEqual(TIER_CONFIG.B.floors.min)
  })
})

describe('deterministic generation', () => {
  it('rebuilds an identical dungeon from the same seed', () => {
    const profile = dungeonProfile(9182, 'B', 'mine')
    const first = generateDungeon(profile, poolFor(profile.theme))
    const second = generateDungeon(dungeonProfile(9182, 'B', 'mine'), poolFor('mine'))
    expect(second).toEqual(first)
  })

  it('gives different seeds different floors', () => {
    const a = generateFloor(dungeonProfile(1, 'C', 'cave'), 3, poolFor('cave'))
    const b = generateFloor(dungeonProfile(2, 'C', 'cave'), 3, poolFor('cave'))
    expect(JSON.stringify(a.rooms)).not.toEqual(JSON.stringify(b.rooms))
  })

  it('spawns only species from the dungeon pool', () => {
    const profile = dungeonProfile(77, 'B', 'glacier')
    const pool = poolFor('glacier')
    for (const floor of generateDungeon(profile, pool)) {
      for (const encounter of floor.encounters) expect(pool).toContain(encounter.speciesId)
    }
  })

  it('always connects the floor and locks the exit until the last one', () => {
    const profile = dungeonProfile(555, 'A', 'tower')
    const floors = generateDungeon(profile, poolFor('tower'))
    for (const floor of floors) {
      const reached = new Set<number>([floor.entranceRoomId])
      // The links are emitted parent-first, so one pass is enough to walk them.
      for (const link of floor.links) if (reached.has(link.from)) reached.add(link.to)
      expect(reached.has(floor.exitRoomId)).toBe(true)
      expect(floor.rooms.length).toBeGreaterThanOrEqual(4)
      expect(floor.exitLocked).toBe(floor.floor < profile.floors)
    }
    const last = floors[floors.length - 1]
    expect(last.difficulty.isBossFloor).toBe(true)
    expect(last.encounters.filter(encounter => encounter.isAlpha)).toHaveLength(1)
  })
})

describe('difficulty gradient', () => {
  it('makes a deep floor clearly harder than a shallow one', () => {
    const profile = dungeonProfile(4242, 'B', 'ruin')
    const early = floorDifficulty(profile.seed, 'B', 2, profile.floors)
    const late = floorDifficulty(profile.seed, 'B', 16, profile.floors)
    expect(late.budget).toBeGreaterThan(early.budget * 1.3)
    expect(late.level).toBeGreaterThan(early.level)
  })

  it('rises overall without demanding that every floor beat the previous one', () => {
    const profile = dungeonProfile(31, 'S', 'volcano')
    const budgets = Array.from({ length: profile.floors }, (_, i) =>
      floorDifficulty(profile.seed, 'S', i + 1, profile.floors).budget)
    expect(budgets[budgets.length - 1]).toBeGreaterThan(budgets[0] * 2)
    // A wobble is allowed: the curve is a trend, not a staircase.
    const firstHalf = budgets.slice(0, Math.floor(budgets.length / 2))
    const secondHalf = budgets.slice(Math.floor(budgets.length / 2))
    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length
    expect(mean(secondHalf)).toBeGreaterThan(mean(firstHalf))
  })

  it('spends the budget on encounters instead of scattering them at random', () => {
    const profile = dungeonProfile(808, 'A', 'cave')
    const shallow = generateFloor(profile, 2, poolFor('cave'))
    const deep = generateFloor(profile, profile.floors - 1, poolFor('cave'))
    const weight = (floor: typeof shallow) => floor.encounters.reduce((sum, e) => sum + e.weight, 0)
    expect(weight(deep)).toBeGreaterThan(weight(shallow))
    expect(weight(deep)).toBeLessThanOrEqual(deep.difficulty.budget * 1.1)
  })
})

describe('floor key', () => {
  it('can drop on the first defeat', () => {
    const roll = rollFloorKey(emptyKeyState(), 0.01)
    expect(roll.dropped).toBe(true)
    expect(roll.state.hasKey).toBe(true)
  })

  it('raises the chance after every defeat without a key', () => {
    let state = emptyKeyState()
    const chances: number[] = []
    for (let i = 0; i < 3; i++) {
      chances.push(keyChance(state))
      state = rollFloorKey(state, 0.99).state
    }
    expect(chances[1]).toBeGreaterThan(chances[0])
    expect(chances[2]).toBeGreaterThan(chances[1])
  })

  it('guarantees the key so bad luck can never block the floor', () => {
    let state = emptyKeyState()
    let dropped = false
    for (let i = 0; i < DEFAULT_KEY_CONFIG.guaranteedAfter; i++) {
      // 0.999: the worst possible roll every single time.
      const roll = rollFloorKey(state, 0.999)
      state = roll.state
      dropped = dropped || roll.dropped
      if (roll.dropped) expect(roll.guaranteed).toBe(true)
    }
    expect(dropped).toBe(true)
    expect(state.hasKey).toBe(true)
  })

  it('does not drop a second key while one is held', () => {
    const held = rollFloorKey(emptyKeyState(), 0).state
    expect(rollFloorKey(held, 0).dropped).toBe(false)
  })
})
