// Default aptitude: derived from types AND base stats, then patched per species
// by overrides.ts.
//
//   aptitude = clamp(1..5, BASE + typeTier + statTier)
//
//   typeTier  +2 natural, +1 good, 0 neutral, −1 poor — the best of the
//             species' types; a poor type only counts when no type helps.
//   statTier  +1 when the skill's stat pair averages ≥ STRONG, −1 when it
//             averages ≤ WEAK. The pair is what the work physically asks for.
//
// Why not type alone: Caterpie and Scizor are both Bug. Why not stats alone: a
// Blissey would out-mine a Graveler. Types say what the species *is*, stats
// say how much of it there is. Anything the two get wrong is an override.

import type { SkillId } from '../skills'
import type { BaseStats } from './speciesFacts'

/** Aptitude of a neutral-typed species with average stats. */
export const APTITUDE_BASE = 2

export type TypeTier = 2 | 1 | -1

/** Unlisted types are neutral (0). */
export const TYPE_TIERS: Readonly<Record<SkillId, Readonly<Record<string, TypeTier>>>> = {
  // Blades, claws and raw strength; grass and bug know trees from the inside.
  woodcutting: {
    fighting: 2, steel: 2,
    bug: 1, grass: 1, normal: 1, dark: 1, dragon: 1,
    ghost: -1, fairy: -1,
  },
  // Things made of rock, things that dig, things that hit hard.
  mining: {
    rock: 2, ground: 2, steel: 2,
    fighting: 1, dragon: 1,
    flying: -1, fairy: -1,
  },
  // Growing is patience and soil: grass above all, then earth, water and pollinators.
  farming: {
    grass: 2,
    ground: 1, water: 1, bug: 1, normal: 1, fairy: 1,
    fire: -1, ice: -1,
  },
}

/** Stat indices into BaseStats: hp, atk, def, spa, spd, spe. */
const HP = 0, ATK = 1, DEF = 2, SPD = 4, SPE = 5

/** The two stats the work leans on. */
export const STAT_PAIRS: Readonly<Record<SkillId, readonly [number, number]>> = {
  woodcutting: [ATK, SPE],
  mining: [ATK, DEF],
  // Stamina and care: long, gentle work.
  farming: [HP, SPD],
}

export const STAT_STRONG = 90
export const STAT_WEAK = 50

export function typeTier(skill: SkillId, types: readonly string[]): number {
  const tiers = types.map(type => TYPE_TIERS[skill][type] ?? 0)
  const best = Math.max(0, ...tiers)
  if (best > 0) return best
  return tiers.some(tier => tier < 0) ? -1 : 0
}

export function statTier(skill: SkillId, stats: BaseStats): number {
  const [a, b] = STAT_PAIRS[skill]
  const average = (stats[a] + stats[b]) / 2
  if (average >= STAT_STRONG) return 1
  if (average <= STAT_WEAK) return -1
  return 0
}
