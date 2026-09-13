import { ref, readonly } from 'vue'
import { listOwnedSlotsWithPokemon } from '../../pokemon/api/pokemonApi'
import type { SlotWithPokemon } from '../../pokemon/api/pokemonApi'

// Module-level singleton — ProfileView and MarketView share the same data.
const items = ref<SlotWithPokemon[]>([])
const isLoading = ref(false)
const error = ref<string | null>(null)
let _activeUserId: string | null = null

export function useMyBox() {
  async function load(userId: string): Promise<void> {
    if (isLoading.value) return
    _activeUserId = userId
    isLoading.value = true
    error.value = null
    try {
      items.value = await listOwnedSlotsWithPokemon(userId)
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Error cargando Pokémon'
    } finally {
      isLoading.value = false
    }
  }

  async function refresh(): Promise<void> {
    if (_activeUserId) await load(_activeUserId)
  }

  return {
    items: readonly(items),
    isLoading: readonly(isLoading),
    error: readonly(error),
    load,
    refresh,
  }
}
