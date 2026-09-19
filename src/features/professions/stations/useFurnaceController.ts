// Furnace controller: connects a WildLands game, the local demo session and
// the furnace overlay (R33).
//
// It owns no rules. Every transition goes through `stationSession`, which goes
// through the pure process machine; what lives here is the Vue surface — which
// panel is open, which recipe is picked, and a per-frame tick that asks the
// domain whether the work is finished yet.
//
// The tick is the only clock, and it is the *demo session's* clock
// (`state.now`), so the playground's time travel moves the furnace too. It
// decides nothing: it hands a reading to `tickStation`, which is idempotent.
// A server clock replaces that one argument later and nothing else moves (§16).

import { computed, ref, shallowRef } from 'vue'
import type { Area } from '../../wildlands/engine/area'
import type { WorldObjectTarget } from '../../wildlands/engine/game'
import { demoCounts, demoLevel, type DemoState } from '../demo/demoSession'
import type { ProfessionDemoSession } from '../demo/useProfessionDemo'
import { hasItems } from '../domain/inventory'
import type { MiningGamePort } from '../mining/useMiningController'
import { FurnaceOverlay } from './furnaceOverlay'
import { recipesForStation, STATION_BY_ID } from './stationDefinition'
import type { FootprintTile } from './stationFootprint'
import { placeStation, stationState, type PlacedStation } from './stationInstance'
import { placedObjectFor, type StationPlacedObject } from './stationPlacement'
import { processProgress, remainingMs } from './stationProcess'
import {
  cancelStation, collectStation, prepareStation, startStation, tickStation, type StationActionFailure,
} from './stationSession'
import { stationVisualState } from './stationVisualState'

const FURNACE = STATION_BY_ID.get('smelter')!
const FURNACE_RECIPES = recipesForStation('smelter')

export type FurnaceGamePort = MiningGamePort

export interface FurnaceRecipeView {
  readonly id: string
  readonly name: string
  readonly inputs: readonly { readonly itemId: string; readonly quantity: number; readonly have: number }[]
  readonly output: { readonly itemId: string; readonly quantity: number }
  readonly requiredLevel: number
  readonly seconds: number
  /** Why it cannot be prepared right now, or null. */
  readonly block: 'level' | 'inputs' | null
}

export function useFurnaceController(
  session: ProfessionDemoSession,
  game: () => FurnaceGamePort | null,
  avoid: (area: Area) => readonly FootprintTile[] = () => [],
) {
  const open = ref(false)
  const recipeId = ref<string>(FURNACE_RECIPES[0]?.id ?? '')
  const quantity = ref(1)
  const failure = shallowRef<StationActionFailure['error'] | null>(null)

  /** One furnace per area, created the first time that area is seen. */
  const stations = new Map<string, PlacedStation>()
  const station = shallowRef<PlacedStation | null>(null)
  /** The area the open furnace is in; the overlay needs it to place a reward pop. */
  const currentArea = shallowRef<Area | null>(null)

  const overlay = new FurnaceOverlay({
    state: () => (station.value ? stationVisualState(station.value) : 'idle'),
    avoid,
  })

  const level = computed(() => demoLevel(session.state.value, 'mining'))
  const phase = computed(() => (station.value ? stationState(station.value) : 'idle'))
  const visual = computed(() => (station.value ? stationVisualState(station.value) : 'idle'))
  const process = computed(() => station.value?.process ?? null)

  const recipes = computed<FurnaceRecipeView[]>(() => {
    const counts = demoCounts(session.state.value)
    return FURNACE_RECIPES.map(recipe => ({
      id: recipe.id,
      name: recipe.id,
      inputs: recipe.inputs.map(stack => ({ ...stack, have: counts[stack.itemId] ?? 0 })),
      output: recipe.outputs[0] ?? { itemId: '', quantity: 0 },
      requiredLevel: recipe.requiredLevel,
      seconds: recipe.baseSeconds,
      block: level.value < recipe.requiredLevel ? 'level'
        : hasItems(counts, recipe.inputs, quantity.value) ? null : 'inputs',
    }))
  })

  const selected = computed(() => recipes.value.find(entry => entry.id === recipeId.value) ?? recipes.value[0] ?? null)

  /** Seconds left, for the panel. Derived from the process, never from a timer. */
  const remainingSeconds = computed(() => Math.ceil(remainingMs(process.value, session.state.value.now) / 1000))
  const progress = computed(() => processProgress(process.value, session.state.value.now))

  function stationFor(area: Area): PlacedStation | null {
    const anchor = overlay.stationAt(area)
    if (!anchor) return null
    const existing = stations.get(area.id)
    if (existing && sameAnchor(existing.anchor, anchor)) return existing
    const placed = placeStation(`furnace:${area.id}`, 'smelter', area.id, anchor)
    stations.set(area.id, placed)
    return placed
  }

  const sameAnchor = (a: FootprintTile, b: FootprintTile) => a.tx === b.tx && a.ty === b.ty

  /**
   * The furnace as a physical object of the world (F-1): its own cells, so it
   * is solid on all four tiles, and its art size as the tap reach. The
   * controller declares; the engine's registry owns solidity.
   */
  function placedObjects(area: Area): StationPlacedObject[] {
    const anchor = overlay.stationAt(area)
    return anchor ? [placedObjectFor(FURNACE, `furnace:${area.id}`, area.id, anchor)] : []
  }

  const isStation = (hit: WorldObjectTarget) => overlay.isStation(hit.area, hit.tx, hit.ty)

  const attach = () => game()?.setSceneOverlay(overlay)
  const detach = () => { open.value = false }

  function inspect(hit: WorldObjectTarget): boolean {
    if (!overlay.isStation(hit.area, hit.tx, hit.ty)) return false
    station.value = stationFor(hit.area)
    currentArea.value = hit.area
    failure.value = null
    open.value = true
    return true
  }

  function close(): void {
    open.value = false
    failure.value = null
  }

  function select(id: string): void {
    recipeId.value = id
    failure.value = null
  }

  function setQuantity(value: number): void {
    quantity.value = Math.max(1, Math.min(20, Math.round(value)))
  }

  /**
   * The run's identity. A counter on the station id: stable, injected, and
   * never `Math.random()`, so a future server can replace it with its own
   * without the domain noticing (§35).
   */
  let runs = 0
  const nextProcessId = (current: PlacedStation) => `${current.stationId}#${++runs}`

  function apply<T extends { ok: true; state: DemoState; station: PlacedStation }>(
    action: (state: DemoState, current: PlacedStation) => T | StationActionFailure,
  ): T | null {
    const current = station.value
    if (!current) return null
    session.sync()
    const result = action(session.state.value, current)
    if (!result.ok) {
      failure.value = result.error
      return null
    }
    failure.value = null
    session.update(() => result.state)
    commit(result.station)
    return result
  }

  function commit(next: PlacedStation): void {
    stations.set(next.areaId, next)
    station.value = next
  }

  const prepare = () => !!apply((state, current) =>
    prepareStation(state, current, recipeId.value, quantity.value, nextProcessId(current)))

  const start = () => !!apply((state, current) => startStation(state, current, state.now))

  const cancel = () => !!apply((state, current) => cancelStation(state, current))

  function collect(): boolean {
    const area = currentArea.value
    const result = apply((state, current) => collectStation(state, current))
    if (!result) return false
    if (area) overlay.celebrate(area, result.credited, result.xp)
    return true
  }

  /**
   * Called from the surface's frame loop. Asks the domain whether the work is
   * finished at the session's current reading; it never completes anything
   * itself, and calling it a thousand times is the same as calling it once.
   */
  function tick(): void {
    const current = station.value
    if (!current || current.process?.phase !== 'working') return
    const next = tickStation(current, session.state.value.now)
    if (next !== current) commit(next)
  }

  return {
    open, overlay, recipes, recipeId, selected, quantity, level, phase, visual, process,
    remainingSeconds, progress, failure, station,
    attach, detach, placedObjects, isStation, inspect, close, select, setQuantity,
    prepare, start, collect, cancel, tick, stationFor,
  }
}

export type FurnaceController = ReturnType<typeof useFurnaceController>
