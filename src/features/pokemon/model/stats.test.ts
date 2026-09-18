import { describe, expect, it } from 'vitest'

import { experienceForLevel, experienceToNextLevel, levelForExperience } from './experience'
import {
  MAX_EV_TOTAL, PERFECT_IVS, ZERO_STATS, deriveStats, evHeadroom, maxHp, natureMultiplier,
  otherStat, statsFromTuple, totalEvs, validateEvs, validateIvs,
} from './stats'
import type { StatValues } from './stats'

/** Garchomp, the line every Gen VI stat calculator is checked against. */
const GARCHOMP = statsFromTuple([108, 130, 95, 80, 85, 102])
const ADAMANT = { increased: 'attack', decreased: 'special-attack' }

describe('Gen VI stat formulas', () => {
  it('matches the reference Garchomp at level 78', () => {
    const ivs: StatValues = { hp: 24, atk: 12, def: 30, spa: 16, spd: 23, spe: 5 }
    const evs: StatValues = { hp: 74, atk: 190, def: 91, spa: 48, spd: 84, spe: 23 }
    const input = { base: GARCHOMP, level: 78, ivs, evs, nature: ADAMANT }
    expect(maxHp(input)).toBe(289)
    expect(otherStat(input, 'atk')).toBe(278)
    expect(otherStat(input, 'def')).toBe(193)
    expect(otherStat(input, 'spa')).toBe(135)
    expect(otherStat(input, 'spd')).toBe(171)
    expect(otherStat(input, 'spe')).toBe(171)
  })

  it('gives Shedinja exactly one hit point', () => {
    const input = { base: statsFromTuple([1, 90, 45, 30, 30, 40]), level: 100, ivs: PERFECT_IVS, evs: ZERO_STATS, nature: null }
    expect(maxHp(input, true)).toBe(1)
    expect(deriveStats(input, true).hp).toBe(1)
  })

  it('leaves HP and neutral natures alone', () => {
    expect(natureMultiplier(ADAMANT, 'hp')).toBe(1)
    expect(natureMultiplier({ increased: 'attack', decreased: 'attack' }, 'atk')).toBe(1)
    expect(natureMultiplier(ADAMANT, 'atk')).toBeCloseTo(1.1)
    expect(natureMultiplier(ADAMANT, 'spa')).toBeCloseTo(0.9)
    expect(natureMultiplier(null, 'spe')).toBe(1)
  })
})

describe('IV and EV limits', () => {
  it('accepts a legal spread and rejects an illegal one', () => {
    expect(validateIvs(PERFECT_IVS)).toEqual([])
    expect(validateIvs({ ...PERFECT_IVS, spe: 32 })).toHaveLength(1)
    expect(validateIvs({ ...PERFECT_IVS, hp: 3.5 })).toHaveLength(1)
  })

  it('caps EVs per stat and in total', () => {
    expect(validateEvs({ hp: 252, atk: 252, def: 6, spa: 0, spd: 0, spe: 0 })).toEqual([])
    expect(validateEvs({ hp: 253, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 })).toHaveLength(1)
    const over = { hp: 252, atk: 252, def: 252, spa: 0, spd: 0, spe: 0 }
    expect(totalEvs(over)).toBe(756)
    expect(validateEvs(over).some(issue => issue.includes(String(MAX_EV_TOTAL)))).toBe(true)
  })

  it('reports how many EVs a stat can still take', () => {
    expect(evHeadroom(ZERO_STATS, 'atk')).toBe(252)
    expect(evHeadroom({ hp: 252, atk: 200, def: 0, spa: 0, spd: 0, spe: 0 }, 'atk')).toBe(52)
    // 252 + 252 already spends 504 of the 510, so only six are left anywhere.
    expect(evHeadroom({ hp: 252, atk: 252, def: 0, spa: 0, spd: 0, spe: 0 }, 'spe')).toBe(6)
  })
})

describe('experience is the source of truth for level', () => {
  it('round-trips a level through its experience', () => {
    for (const level of [1, 2, 5, 25, 50, 73, 100]) {
      expect(levelForExperience(experienceForLevel(level))).toBe(level)
    }
  })

  it('starts level 1 at zero experience and stops at the cap', () => {
    expect(experienceForLevel(1)).toBe(0)
    expect(levelForExperience(0)).toBe(1)
    expect(experienceToNextLevel(experienceForLevel(100))).toBe(0)
  })

  it('counts what is missing for the next level', () => {
    const half = experienceForLevel(10) + 100
    expect(levelForExperience(half)).toBe(10)
    expect(experienceToNextLevel(half)).toBe(experienceForLevel(11) - half)
  })
})
