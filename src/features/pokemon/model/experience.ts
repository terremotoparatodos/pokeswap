// Experience and level (R32.2).
//
// **One source of truth: experience.** The level is derived from it and never
// stored beside it, so the two cannot drift. That is also what production
// already does — `grant_pokemon_xp` awards XP and recomputes the level, and
// the client reads the same formula from `progression/utils/xpLevel.ts`.
//
// The curve is PokeSwap's own (XP from level L to L+1 = L³), inherited from
// the legacy game and live in real data. The Battle Catalog ships each
// species' Gen VI growth rate, so adopting the canonical curves is possible
// later — but it would re-value every Pokémon that already exists, so it is a
// product decision and not a detail of this model (see the model doc).

import { MAX_LEVEL, xpNeededForLevel, xpToLevel } from '../../progression/utils/xpLevel'

export { MAX_LEVEL, xpToLevel }

/** Total experience needed to *be* this level. Level 1 is zero. */
export function experienceForLevel(level: number): number {
  const target = Math.max(1, Math.min(Math.floor(level), MAX_LEVEL))
  let total = 0
  for (let step = 1; step < target; step++) total += xpNeededForLevel(step)
  return total
}

/** The level an amount of experience buys. */
export const levelForExperience = (experience: number): number => xpToLevel(experience)

/** Experience still missing to reach the next level; 0 at the cap. */
export function experienceToNextLevel(experience: number): number {
  const level = levelForExperience(experience)
  if (level >= MAX_LEVEL) return 0
  return experienceForLevel(level + 1) - experience
}
