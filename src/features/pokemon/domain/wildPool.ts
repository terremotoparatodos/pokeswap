// Wild pool selection — WildLands session-only display rule.
//
// The result is display-only. `slots` remains the ownership authority; callers
// must remove a selected id as soon as their server-backed slot says it is owned.

import type { Slot } from '../../../shared/types/database'

export const WILD_POOL_SIZE = 25
export const WILD_ROTATE_MS = 60 * 60 * 1000

export interface WildPoolOptions {
  size?: number
  random?: () => number
}

/** Catalog fields required by the selection rule, intentionally view-agnostic. */
export interface WildPoolPokemon {
  id: number
  is_legendary?: boolean | null
  base_aura?: number | null
}

type Category = 'legendary' | 'highAura' | 'other'

function categoryFor(random: number): Category {
  if (random < 0.02) return 'legendary'
  if (random < 0.14) return 'highAura'
  return 'other'
}

function matches(category: Category, pokemon: WildPoolPokemon): boolean {
  if (category === 'legendary') return pokemon.is_legendary === true
  if (category === 'highAura') return pokemon.is_legendary !== true && (pokemon.base_aura ?? 0) >= 250
  return pokemon.is_legendary !== true && (pokemon.base_aura ?? 0) < 250
}

/**
 * Picks a unique, unowned global pool. A missing weighted category falls back
 * to every remaining candidate, preserving the legacy map behavior.
 */
export function rollWildPool(
  pokemon: readonly WildPoolPokemon[],
  slots: Readonly<Record<number, Slot>>,
  options: WildPoolOptions = {},
): number[] {
  const random = options.random ?? Math.random
  const size = options.size ?? WILD_POOL_SIZE
  const available = pokemon.filter(entry => !slots[entry.id]?.owner_id)
  const pool: number[] = []

  while (pool.length < size && available.length) {
    const category = categoryFor(random())
    const candidates = available.filter(entry => matches(category, entry))
    const source = candidates.length ? candidates : available
    const index = Math.min(source.length - 1, Math.floor(random() * source.length))
    const picked = source[index]
    pool.push(picked.id)
    available.splice(available.findIndex(entry => entry.id === picked.id), 1)
  }
  return pool
}

/** Current members of a cosmetic pool that the server still reports as free. */
export function availableWildPool(pool: readonly number[], slots: Readonly<Record<number, Slot>>): number[] {
  return pool.filter(id => !slots[id]?.owner_id)
}
