import { describe, it, expect } from 'vitest'
import { xpToLevel, xpNeededForLevel, xpInCurrentLevel, xpProgress, MAX_LEVEL } from './xpLevel'

describe('xpNeededForLevel', () => {
  it('level 1 needs 1 XP (1³)', () => expect(xpNeededForLevel(1)).toBe(1))
  it('level 2 needs 8 XP (2³)', () => expect(xpNeededForLevel(2)).toBe(8))
  it('level 10 needs 1000 XP (10³)', () => expect(xpNeededForLevel(10)).toBe(1000))
  it('level 50 needs 125000 XP (50³)', () => expect(xpNeededForLevel(50)).toBe(125_000))
  it('caps at level 99 (max transition)', () => expect(xpNeededForLevel(99)).toBe(970_299))
  it('handles level 0 like level 1', () => expect(xpNeededForLevel(0)).toBe(1))
})

describe('xpToLevel', () => {
  it('0 XP → level 1', () => expect(xpToLevel(0)).toBe(1))
  it('0 XP is level 1 (needs 1 to advance)', () => expect(xpToLevel(0)).toBe(1))
  it('exactly 1 XP → level 2 (crossed level 1 threshold)', () => expect(xpToLevel(1)).toBe(2))
  it('8 XP → level 3 (1 + 8 = 9, needs 9 total for level 3)', () => expect(xpToLevel(9)).toBe(3))
  it('negative XP → level 1', () => expect(xpToLevel(-100)).toBe(1))
  it('returns MAX_LEVEL when XP is enormous', () => expect(xpToLevel(Number.MAX_SAFE_INTEGER)).toBe(MAX_LEVEL))

  it('level advances match xpNeededForLevel accumulation', () => {
    let xp = 0
    for (let lvl = 1; lvl < 10; lvl++) {
      expect(xpToLevel(xp)).toBe(lvl)
      xp += xpNeededForLevel(lvl)
    }
    expect(xpToLevel(xp)).toBe(10)
  })
})

describe('xpInCurrentLevel', () => {
  it('0 XP → 0 progress within level 1', () => expect(xpInCurrentLevel(0)).toBe(0))
  it('half of level 1 XP remaining', () => {
    // Level 1 needs 1 XP. At xp=0 we need 1 more.
    expect(xpInCurrentLevel(0)).toBe(0)
  })
  it('at max level returns 0 (no further progress tracked)', () => {
    expect(xpInCurrentLevel(Number.MAX_SAFE_INTEGER)).toBe(0)
  })
  it('partial level 2 progress', () => {
    // To reach level 2 we need 1 XP; level 2→3 needs 8 XP.
    // At xp=4 we are in level 2 with 3 XP accumulated (4 - 1 = 3).
    expect(xpInCurrentLevel(4)).toBe(3)
  })
})

describe('xpProgress', () => {
  it('0 XP → 0% progress', () => expect(xpProgress(0)).toBe(0))
  it('exactly at level boundary → 0% of next level', () => {
    // 1 XP crosses level 1→2; now at start of level 2.
    expect(xpProgress(1)).toBe(0)
  })
  it('at max level → 100%', () => expect(xpProgress(Number.MAX_SAFE_INTEGER)).toBe(1))
  it('mid-level gives fractional progress', () => {
    // Level 2→3 needs 8 XP. At xp=1+4=5 we are 4/8 = 50% through level 2.
    expect(xpProgress(5)).toBeCloseTo(0.5)
  })
})
