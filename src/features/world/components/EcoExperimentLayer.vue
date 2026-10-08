<template>
  <!-- While the battle dialog is open, the debug panel is inert (no focus, no clicks): the dialog is modal. -->
  <EcoDevPanel :world="world" :session="session" :battle="battle" :area="currentArea" :tx="tx" :ty="ty" :inert="battle.phase !== 'idle' || undefined" />
  <EcoEncounterCard
    v-if="selected && battle.phase === 'idle'"
    :encounter-id="selected.id"
    :encounter="selectedLive"
    :species-id="selected.speciesId"
    :name="nameOf(selected.speciesId)"
    :tx="tx"
    :ty="ty"
    @close="selectedId = null"
    @engage="engage"
  />
  <EcoBattleScreen v-if="battle.phase !== 'idle'" :session="session" :view="battle" :catalog="catalog" :pokedex-name="pokedexName" />
</template>

<script setup lang="ts">
// ECO-PRESENTATION-1 (experimental, development builds only): the ECO experiment's interface on top
// of the map. It owns the one test-battle session and shows, in order of importance:
//   - the card of the individual the player tapped on the map (its encounter id, never a species);
//   - the battle screen while a battle (or its request, refusal or end) is on;
//   - the debug panel, a secondary tool sharing the same session.
// Presentation only: the server reserves, validates, runs and ends every battle.
import { computed, onUnmounted, ref, shallowRef, watch } from 'vue'
import type { EcoArea } from '../../../../services/realtime/src/world/worldProtocol.js'
import { loadBattleCatalog } from '../../battle/catalog'
import type { BattleCatalogIndex } from '../../battle/catalog'
import { ecoSpeciesName } from '../domain/ecoBattleText'
import { EcoBattleSession, type EcoBattleView } from '../state/ecoBattleSession'
import type { SharedWorld } from '../state/sharedWorld'
import EcoBattleScreen from './EcoBattleScreen.vue'
import EcoDevPanel from './EcoDevPanel.vue'
import EcoEncounterCard from './EcoEncounterCard.vue'

const props = defineProps<{
  world: SharedWorld
  areaId: string
  tx: number
  ty: number
  /** Spanish names when the Pokédex is loaded; empty in the sandbox. */
  pokedex?: readonly { readonly id: number; readonly name_es: string }[]
}>()
const emit = defineEmits<{ battle: [open: boolean] }>()

const area = shallowRef<EcoArea | null>(null)
const stopEco = props.world.onEco(next => { area.value = next })

const session = new EcoBattleSession(props.world)
const battle = shallowRef<EcoBattleView>(session.view)
const stopBattle = session.subscribe(view => { battle.value = view })
onUnmounted(() => { stopEco(); stopBattle(); session.dispose() })

const catalog = shallowRef<BattleCatalogIndex | null>(null)
loadBattleCatalog().then(index => { catalog.value = index }).catch(() => undefined)

const currentArea = computed(() => (area.value?.areaId === props.areaId ? area.value : null))
const pokedexName = (speciesId: number) => props.pokedex?.find(entry => entry.id === speciesId)?.name_es ?? null
const nameOf = (speciesId: number) => ecoSpeciesName(speciesId, pokedexName(speciesId), catalog.value?.species(speciesId)?.name)

/** The tapped individual: its id and species as they were when tapped (kept if it leaves the list). */
const selectedId = ref<string | null>(null)
const selectedSpecies = ref(0)
const selected = computed(() => (selectedId.value ? { id: selectedId.value, speciesId: selectedSpecies.value } : null))
const selectedLive = computed(() => currentArea.value?.encounters.find(e => e.id === selectedId.value) ?? null)

// Another area: whatever was selected there is not here (the server releases a battle left behind).
watch(() => props.areaId, () => { selectedId.value = null })
// A battle started by EITHER route (the card or the debug panel) ends the selection: back on the map
// after the battle, no older card comes back by itself.
watch(() => battle.value.phase !== 'idle', open => {
  if (open) selectedId.value = null
  emit('battle', open)
}, { immediate: true })

function engage(encounterId: string) {
  selectedId.value = null
  session.engage(encounterId)
}

defineExpose({
  /**
   * The player tapped (or faced) a wild actor. True when it is one of this area's ECO individuals:
   * its card opens, keyed by that exact encounter id. False: not ECO, the caller handles it.
   */
  select(actorId: string): boolean {
    const encounter = currentArea.value?.encounters.find(e => e.id === actorId)
    if (!encounter) return false
    if (battle.value.phase === 'idle') {
      selectedId.value = encounter.id
      selectedSpecies.value = encounter.speciesId
    }
    return true
  },
  /** Closes the card (another surface took over the screen). A battle in progress is the server's. */
  dismissCard(): void {
    selectedId.value = null
  },
})
</script>
