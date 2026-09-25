<template>
  <PlazaNotice :text="plaza.notice.value" />

  <PlazaPokemonCard v-if="card" :card="card" @close="cardId = null" @market="openMarket" />
  <WildPokemonCard v-if="wildCard" :pokemon="wildCard" @close="wildCardId = null" @feature="openFeature" />

  <ActivityBoard
    v-if="boardOpen"
    :entries="boardList"
    :connected="plaza.connected.value"
    :load-error="plaza.loadError.value"
    @close="boardOpen = false"
  />
</template>

<script setup lang="ts">
import { computed, ref, toRef, watch, watchEffect } from 'vue'
import { useAuth } from '../../auth/composables/useAuth'
import type { WildlandsGame } from '../engine/game'
import type { PlazaHit } from '../engine/plazaTaps'
import type { WildHit } from '../engine/wildTaps'
import type { LobbyFeature } from '../lobby/features'
import type { PokedexEntry } from '../engine/population'
import { boardEntries } from '../lobby/plazaNotices'
import { usePlazaData } from '../lobby/usePlazaData'
import ActivityBoard from './ActivityBoard.vue'
import PlazaNotice from './PlazaNotice.vue'
import PlazaPokemonCard from './PlazaPokemonCard.vue'
import WildPokemonCard from './WildPokemonCard.vue'

// The plaza with real data (R26): feeds the town's owned Pokémon to the game and
// shows their cards, the activity board and toasts. Read-only, like usePlazaData.
const props = defineProps<{
  game: WildlandsGame | null
  pokedex: readonly PokedexEntry[]
  /** A feature panel, the menu or sign-in covers the town. */
  covered: boolean
  /** WORLD-1D: this hour's wild pool from the realtime service, null until it sends one. */
  sharedWildPool?: readonly number[] | null
}>()
const emit = defineEmits<{ /** A card or the board is showing (the town pauses). */ overlay: [open: boolean]; market: []; feature: [feature: LobbyFeature] }>()

const { user } = useAuth()
const boardOpen = ref(false)
const cardId = ref<number | null>(null)
const wildCardId = ref<number | null>(null)

const plaza = usePlazaData({
  pokedex: toRef(props, 'pokedex'),
  userId: computed(() => user.value?.id ?? null),
  quiet: () => props.covered || boardOpen.value,
  sharedWildPool: computed(() => props.sharedWildPool ?? null),
})
const card = computed(() => (cardId.value === null ? null : plaza.card(cardId.value)))
const wildCard = computed(() => {
  const id = wildCardId.value
  if (id === null || !plaza.wildPokemonIds.value.includes(id)) return null
  return props.pokedex.find(entry => entry.id === id) ?? null
})
const boardList = computed(() => boardEntries(plaza.activity.value, plaza.nameOf, Date.now()))

watchEffect(() => props.game?.setOwnedPokemon(plaza.residents.value))
watchEffect(() => props.game?.setWildPokemonIds(plaza.wildPokemonIds.value))
watchEffect(() => emit('overlay', boardOpen.value || cardId.value !== null || wildCard.value !== null))
// Something else took over the screen: the plaza overlays step aside.
watch(() => props.covered, covered => {
  if (covered) {
    cardId.value = null
    wildCardId.value = null
    boardOpen.value = false
  }
})

function openMarket(): void {
  cardId.value = null
  emit('market')
}

function openFeature(feature: LobbyFeature): void {
  wildCardId.value = null
  emit('feature', feature)
}

defineExpose({
  /** The player tapped or faced an owned Pokémon or the board. */
  inspect(hit: PlazaHit | WildHit): void {
    if (hit.kind === 'board') boardOpen.value = true
    else if (hit.kind === 'wild') wildCardId.value = hit.pokemonId
    else cardId.value = hit.pokemonId
  },
  openBoard(): void {
    boardOpen.value = true
  },
  dismissTransient(): void {
    cardId.value = null
    wildCardId.value = null
    boardOpen.value = false
  },
})
</script>
