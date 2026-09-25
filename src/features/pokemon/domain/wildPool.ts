// Wild pool selection — WildLands session-only display rule.
//
// The result is display-only. `slots` remains the ownership authority; callers
// must remove a selected id as soon as their server-backed slot says it is owned.

import type { Slot } from '../../../shared/types/database'
import { rollWildPool as sharedRollWildPool } from '../../../../services/realtime/src/world/wildPopulation.js'

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

/**
 * Picks a unique, unowned global pool. A missing weighted category falls back
 * to every remaining candidate, preserving the legacy map behavior.
 *
 * WORLD-1: the rule lives in the realtime service's wild population module,
 * which rolls the one shared pool per hour; this wrapper keeps the browser's
 * legacy fallback on the very same code.
 */
export function rollWildPool(
  pokemon: readonly WildPoolPokemon[],
  slots: Readonly<Record<number, Slot>>,
  options: WildPoolOptions = {},
): number[] {
  const owned = new Set(pokemon.filter(entry => slots[entry.id]?.owner_id).map(entry => entry.id))
  return sharedRollWildPool(pokemon, owned, options.random ?? Math.random, options.size ?? WILD_POOL_SIZE)
}

/** Current members of a cosmetic pool that the server still reports as free. */
export function availableWildPool(pool: readonly number[], slots: Readonly<Record<number, Slot>>): number[] {
  return pool.filter(id => !slots[id]?.owner_id)
}
