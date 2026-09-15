import { ref, readonly } from 'vue'
import { listOwnedSlotsWithPokemon } from '../../pokemon/api/pokemonApi'
import type { SlotWithPokemon } from '../../pokemon/api/pokemonApi'

// Module-level singleton — MyBoxView and MarketView share the same data.
const items = ref<SlotWithPokemon[]>([])
const isLoading = ref(false)
const error = ref<string | null>(null)
const activeUserId = ref<string | null>(null)
let requestVersion = 0
let pending: { userId: string; promise: Promise<void> } | null = null

export function useMyBox() {
  async function load(userId: string): Promise<void> {
    if (pending?.userId === userId) return pending.promise
    const version = ++requestVersion
    if (activeUserId.value !== userId) items.value = []
    activeUserId.value = userId
    isLoading.value = true
    error.value = null
    const promise = listOwnedSlotsWithPokemon(userId)
      .then(result => {
        if (version === requestVersion && activeUserId.value === userId) items.value = result
      })
      .catch(e => {
        if (version === requestVersion && activeUserId.value === userId) {
          error.value = e instanceof Error ? e.message : 'Error cargando Pokémon'
        }
      })
      .finally(() => {
        if (version === requestVersion) {
          isLoading.value = false
          pending = null
        }
      })
    pending = { userId, promise }
    return promise
  }

  async function refresh(): Promise<void> {
    if (activeUserId.value) await load(activeUserId.value)
  }

  function clear(): void {
    requestVersion++
    pending = null
    activeUserId.value = null
    items.value = []
    isLoading.value = false
    error.value = null
  }

  return {
    items: readonly(items),
    isLoading: readonly(isLoading),
    error: readonly(error),
    activeUserId: readonly(activeUserId),
    load,
    refresh,
    clear,
  }
}
