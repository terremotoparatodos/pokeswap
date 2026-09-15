import { readonly, ref } from 'vue'
import {
  defaultPlayerPreferences,
  readPlayerPreferences,
  removePlayerPreferences,
  writePlayerPreferences,
  type PlayerPreferences,
  type TownPosition,
} from './playerPreferences'
import type { PlayerCharacterId } from './playerCharacters'

const activeUserId = ref<string | null>(null)
const preferences = ref<PlayerPreferences>(defaultPlayerPreferences())

function activate(userId: string): void {
  if (activeUserId.value === userId) return
  activeUserId.value = userId
  preferences.value = readPlayerPreferences(userId)
}

function deactivate(): void {
  activeUserId.value = null
  preferences.value = defaultPlayerPreferences()
}

function update(change: Partial<Omit<PlayerPreferences, 'version'>>): void {
  const userId = activeUserId.value
  if (!userId) return
  preferences.value = { ...preferences.value, ...change }
  writePlayerPreferences(userId, preferences.value)
}

function reset(): void {
  const userId = activeUserId.value
  if (!userId) return
  removePlayerPreferences(userId)
  preferences.value = defaultPlayerPreferences()
}

export function usePlayerPreferencesStore() {
  return {
    activeUserId: readonly(activeUserId),
    preferences: readonly(preferences),
    activate,
    deactivate,
    setCharacter: (characterId: PlayerCharacterId) => update({ characterId }),
    setCompanion: (companionPokemonId: number | null) => update({ companionPokemonId }),
    setTownPosition: (townPosition: TownPosition) => update({ townPosition }),
    reset,
  }
}
