// Dungeon tiers, length and the difficulty budget per floor (D0).
//
// APPROVED: five tiers (D…S) and a total length between 5 and 30 floors; a
// dungeon's name, tier and floor count are known before entering.
//
// PROTOTYPE ASSUMPTION: every number below. The floor ranges are the ones the
// brief suggested as a starting point, and the budget curve is this station's
// proposal. All of it is configuration, not balance.

import { streamFor, type Rng } from './rng'

export type DungeonTier = 'D' | 'C' | 'B' | 'A' | 'S'

export const DUNGEON_TIERS: readonly DungeonTier[] = ['D', 'C', 'B', 'A', 'S']

/** Hard product limits: no tier may fall outside this. */
export const FLOOR_LIMITS = { min: 5, max: 30 } as const

export interface TierConfig {
  readonly floors: { readonly min: number; readonly max: number }
  /** Difficulty of floor 1 of this tier, in budget points. */
  readonly baseBudget: number
  /** How much harder the last floor is than the first, as a multiplier. */
  readonly depthGain: number
  /** Level of a normal encounter on floor 1. */
  readonly baseLevel: number
  /** Levels added between the first and the last floor. */
  readonly levelSpan: number
}

export const TIER_CONFIG: Readonly<Record<DungeonTier, TierConfig>> = {
  D: { floors: { min: 5, max: 7 }, baseBudget: 10, depthGain: 1.6, baseLevel: 5, levelSpan: 6 },
  C: { floors: { min: 8, max: 12 }, baseBudget: 18, depthGain: 1.9, baseLevel: 14, levelSpan: 10 },
  B: { floors: { min: 13, max: 18 }, baseBudget: 30, depthGain: 2.2, baseLevel: 26, levelSpan: 14 },
  A: { floors: { min: 19, max: 24 }, baseBudget: 46, depthGain: 2.5, baseLevel: 42, levelSpan: 18 },
  S: { floors: { min: 25, max: 30 }, baseBudget: 66, depthGain: 2.9, baseLevel: 60, levelSpan: 22 },
}

/** Clamps a configured range to the product limits, so a bad config cannot ship a 40-floor dungeon. */
export function floorRange(tier: DungeonTier, config: TierConfig = TIER_CONFIG[tier]) {
  const min = Math.max(FLOOR_LIMITS.min, Math.min(FLOOR_LIMITS.max, config.floors.min))
  const max = Math.max(min, Math.min(FLOOR_LIMITS.max, config.floors.max))
  return { min, max }
}

/** How long this particular dungeon is. Deterministic: same seed and tier, same length. */
export function floorCount(seed: number, tier: DungeonTier, config: TierConfig = TIER_CONFIG[tier]): number {
  const { min, max } = floorRange(tier, config)
  return streamFor(seed, 'length', tier).int(min, max)
}

/** 0 on the first floor, 1 on the last. */
export function depthRatio(floor: number, floors: number): number {
  if (floors <= 1) return 0
  return Math.max(0, Math.min(1, (floor - 1) / (floors - 1)))
}

/** Slow start, steep middle, slow end: the classic smoothstep. */
const smoothstep = (t: number): number => t * t * (3 - 2 * t)

export interface FloorDifficulty {
  readonly floor: number
  readonly depth: number
  /** Points the generator may spend on this floor. */
  readonly budget: number
  readonly level: number
  readonly isBossFloor: boolean
}

/**
 * The difficulty of one floor.
 *
 * Gradual, not monotonic: the curve rises with depth, and a small
 * seeded wobble (±8 %) lets one floor be a breather without breaking the
 * trend. The last floor is the Alpha and gets the full budget plus a bump.
 */
export function floorDifficulty(
  seed: number, tier: DungeonTier, floor: number, floors: number,
  config: TierConfig = TIER_CONFIG[tier],
): FloorDifficulty {
  const depth = depthRatio(floor, floors)
  const isBossFloor = floor >= floors
  const curve = 1 + (config.depthGain - 1) * smoothstep(depth)
  const wobble = isBossFloor ? 1 : 0.92 + streamFor(seed, 'wobble', tier, floor).next() * 0.16
  const bossBump = isBossFloor ? 1.35 : 1
  return {
    floor,
    depth,
    budget: Math.round(config.baseBudget * curve * wobble * bossBump * 10) / 10,
    level: Math.round(config.baseLevel + config.levelSpan * depth) + (isBossFloor ? 2 : 0),
    isBossFloor,
  }
}

export interface DungeonProfile {
  readonly seed: number
  readonly tier: DungeonTier
  readonly name: string
  readonly theme: DungeonTheme
  readonly floors: number
}

export type DungeonTheme = 'cave' | 'ruin' | 'tower' | 'forest' | 'mine' | 'volcano' | 'glacier'

/** PROTOTYPE ASSUMPTION: themes are placeholders for the real entrances in WildLands. */
export const DUNGEON_THEMES: readonly DungeonTheme[] = ['cave', 'ruin', 'tower', 'forest', 'mine', 'volcano', 'glacier']

const THEME_NAMES: Readonly<Record<DungeonTheme, string>> = {
  cave: 'Cueva', ruin: 'Ruina', tower: 'Torre', forest: 'Bosque',
  mine: 'Mina', volcano: 'Volcán', glacier: 'Caverna helada',
}

/** What a player can read at the entrance, before committing to the expedition. */
export function dungeonProfile(seed: number, tier: DungeonTier, theme?: DungeonTheme): DungeonProfile {
  const rng: Rng = streamFor(seed, 'profile', tier)
  const picked = theme ?? rng.pick(DUNGEON_THEMES)!
  return {
    seed, tier, theme: picked,
    name: `${THEME_NAMES[picked]} ${tier}-${String(seed % 1000).padStart(3, '0')}`,
    floors: floorCount(seed, tier),
  }
}
