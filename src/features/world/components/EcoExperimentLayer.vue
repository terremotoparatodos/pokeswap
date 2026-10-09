<template>
  <EcoDevPanel :world="world" :session="session" :battle="battle" :area="currentArea" :tx="tx" :ty="ty" :seen-at="seenAt" />
  <EcoEncounterCard
    v-if="selected && !holds(battle.phase)"
    :encounter-id="selected.id"
    :encounter="selectedLive"
    :seen="selectedLive && seenAt(selectedLive)"
    :species-id="selected.speciesId"
    :name="nameOf(selected.speciesId)"
    :tx="tx"
    :ty="ty"
    @close="selectedId = null"
    @engage="engage"
  />
  <EcoBattlePanel
    v-if="holds(battle.phase)"
    :session="session" :view="battle" :catalog="catalog" :pokedex-name="pokedexName" :return-focus="returnFocus" :side="panelSide" :map-focus="mapFocus"
  />
  <EcoBattleToast v-if="result" :key="result.key" :title="result.title" :detail="result.detail" />
</template>

<script setup lang="ts">
// The ECO experiment's interface on top of the map (experimental, development builds only). It
// owns the one test-battle session and shows:
//   - the card of the individual the player tapped on the map (its encounter id, never a species);
//   - ECO-OVERWORLD-BATTLE-1: the battle IN the world (an overlay the view composes into the
//     engine: the Pikachu beside the trainer, bars, marks; «en combate» over others' battles) and
//     a non-modal panel with the choices — it replaces ECO-PRESENTATION-1's modal;
//   - ECO-BATTLE-SPECTATORS-1: the OTHER players' battles in this area, drawn the same way from the
//     server's public view — watched only: no panel, no controls, the player keeps walking;
//   - the debug panel, a secondary tool sharing the same session;
//   - ECO-BATTLE-ENDING-1: the server's end needs no acceptance. The player gets the map back at
//     once (no lock, no panel, no «Volver al mapa»); a brief non-modal notice names the result, and
//     the world plays the end out (Pikachu back to its ball; the wild one fades only on a victory).
// Presentation only: the server reserves, validates, runs and ends every battle.
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import type { EcoArea, EcoEncounter } from '../../../../services/realtime/src/world/worldProtocol.js'
import type { SceneOverlay } from '../../wildlands/engine/sceneOverlay'
import { loadBattleCatalog } from '../../battle/catalog'
import type { BattleCatalogIndex } from '../../battle/catalog'
import { ECO_OUTCOME_TEXT, ecoSpeciesName } from '../domain/ecoBattleText'
import { ecoSeenTile, type Tile } from '../domain/ecoSeenTile'
import { EcoBattleOverlay } from '../render/ecoBattleOverlay'
import { EcoBattleSession, type EcoBattleView } from '../state/ecoBattleSession'
import { EcoSpectatedBattles } from '../state/ecoSpectatedBattles'
import type { SharedWorld } from '../state/sharedWorld'
import EcoBattlePanel from './EcoBattlePanel.vue'
import EcoBattleToast from './EcoBattleToast.vue'
import EcoDevPanel from './EcoDevPanel.vue'
import EcoEncounterCard from './EcoEncounterCard.vue'

const props = defineProps<{
  world: SharedWorld
  areaId: string
  tx: number
  ty: number
  /** Spanish names when the Pokédex is loaded; empty in the sandbox. */
  pokedex?: readonly { readonly id: number; readonly name_es: string }[]
  /** A valid focus destination on the map (the game canvas), for when a battle closes. */
  mapFocus?: () => HTMLElement | null
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
const battleWorld = new EcoBattleOverlay({ now: () => session.clock() })
const stopEvents = session.onEvents(events => battleWorld.pushEvents(events))
watch(catalog, value => battleWorld.setCatalog(value), { immediate: true })
/**
 * The area the battle is fought in, fixed when it is asked for. Its scene (the Pikachu, the bars,
 * the marks) is drawn there only: once the player is in another area it is dropped for good, even
 * while the panel still shows the result, and coming back does not bring it back.
 */
let battleArea: string | null = null
watch([battle, currentArea, () => props.areaId], ([view, here, areaId]) => {
  if (battleArea !== null && battleArea !== areaId) { battleArea = null; battleWorld.dropOwnEnding() }
  if (view.phase === 'battle' && battleArea) {
    // ECO-BATTLE-SCENE-1: the scene is the server's, never computed from where the trainer stands.
    battleWorld.setBattle(view.stage ? {
      snapshot: view.snapshot, snapshotAt: view.snapshotAt, connected: view.connected, encounterId: view.encounterId, stage: view.stage,
    } : null)
  } else if (view.phase === 'ended' && battleArea) {
    // The server's end: played out in the world, holding nothing (the wild one fades only on a victory it retired).
    battleWorld.finish(view.encounterId, view.outcome === 'victory' && view.retired)
  } else {
    battleWorld.setBattle(null)
  }
  battleWorld.setBusy(here?.encounters ?? [])
}, { immediate: true })
// ── Others' battles here (ECO-BATTLE-SPECTATORS-1): watched, never controlled ──
const ownBattleId = () => (battle.value.phase === 'battle' || battle.value.phase === 'ended' ? battle.value.battleId : null)
const spectators = new EcoSpectatedBattles(props.world, () => session.clock(), ownBattleId)
const stopSpectated = spectators.subscribe(list => battleWorld.setSpectated(list))
const stopSpectatorEvents = spectators.onEvents((battleId, events) => battleWorld.pushSpectatorEvents(battleId, events))
// The area the player sees, as soon as it changes (before the server's snapshot of the new one).
watch(() => props.areaId, areaId => spectators.setViewArea(areaId), { immediate: true, flush: 'sync' })
onMounted(() => emit('overlay', battleWorld.overlay))
onUnmounted(() => {
  emit('overlay', null)
  stopEco(); stopBattle(); stopEvents(); session.dispose()
  stopSpectated(); stopSpectatorEvents(); spectators.dispose()
})

/**
 * Framing: the panel stands on the side away from the wild Pokémon, so the battle is never under it
 * (measured in the sandbox: one at +5,+2 tiles fell inside the bottom-right panel). ECO-BATTLE-SCENE-1:
 * the trainer may walk during the battle, so it follows the trainer's tile against the frozen wild one.
 */
const panelSide = computed((): 'left' | 'right' => {
  const view = battle.value
  const wild = view.phase === 'battle' ? view.stage?.wild : null
  const player = { tx: props.tx, ty: props.ty }
  return wild && wild.tx > player.tx ? 'left' : 'right'
})

/** The tapped individual: its id and species as they were when tapped (kept if it leaves the list). */
const selectedId = ref<string | null>(null)
const selectedSpecies = ref(0)
const selected = computed(() => (selectedId.value ? { id: selectedId.value, speciesId: selectedSpecies.value } : null))
const selectedLive = computed(() => currentArea.value?.encounters.find(e => e.id === selectedId.value) ?? null)

/**
 * SC-R1: where each encounter is seen now, for the card's and the debug panel's distance — its
 * shared patrol pose at the shared world clock, the tile the map draws and the server measures the
 * start range from. The clock is re-read on a short beat so the distance follows the patrol.
 */
const SEEN_REFRESH_MS = 200
const seenClock = ref(props.world.serverNow())
const seenTimer = setInterval(() => { seenClock.value = props.world.serverNow() }, SEEN_REFRESH_MS)
onUnmounted(() => clearInterval(seenTimer))
const seenAt = (encounter: EcoEncounter): Tile => ecoSeenTile(encounter, props.areaId, seenClock.value)

/** Where the focus was when the battle was asked for — by the card or by the debug panel. */
const returnFocus = shallowRef<HTMLElement | null>(null)

/**
 * What shows the panel — asking, fighting, or a refusal to read (ECO-BATTLE-ENDING-1: an END does
 * not; it is the server's). ECO-BATTLE-SCENE-1: none of them holds the trainer in place any more.
 */
const holds = (phase: EcoBattleView['phase']) => phase === 'engaging' || phase === 'battle' || phase === 'refused'

/** The brief notice of the owner's last end (non-modal; it leaves on its own or when another battle starts). */
const RESULT_NOTICE_MS = 3_000
const result = shallowRef<{ key: string; title: string; detail: string } | null>(null)
let resultTimer: ReturnType<typeof setTimeout> | null = null
watch(battle, (view, previous) => {
  if (view.phase === 'ended' && (previous?.phase !== 'ended' || previous.battleId !== view.battleId)) {
    const text = ECO_OUTCOME_TEXT[view.outcome]
    result.value = { key: view.battleId, title: text.title, detail: text.detail }
    if (resultTimer) clearTimeout(resultTimer)
    resultTimer = setTimeout(() => { result.value = null; resultTimer = null }, RESULT_NOTICE_MS)
  } else if (view.phase === 'engaging' && result.value) {
    if (resultTimer) clearTimeout(resultTimer)
    result.value = null; resultTimer = null
  }
}, { flush: 'sync' })
onUnmounted(() => { if (resultTimer) clearTimeout(resultTimer) })

// Another area: whatever was selected there is not here (the server releases a battle left behind).
watch(() => props.areaId, () => { selectedId.value = null })
// Every battle asked for (or resumed) fixes its OWN area, also when it starts straight from the
// previous one's open result (ended → engaging never passes through idle): what the previous
// battle dropped on leaving its area is never inherited, and never brought back.
watch(battle, (view, previous) => {
  const starts = view.phase === 'engaging'
    ? previous?.phase !== 'engaging'
    : view.phase === 'battle' && previous?.phase !== 'engaging' && previous?.phase !== 'battle'
  if (starts) battleArea = props.areaId
  else if (view.phase === 'idle') battleArea = null
}, { immediate: true, flush: 'sync' })
// A battle started by EITHER route (the card or the debug panel) ends the selection, and remembers
// the control that asked for it (synchronously, before anything else moves the focus).
watch(() => holds(battle.value.phase), open => {
  if (!open) return
  selectedId.value = null
  returnFocus.value = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
}, { immediate: true, flush: 'sync' })
/**
 * ECO-BATTLE-SCENE-1: `battle` tells the view whether a battle is being asked for or fought — the
 * trainer then keeps walking the area and chatting, but takes no portal and starts no other
 * activity (the server refuses both anyway). A refusal or the end lifts it.
 */
watch(() => battle.value.phase === 'engaging' || battle.value.phase === 'battle', inBattle => emit('battle', inBattle), { immediate: true, flush: 'sync' })

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
    if (!holds(battle.value.phase)) {
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
