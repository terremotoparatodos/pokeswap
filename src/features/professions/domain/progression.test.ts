import { describe, expect, it } from 'vitest'
import { MAX_PROFESSION_LEVEL } from './catalog/professions'
import { actionXp, levelEfficiency, levelForXp, levelProgress, totalXpForLevel } from './progression'

describe('profession XP curve', () => {
  it('starts at zero and grows strictly until the level cap', () => {
    expect(totalXpForLevel(1)).toBe(0)
    for (let level = 2; level <= MAX_PROFESSION_LEVEL; level++) {
      expect(totalXpForLevel(level)).toBeGreaterThan(totalXpForLevel(level - 1))
    }
  })

  it('round-trips every level boundary', () => {
    for (let level = 2; level <= MAX_PROFESSION_LEVEL; level++) {
      expect(levelForXp(totalXpForLevel(level))).toBe(level)
      expect(levelForXp(totalXpForLevel(level) - 1)).toBe(level - 1)
    }
  })

  it('places early, mid and late game on the intended scale', () => {
    expect(totalXpForLevel(10)).toBeGreaterThan(6_000)
    expect(totalXpForLevel(10)).toBeLessThan(8_000)
    expect(totalXpForLevel(30)).toBeGreaterThan(90_000)
    expect(totalXpForLevel(30)).toBeLessThan(130_000)
    expect(totalXpForLevel(60)).toBeGreaterThan(500_000)
    expect(totalXpForLevel(60)).toBeLessThan(650_000)
  })

  it('caps level and progress', () => {
    expect(levelForXp(Number.MAX_SAFE_INTEGER)).toBe(MAX_PROFESSION_LEVEL)
    expect(levelProgress(Number.MAX_SAFE_INTEGER)).toBe(1)
    expect(levelProgress(0)).toBe(0)
    expect(totalXpForLevel(999)).toBe(totalXpForLevel(MAX_PROFESSION_LEVEL))
  })
})

describe('level efficiency', () => {
  it('gives nothing at the requirement and caps veteran advantage', () => {
    expect(levelEfficiency(10, 10)).toEqual({ speed: 0, energy: 0, yield: 0, rareMultiplier: 1 })
    expect(levelEfficiency(5, 10)).toEqual({ speed: 0, energy: 0, yield: 0, rareMultiplier: 1 })
    expect(levelEfficiency(60, 1)).toEqual({ speed: 0.18, energy: 0.15, yield: 0.12, rareMultiplier: 1.5 })
  })

  it('keeps a new player within reach of a veteran on the same node', () => {
    const veteran = levelEfficiency(60, 1)
    const outputPerEnergy = (1 + veteran.yield) / (1 - veteran.energy)
    expect(outputPerEnergy).toBeLessThan(1.4)
  })

  it('halves XP on out-levelled content and applies the rested bonus', () => {
    expect(actionXp(10, 25, 1, false, 0.5)).toBe(10)
    expect(actionXp(10, 26, 1, false, 0.5)).toBe(5)
    expect(actionXp(10, 1, 1, true, 0.5)).toBe(15)
  })
})
