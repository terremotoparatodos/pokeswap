// Skill XP curve: thresholds, level from XP, progress within a level.
//
// Pure and table-backed: the 50 thresholds are computed once from XP_CURVE,
// so `levelForXp` is a lookup and the numbers the tests pin are the numbers
// the game uses. XP is a non-negative integer; anything else is clamped.

import { MAX_SKILL_LEVEL, XP_CURVE } from './balance'

export interface XpCurveParams {
  readonly linear: number
  readonly base: number
  readonly growth: number
}

/** XP to go from `level` to `level + 1` under the given parameters. */
export function xpToNextLevel(level: number, params: XpCurveParams = XP_CURVE): number {
  return Math.round(params.linear * level + params.base * Math.pow(params.growth, level))
}

/** Cumulative thresholds: index L holds the total XP needed to reach level L (index 0 unused). */
export function buildThresholds(maxLevel: number = MAX_SKILL_LEVEL, params: XpCurveParams = XP_CURVE): readonly number[] {
  const table = [0, 0]
  for (let level = 1; level < maxLevel; level++) table.push(table[level] + xpToNextLevel(level, params))
  return table
}

const THRESHOLDS = buildThresholds()

const sanitize = (xp: number): number => (Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0)

/** Total XP to reach `level` (level 1 = 0). Clamped to 1..MAX_SKILL_LEVEL. */
export function totalXpForLevel(level: number): number {
  const clamped = Math.max(1, Math.min(MAX_SKILL_LEVEL, Math.floor(level)))
  return THRESHOLDS[clamped]
}

export function levelForXp(xp: number): number {
  const value = sanitize(xp)
  let level = 1
  while (level < MAX_SKILL_LEVEL && value >= THRESHOLDS[level + 1]) level++
  return level
}

export interface LevelProgress {
  readonly level: number
  /** XP earned inside the current level. */
  readonly intoLevel: number
  /** XP the current level spans; 0 at the cap. */
  readonly span: number
  /** 0..1; 1 at the cap. */
  readonly fraction: number
  readonly atCap: boolean
}

export function levelProgress(xp: number): LevelProgress {
  const value = sanitize(xp)
  const level = levelForXp(value)
  if (level >= MAX_SKILL_LEVEL) return { level, intoLevel: 0, span: 0, fraction: 1, atCap: true }
  const floor = THRESHOLDS[level]
  const span = THRESHOLDS[level + 1] - floor
  const intoLevel = value - floor
  return { level, intoLevel, span, fraction: intoLevel / span, atCap: false }
}

/**
 * XP actually added when `gain` lands on `current`. The provisional cap
 * stores XP up to the level-50 threshold and no further, so raising the cap
 * later never hands out levels for XP earned while capped.
 */
export function cappedGain(current: number, gain: number): number {
  const cap = THRESHOLDS[MAX_SKILL_LEVEL]
  const from = sanitize(current)
  return Math.max(0, Math.min(sanitize(gain), cap - from))
}
