<template>
  <EcoDevPanel :world="world" :session="session" :battle="battle" :area="currentArea" :tx="tx" :ty="ty" />
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
  <EcoBattlePanel
    v-if="battle.phase !== 'idle'"
    :session="session" :view="battle" :catalog="catalog" :pokedex-name="pokedexName" :return-focus="returnFocus" :side="panelSide"
  />
</template>

<script setup lang="ts">
// The ECO experiment's interface on top of the map (experimental, development builds only). It
// owns the one test-battle session and shows:
//   - the card of the individual the player tapped on the map (its encounter id, never a species);
//   - ECO-OVERWORLD-BATTLE-1: the battle IN the world (an overlay the view composes into the
//     engine: the Pikachu beside the trainer, bars, marks; «en combate» over others' battles) and
//     a non-modal panel with the choices — it replaces ECO-PRESENTATION-1's modal;
//   - the debug panel, a secondary tool sharing the same session.
// Presentation only: the server reserves, validates, runs and ends every battle.
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import type { EcoArea } from '../../../../services/realtime/src/world/worldProtocol.js'
import type { SceneOverlay } from '../../wildlands/engine/sceneOverlay'
import { loadBattleCatalog } from '../../battle/catalog'
import type { BattleCatalogIndex } from '../../battle/catalog'
import { ecoSpeciesName } from '../domain/ecoBattleText'
import { EcoBattleOverlay } from '../render/ecoBattleOverlay'
import { EcoBattleSession, type EcoBattleView } from '../state/ecoBattleSession'
import type { SharedWorld } from '../state/sharedWorld'
import EcoBattlePanel from './EcoBattlePanel.vue'
import EcoDevPanel from './EcoDevPanel.vue'
import EcoEncounterCard from './EcoEncounterCard.vue'

const props = defineProps<{
  world: SharedWorld
  areaId: string
  tx: number
  ty: number
  /** Spanish names when the Pokédex is loaded; empty in the sandbox. */
  pokedex?: readonly { readonly id: number; readonly name_es: string }[]
  /** The local trainer's tile (from the engine), for where the battle stands. */
  player?: () => { readonly tx: number; readonly ty: number } | null
}>()
/** `overlay`: this layer's world overlay, for the view to compose into the engine (null on unmount). */
const emit = defineEmits<{ battle: [open: boolean]; overlay: [overlay: SceneOverlay | null] }>()

const area = shallowRef<EcoArea | null>(null)
const stopEco = props.world.onEco(next => { area.value = next })

const session = new EcoBattleSession(props.world)
const battle = shallowRef<EcoBattleView>(session.view)
const stopBattle = session.subscribe(view => { battle.value = view })

const catalog = shallowRef<BattleCatalogIndex | null>(null)
loadBattleCatalog().then(index => { catalog.value = index }).catch(() => undefined)

const currentArea = computed(() => (area.value?.areaId === props.areaId ? area.value : null))
const pokedexName = (speciesId: number) => props.pokedex?.find(entry => entry.id === speciesId)?.name_es ?? null
const nameOf = (speciesId: number) => ecoSpeciesName(speciesId, pokedexName(speciesId), catalog.value?.species(speciesId)?.name)

// ── The battle in the world ──
const battleWorld = new EcoBattleOverlay({ player: () => props.player?.() ?? { tx: props.tx, ty: props.ty }, now: () => session.clock() })
const stopEvents = session.onEvents(events => battleWorld.pushEvents(events))
watch(catalog, value => battleWorld.setCatalog(value), { immediate: true })
/** The encounter's last server-listed tile (kept if it leaves the list, e.g. retired by the victory). */
const wildTiles = new Map<string, { tx: number; ty: number }>()
watch([battle, currentArea], ([view, here]) => {
  for (const e of here?.encounters ?? []) wildTiles.set(e.id, { tx: e.tx, ty: e.ty })
  if (view.phase === 'battle' || view.phase === 'ended') {
    const wildTile = wildTiles.get(view.encounterId)
    battleWorld.setBattle(wildTile ? {
      snapshot: view.snapshot, snapshotAt: view.phase === 'battle' ? view.snapshotAt : session.clock(),
      connected: view.phase === 'battle' && view.connected, encounterId: view.encounterId, wildTile,
    } : null)
  } else {
    battleWorld.setBattle(null)
  }
  battleWorld.setBusy(here?.encounters ?? [])
}, { immediate: true })
onMounted(() => emit('overlay', battleWorld.overlay))
onUnmounted(() => {
  emit('overlay', null)
  stopEco(); stopBattle(); stopEvents(); session.dispose()
})

/**
 * Framing: the panel stands on the side away from the wild Pokémon, so an encounter inside the
 * engage range is never under it (measured in the sandbox: one at +5,+2 tiles fell inside the
 * bottom-right panel). The trainer cannot move during the battle, so this is fixed per battle.
 */
const panelSide = computed((): 'left' | 'right' => {
  const view = battle.value
  if (view.phase !== 'battle' && view.phase !== 'ended' && view.phase !== 'engaging') return 'right'
  const wild = wildTiles.get(view.encounterId ?? '')
  const player = props.player?.() ?? { tx: props.tx, ty: props.ty }
  return wild && wild.tx > player.tx ? 'left' : 'right'
})

/** The tapped individual: its id and species as they were when tapped (kept if it leaves the list). */
const selectedId = ref<string | null>(null)
const selectedSpecies = ref(0)
const selected = computed(() => (selectedId.value ? { id: selectedId.value, speciesId: selectedSpecies.value } : null))
const selectedLive = computed(() => currentArea.value?.encounters.find(e => e.id === selectedId.value) ?? null)

/** Where the focus was when the battle was asked for — by the card or by the debug panel. */
const returnFocus = shallowRef<HTMLElement | null>(null)

// Another area: whatever was selected there is not here (the server releases a battle left behind).
watch(() => props.areaId, () => { selectedId.value = null })
// A battle started by EITHER route (the card or the debug panel) ends the selection, and remembers
// the control that asked for it (synchronously, before anything else moves the focus).
watch(() => battle.value.phase !== 'idle', open => {
  if (open) {
    selectedId.value = null
    returnFocus.value = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
  }
  emit('battle', open)
}, { immediate: true, flush: 'sync' })

function engage(encounterId: string) {
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
