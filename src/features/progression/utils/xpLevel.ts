// Canonical XP → level formulas for PokeSwap.
// Medium Fast curve (matches legacy index.html): XP needed to advance from
// level L to L+1 = L³. Level is capped at 100.
//
// These are pure functions with no side effects. They are the single source
// of truth for level computation on the client. The server uses the same
// formula in grant_pokemon_xp() (migration 008).

export const MAX_LEVEL = 100

/** XP required to advance from `level` to `level + 1`. */
export function xpNeededForLevel(level: number): number {
  return Math.pow(Math.max(1, Math.min(level, MAX_LEVEL - 1)), 3)
}

/** Compute the current level from total accumulated XP. */
export function xpToLevel(totalXp: number): number {
  let level = 1
  let remaining = Math.max(0, totalXp)
  while (level < MAX_LEVEL && remaining >= xpNeededForLevel(level)) {
    remaining -= xpNeededForLevel(level)
    level++
  }
  return level
}

/** XP accumulated within the current level (resets to 0 on level-up). */
export function xpInCurrentLevel(totalXp: number): number {
  let remaining = Math.max(0, totalXp)
  let level = 1
  while (level < MAX_LEVEL && remaining >= xpNeededForLevel(level)) {
    remaining -= xpNeededForLevel(level)
    level++
  }
  return level >= MAX_LEVEL ? 0 : remaining
}

/** Fraction [0, 1] of progress toward the next level. 1.0 when at max level. */
export function xpProgress(totalXp: number): number {
  const level = xpToLevel(totalXp)
  if (level >= MAX_LEVEL) return 1
  const inLevel = xpInCurrentLevel(totalXp)
  return inLevel / xpNeededForLevel(level)
}
