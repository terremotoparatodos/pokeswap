import { computed, onMounted, onUnmounted, watch, watchEffect, type ShallowRef } from 'vue'
import { useAuth } from '../../auth/composables/useAuth'
import { useMyBox } from '../../progression/composables/useMyBox'
import { Atlas, LOBBY_ID } from '../areas/atlas'
import type { PlayerVisualIdentity } from './playerIdentity'
import { eligibleCompanion } from './playerIdentity'
import { playerCharacter } from './playerCharacters'
import type { TownPosition } from './playerPreferences'
import { usePlayerPreferencesStore } from './playerPreferencesStore'
import { isRestorableTownPosition } from './townPosition'

interface IdentityGamePort {
  setPlayerIdentity(identity: PlayerVisualIdentity): void
}

/** Connects auth and the server-backed box to cosmetic WildLands identity. */
export function usePlayerIdentity(game: ShallowRef<IdentityGamePort | null>) {
  const { user, profile, isLoading: authLoading } = useAuth()
  const box = useMyBox()
  const preferences = usePlayerPreferencesStore()
  let sessionGeneration = 0
  let positionTimer: ReturnType<typeof setTimeout> | null = null
  let pendingPosition: TownPosition | null = null

  watch(user, (current, previous) => {
    sessionGeneration++
    if (previous) flushTownPosition()
    if (!current) {
      preferences.deactivate()
      box.clear()
      return
    }
    preferences.activate(current.id)
    void box.load(current.id)
  }, { immediate: true })

  const companionItem = computed(() => {
    const current = user.value
    if (!current || box.activeUserId.value !== current.id || box.isLoading.value || box.error.value) return null
    return eligibleCompanion(preferences.preferences.value.companionPokemonId, current.id, box.items.value)
  })

  watch(
    [user, box.activeUserId, box.isLoading, box.error, box.items, () => preferences.preferences.value.companionPokemonId],
    () => {
      const current = user.value
      const selected = preferences.preferences.value.companionPokemonId
      if (!current || selected === null || box.activeUserId.value !== current.id || box.isLoading.value || box.error.value) return
      if (!companionItem.value) preferences.setCompanion(null)
    },
  )

  const visualIdentity = computed<PlayerVisualIdentity>(() => {
    const current = user.value
    const matchingProfile = current && profile.value?.id === current.id ? profile.value : null
    const item = companionItem.value
    return {
      username: matchingProfile?.username ?? null,
      character: playerCharacter(preferences.preferences.value.characterId),
      companion: item ? {
        id: item.pokemon.id,
        name_es: item.pokemon.name_es,
        sprite_url: item.pokemon.sprite_url,
      } : null,
    }
  })

  watchEffect(() => game.value?.setPlayerIdentity(visualIdentity.value))

  async function waitUntilReady(): Promise<void> {
    if (authLoading.value) {
      await new Promise<void>(resolve => {
        const stop = watch(authLoading, loading => {
          if (!loading) {
            stop()
            resolve()
          }
        })
      })
    }
    const current = user.value
    if (!current) return
    preferences.activate(current.id)
    if (box.activeUserId.value !== current.id || box.isLoading.value) await box.load(current.id)
  }

  function initialTownPosition(): TownPosition | null {
    if (!user.value) return null
    const saved = preferences.preferences.value.townPosition
    if (!saved) return null
    const town = new Atlas().get(LOBBY_ID)
    return isRestorableTownPosition(town, saved) ? saved : null
  }

  function recordTownPosition(position: TownPosition): void {
    if (!user.value) return
    pendingPosition = position
    if (positionTimer) return
    positionTimer = setTimeout(flushTownPosition, 250)
  }

  function flushTownPosition(): void {
    if (positionTimer) clearTimeout(positionTimer)
    positionTimer = null
    if (pendingPosition) preferences.setTownPosition(pendingPosition)
    pendingPosition = null
  }

  async function refreshOwnership(): Promise<void> {
    const generation = sessionGeneration
    const current = user.value
    if (!current) return
    await box.load(current.id)
    if (generation !== sessionGeneration) return
  }

  const onFocus = () => { void refreshOwnership() }
  onMounted(() => window.addEventListener('focus', onFocus))
  onUnmounted(() => {
    window.removeEventListener('focus', onFocus)
    flushTownPosition()
  })

  return {
    waitUntilReady,
    initialTownPosition,
    recordTownPosition,
    refreshOwnership,
  }
}
