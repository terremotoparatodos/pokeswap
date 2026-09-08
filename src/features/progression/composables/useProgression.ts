// useProgression — R12: single-source-of-truth for a Pokémon's XP state.
//
// Authority model (INVARIANTS.md §Progression):
//   server/database  → persistent XP, level, moves (written only by SECURITY DEFINER RPCs)
//   memory cache     → reactive copy, refreshed on demand or after a grant
//   localStorage     → NEVER used for XP authority; may hold UI preferences only
//
// Components must not call supabase.from('pokemon_xp').update() directly.
// All XP mutations go through progressionApi.grantXp / progressionApi.learnMove.

import { ref, computed, readonly } from 'vue'
import { getPokemonXp, grantXp as apiGrantXp, learnMove as apiLearnMove } from '../api/progressionApi'
import { xpToLevel, xpInCurrentLevel, xpNeededForLevel, xpProgress } from '../utils/xpLevel'
import type { PokemonXp } from '../../../shared/types/database'

interface ProgressionState {
  raw: PokemonXp | null
  loading: boolean
  error: string | null
}

// Module-level cache keyed by pokemonId so multiple component instances
// share the same reactive state without duplicate network calls.
const _cache = new Map<number, ReturnType<typeof createProgressionState>>()

function createProgressionState(pokemonId: number) {
  const state = ref<ProgressionState>({ raw: null, loading: false, error: null })

  const xp = computed(() => state.value.raw?.xp ?? 0)
  const moves = computed(() => state.value.raw?.moves ?? null)

  // Level is derived from XP using the canonical formula — not from the
  // stored `level` column, which may lag in legacy data. The server's
  // grant_pokemon_xp also recomputes from scratch for consistency.
  const level = computed(() => xpToLevel(xp.value))
  const xpInLevel = computed(() => xpInCurrentLevel(xp.value))
  const xpForNextLevel = computed(() => xpNeededForLevel(level.value))
  const progress = computed(() => xpProgress(xp.value))
  const isMaxLevel = computed(() => level.value >= 100)

  async function load() {
    if (state.value.loading) return
    state.value = { ...state.value, loading: true, error: null }
    try {
      const data = await getPokemonXp(pokemonId)
      state.value = { raw: data, loading: false, error: null }
    } catch (err) {
      state.value = { ...state.value, loading: false, error: String(err) }
    }
  }

  async function refresh() {
    state.value = { ...state.value, loading: true, error: null }
    try {
      const data = await getPokemonXp(pokemonId)
      state.value = { raw: data, loading: false, error: null }
    } catch (err) {
      state.value = { ...state.value, loading: false, error: String(err) }
    }
  }

  async function grantXp(amount: number, reason?: string) {
    const result = await apiGrantXp(pokemonId, amount, reason)
    // Sync the cache with the authoritative server response
    if (state.value.raw) {
      state.value = {
        ...state.value,
        raw: { ...state.value.raw, xp: result.new_xp, level: result.new_level },
      }
    } else {
      await refresh()
    }
    return result
  }

  async function learnMove(newMoves: string[]) {
    const result = await apiLearnMove(pokemonId, newMoves)
    if (state.value.raw) {
      state.value = {
        ...state.value,
        raw: { ...state.value.raw, moves: newMoves as unknown as Record<string, unknown> },
      }
    }
    return result
  }

  return {
    loading: computed(() => state.value.loading),
    error: computed(() => state.value.error),
    xp: readonly(xp),
    level: readonly(level),
    xpInLevel: readonly(xpInLevel),
    xpForNextLevel: readonly(xpForNextLevel),
    progress: readonly(progress),
    isMaxLevel: readonly(isMaxLevel),
    moves: readonly(moves),
    load,
    refresh,
    grantXp,
    learnMove,
  }
}

/**
 * Returns reactive progression state for `pokemonId`.
 * Shared across component instances — call `load()` once to populate.
 *
 * Usage:
 *   const prog = useProgression(pokemonId)
 *   await prog.load()
 */
export function useProgression(pokemonId: number) {
  if (!_cache.has(pokemonId)) {
    _cache.set(pokemonId, createProgressionState(pokemonId))
  }
  return _cache.get(pokemonId)!
}

/** Clear the module-level cache. Useful in tests and on logout. */
export function clearProgressionCache() {
  _cache.clear()
}
