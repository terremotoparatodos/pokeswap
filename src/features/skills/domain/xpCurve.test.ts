import { describe, expect, it } from 'vitest'
import { MAX_SKILL_LEVEL, XP_CURVE } from './balance'
import { buildThresholds, cappedGain, levelForXp, levelProgress, totalXpForLevel, xpToNextLevel } from './xpCurve'

// The whole 1–50 table, pinned. A change here is a balance change and should
// show up in review as one — update SKILLS_1_REPORT.md §7 with it.
const EXPECTED_THRESHOLDS = [
  0, 0, 38, 99, 184, 294, 430, 593, 784, 1004, 1256, 1541, 1863, 2224, 2628, 3079, 3583, 4146, 4775, 5479, 6268,
  7154, 8153, 9282, 10562, 12017, 13678, 15579, 17763, 20279, 23187, 26557, 30473, 35036, 40364, 46599, 53910, 62497,
  72598, 84498, 98534, 115109, 134701, 157880, 185323, 217837, 256382, 302099, 356348, 420745, 497216,
]

describe('XP curve thresholds 1–50', () => {
  it('matches the pinned table exactly', () => {
    const table = Array.from({ length: MAX_SKILL_LEVEL + 1 }, (_, level) => (level === 0 ? 0 : totalXpForLevel(level)))
    expect(table).toEqual(EXPECTED_THRESHOLDS)
  })

  it('makes every level cost more than the one before (non-linear)', () => {
    for (let level = 2; level < MAX_SKILL_LEVEL; level++) {
      expect(xpToNextLevel(level), `L${level}`).toBeGreaterThan(xpToNextLevel(level - 1))
    }
    // Late levels are an investment: 49→50 costs over 200× what 9→10 costs.
    expect(xpToNextLevel(49) / xpToNextLevel(9)).toBeGreaterThan(200)
  })

  it('keeps the tutorial quick: level 2 is a handful of basic actions', () => {
    expect(totalXpForLevel(2)).toBeLessThanOrEqual(40)
    expect(totalXpForLevel(10)).toBeLessThan(1500)
  })

  it('is driven only by the three parameters', () => {
    const steeper = buildThresholds(MAX_SKILL_LEVEL, { ...XP_CURVE, growth: XP_CURVE.growth + 0.02 })
    expect(steeper[50]).toBeGreaterThan(totalXpForLevel(50))
    expect(buildThresholds(MAX_SKILL_LEVEL, XP_CURVE)[50]).toBe(totalXpForLevel(50))
  })
})

describe('level from XP', () => {
  it('levels up exactly at each threshold', () => {
    for (let level = 2; level <= MAX_SKILL_LEVEL; level++) {
      const threshold = totalXpForLevel(level)
      expect(levelForXp(threshold - 1), `just under L${level}`).toBe(level - 1)
      expect(levelForXp(threshold), `at L${level}`).toBe(level)
    }
  })

  it('stops at the provisional max of 50', () => {
    expect(levelForXp(totalXpForLevel(50))).toBe(50)
    expect(levelForXp(10_000_000)).toBe(50)
    expect(levelProgress(10_000_000)).toMatchObject({ level: 50, atCap: true, fraction: 1 })
  })

  it('treats hostile XP values as zero', () => {
    for (const bad of [-5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) expect(levelForXp(bad)).toBe(1)
  })

  it('reports progress inside a level', () => {
    const progress = levelProgress(totalXpForLevel(10) + 10)
    expect(progress).toMatchObject({ level: 10, intoLevel: 10, span: xpToNextLevel(10), atCap: false })
    expect(progress.fraction).toBeCloseTo(10 / xpToNextLevel(10))
  })

  it('never stores XP past the level-50 threshold', () => {
    const cap = totalXpForLevel(50)
    expect(cappedGain(cap - 5, 100)).toBe(5)
    expect(cappedGain(cap, 100)).toBe(0)
    expect(cappedGain(0, 30)).toBe(30)
    expect(cappedGain(0, -30)).toBe(0)
  })
})
