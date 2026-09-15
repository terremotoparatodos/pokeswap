// Shared profession progression: XP curve and level efficiency.
//
// One curve for every profession. Level 1–60 (not 99): Pokémon already use
// 1–100, and a shorter scale keeps each level meaningful.

import { MAX_PROFESSION_LEVEL } from './catalog/professions'

export const XP_CURVE = { base: 40, exponent: 2.35 } as const

/** Total XP needed to reach `level` (level 1 = 0 XP). */
export function totalXpForLevel(level: number): number {
  const clamped = Math.max(1, Math.min(MAX_PROFESSION_LEVEL, Math.floor(level)))
  return clamped === 1 ? 0 : Math.round(XP_CURVE.base * Math.pow(clamped - 1, XP_CURVE.exponent))
}

export function levelForXp(xp: number): number {
  let level = 1
  while (level < MAX_PROFESSION_LEVEL && xp >= totalXpForLevel(level + 1)) level++
  return level
}

/** Fraction [0, 1] toward the next level; 1 at max level. */
export function levelProgress(xp: number): number {
  const level = levelForXp(xp)
  if (level >= MAX_PROFESSION_LEVEL) return 1
  const floor = totalXpForLevel(level)
  return (xp - floor) / (totalXpForLevel(level + 1) - floor)
}

/** Levels above a node/recipe requirement after which its XP is halved. */
export const OVERLEVEL_XP_THRESHOLD = 25

export interface LevelEfficiency {
  /** Action-time reduction. */
  readonly speed: number
  /** Energy-cost reduction. */
  readonly energy: number
  /** Added extra-unit chance. */
  readonly yield: number
  /** Multiplier for rare drop chances. */
  readonly rareMultiplier: number
}

/**
 * Veteran advantage on content they out-level. Linear with hard caps so a
 * new player on the same node still produces ~75 % of a veteran's output per
 * energy point.
 */
export function levelEfficiency(professionLevel: number, requiredLevel: number): LevelEfficiency {
  const delta = Math.max(0, professionLevel - requiredLevel)
  return {
    speed: Math.min(0.18, delta * 0.006),
    energy: Math.min(0.15, delta * 0.005),
    yield: Math.min(0.12, delta * 0.004),
    rareMultiplier: Math.min(1.5, 1 + delta * 0.02),
  }
}

export function actionXp(baseXp: number, professionLevel: number, requiredLevel: number, rested: boolean, restedXpBonus: number): number {
  const overlevel = professionLevel - requiredLevel >= OVERLEVEL_XP_THRESHOLD ? 0.5 : 1
  return Math.round(baseXp * overlevel * (rested ? 1 + restedXpBonus : 1))
}
