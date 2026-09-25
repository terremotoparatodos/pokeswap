import { describe, expect, it } from 'vitest'
import { MAX_SKILL_LEVEL, XP_CURVE } from './balance'
import { buildThresholds, cappedGain, levelForXp, levelProgress, totalXpForLevel, xpToNextLevel } from './xpCurve'

// The whole 1–50 table, pinned. A change here is a balance change and should
// show up in review as one — update SKILLS_1_REPORT.md §7 with it.
const EXPECTED_THRESHOLDS = [
  0, 0, 34, 95, 182, 296, 438, 607, 805, 1031, 1286, 1571, 1887, 2234, 2614, 3028, 3477, 3963, 4488, 5054, 5663,
  6319, 7025, 7784, 8602, 9484, 10436, 11465, 12580, 13790, 15107, 16544, 18116, 19840, 21737, 23831, 26149, 28722,
  31588, 34790, 38377, 42407, 46947, 52074, 57878, 64464, 71953, 80485, 90223, 101356, 114103,
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
    // Late levels are an investment: 49→50 costs over 40× what 9→10 costs.
    expect(xpToNextLevel(49) / xpToNextLevel(9)).toBeGreaterThan(40)
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
