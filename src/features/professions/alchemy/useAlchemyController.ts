// Alchemy controller: connects a WildLands game, the local demo session and the
// alchemy overlay. Used by the field lab and the dev-only WildLands demo, so
// both surfaces behave identically.
//
// Unlike the gathering professions there is no node and no tool: the bench is
// the target, the recipe is the action and the ingredients are the cost.

import { computed, ref, shallowRef, watch } from 'vue'
import type { WorldObjectTarget } from '../../wildlands/engine/game'
import { demoCounts, demoLevel, demoWorker } from '../demo/demoSession'
import type { ProfessionDemoSession } from '../demo/useProfessionDemo'
import type { ProcessingResult } from '../domain/types'
import type { MiningGamePort } from '../mining/useMiningController'
import { isBeside } from '../overworld/workerPresence'
import { alchemyBrowser, ALCHEMY_RECIPES, alchemyRecipeView } from './recipeBrowser'
import { AlchemyOverlay } from './alchemyOverlay'
import { brewTimeline } from './brewTimeline'
import type { StationTile } from './stationPlacement'

export type AlchemyPhase = 'idle' | 'brewing' | 'result'

export type AlchemyGamePort = MiningGamePort

export type BrewOutcome =
  | { readonly ok: true; readonly result: Extract<ProcessingResult, { ok: true }>; readonly leveledUp: boolean; readonly level: number }
  | { readonly ok: false; readonly reason: string }

export function useAlchemyController(session: ProfessionDemoSession, game: () => AlchemyGamePort | null, anchor: () => StationTile | null) {
  /** Open means the player is standing at the bench with the panel up. */
  const open = ref(false)
  const phase = ref<AlchemyPhase>('idle')
  const recipeId = ref<string>(ALCHEMY_RECIPES[0]?.id ?? '')
  const quantity = ref(1)
  const outcome = shallowRef<BrewOutcome | null>(null)

  const overlay = new AlchemyOverlay({
    player: () => game()?.playerSnapshot() ?? null,
    anchor,
    selected: () => open.value,
  })

  watch(() => demoWorker(session.state.value, 'alchemy')?.speciesId ?? null, speciesId => {
    if (speciesId !== null) overlay.preloadWorker(speciesId)
  }, { immediate: true })

  const level = computed(() => demoLevel(session.state.value, 'alchemy'))
  const recipes = computed(() => alchemyBrowser(demoCounts(session.state.value), level.value))
  const recipe = computed(() => ALCHEMY_RECIPES.find(entry => entry.id === recipeId.value) ?? ALCHEMY_RECIPES[0])
  const view = computed(() => (recipe.value
    ? alchemyRecipeView(recipe.value, demoCounts(session.state.value), level.value, quantity.value)
    : null))
  /** What a single craft would need, used for the quantity ceiling. */
  const single = computed(() => (recipe.value
    ? alchemyRecipeView(recipe.value, demoCounts(session.state.value), level.value, 1)
    : null))
  const maxQuantity = computed(() => Math.max(1, single.value?.maxCraftable ?? 1))

  watch(maxQuantity, max => { if (quantity.value > max) quantity.value = max })

  const attach = () => game()?.setSceneOverlay(overlay)
  const detach = () => {
    overlay.cancel()
    stopProgress()
    game()?.setSceneOverlay(null)
    game()?.setInputLocked(false)
  }

  const isStation = (hit: WorldObjectTarget) => overlay.isStation(hit.area, hit.tx, hit.ty)

  function inspect(hit: WorldObjectTarget): boolean {
    if (!overlay.isStation(hit.area, hit.tx, hit.ty)) return false
    if (phase.value === 'brewing') return true
    open.value = true
    outcome.value = null
    phase.value = 'idle'
    return true
  }

  function close(): void {
    if (phase.value === 'brewing') return
    open.value = false
    outcome.value = null
    phase.value = 'idle'
  }

  function select(id: string): void {
    if (phase.value === 'brewing') return
    recipeId.value = id
    quantity.value = 1
    outcome.value = null
    phase.value = 'idle'
  }

  function setQuantity(value: number): void {
    quantity.value = Math.max(1, Math.min(maxQuantity.value, Math.round(value)))
  }

  function brew(): boolean {
    const current = recipe.value
    const detail = view.value
    if (!current || !detail || phase.value === 'brewing') return false
    if (detail.block.kind !== 'none') return false
    // You brew where you stand: walking away from the bench closes the panel.
    const player = game()?.playerSnapshot()
    const station = currentStation.value
    if (player && station && !isBeside(player, station)) {
      close()
      return false
    }

    session.sync()
    const units = quantity.value
    const timeline = brewTimeline(detail.seconds, units)
    phase.value = 'brewing'
    outcome.value = null
    game()?.setInputLocked(true)
    startProgress(timeline.totalMs)
    overlay.start({
      timeline,
      productId: current.outputs[0]?.itemId ?? 'potion',
      ingredients: current.inputs.length,
      workerSpeciesId: demoWorker(session.state.value, 'alchemy')?.speciesId ?? null,
      onResult: () => {
        const result = session.craft(current.id, units)
        if (!result.ok) {
          outcome.value = { ok: false, reason: result.reason }
          return null
        }
        outcome.value = { ok: true, result: result.result, leveledUp: result.leveledUp, level: demoLevel(result.state, 'alchemy') }
        return { stacks: result.result.produced, xp: result.result.xp, savedInputs: result.result.savedInputs }
      },
      onDone: () => {
        phase.value = outcome.value ? 'result' : 'idle'
        game()?.setInputLocked(false)
        stopProgress()
        quantity.value = Math.min(quantity.value, maxQuantity.value)
      },
    })
    return true
  }

  /**
   * The card shows a bar while it brews. The overlay runs on the engine clock,
   * which the panel cannot read, so the card gets its own wall-clock progress.
   */
  const progress = ref(0)
  let timer: ReturnType<typeof setInterval> | null = null
  function startProgress(totalMs: number): void {
    stopProgress()
    const startedAt = Date.now()
    progress.value = 0
    timer = setInterval(() => {
      progress.value = Math.min(1, (Date.now() - startedAt) / totalMs)
    }, 80)
  }
  function stopProgress(): void {
    if (timer) clearInterval(timer)
    timer = null
    progress.value = 0
  }

  /** The bench the surface is showing; the lab derives it to spawn the player beside it. */
  const currentStation = shallowRef<StationTile | null>(null)
  const setStation = (tile: StationTile | null) => { currentStation.value = tile }

  return {
    open, phase, outcome, overlay, recipes, recipe, view, quantity, maxQuantity, level, progress,
    attach, detach, isStation, inspect, close, select, setQuantity, brew, setStation, currentStation,
  }
}

export type AlchemyController = ReturnType<typeof useAlchemyController>
