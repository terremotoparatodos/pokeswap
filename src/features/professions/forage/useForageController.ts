// Alchemy foraging controller: connects a WildLands game, the local demo
// session and the forage overlay. Used by the field lab and the dev-only
// WildLands demo, so both surfaces behave identically.

import { ref, shallowRef, watch } from 'vue'
import type { WorldObjectTarget } from '../../wildlands/engine/game'
import type { SickleTier } from '../art/foragePalette'
import { demoAffinity, demoTool, demoWorker, inspectDemoNode, type DemoGatherOutcome, type DemoNodeTarget } from '../demo/demoSession'
import type { ProfessionDemoSession } from '../demo/useProfessionDemo'
import { outcomeRarity } from '../mining/miningRarity'
import type { MiningGamePort } from '../mining/useMiningController'
import { isBeside } from '../overworld/workerPresence'
import { resolveNodeStatus } from '../ui/nodeStatus'
import { ForageOverlay } from './forageOverlay'
import { forageTimeline, type ForageStyle } from './forageTimeline'

export interface ForageSelection {
  readonly target: DemoNodeTarget
  readonly tx: number
  readonly ty: number
}

export type ForagePhase = 'idle' | 'gathering' | 'result'

export type ForageGamePort = MiningGamePort

/**
 * The domain decides the gesture, and it is subtler than the node's tier:
 * `bareHands` is false whenever a usable sickle is equipped, because then the
 * domain really does use it and spend its durability — even on a berry bush,
 * which asks for no tool at all. The animation follows the domain.
 */
export const forageStyle = (bareHands: boolean): ForageStyle => (bareHands ? 'hand' : 'sickle')

export function useForageController(session: ProfessionDemoSession, game: () => ForageGamePort | null, detectionOverride: () => number | null = () => null) {
  const selection = shallowRef<ForageSelection | null>(null)
  const phase = ref<ForagePhase>('idle')
  const outcome = shallowRef<DemoGatherOutcome | null>(null)

  const overlay = new ForageOverlay({
    state: () => session.state.value,
    player: () => game()?.playerSnapshot() ?? null,
    detection: () => detectionOverride() ?? demoAffinity(session.state.value, 'alchemy')?.bonuses.detection ?? 0,
    targetId: () => selection.value?.target.nodeId ?? null,
  })

  watch(() => demoWorker(session.state.value, 'alchemy')?.speciesId ?? null, speciesId => {
    if (speciesId !== null) overlay.preloadWorker(speciesId)
  }, { immediate: true })

  const attach = () => game()?.setSceneOverlay(overlay)
  const detach = () => {
    overlay.cancel()
    game()?.setSceneOverlay(null)
    game()?.setInputLocked(false)
  }

  /** Side-effect-free probe for the engine navigator. */
  const isPlant = (hit: WorldObjectTarget) => overlay.targetAt(hit.area, hit.tx, hit.ty) !== null

  function inspect(hit: WorldObjectTarget): boolean {
    const target = overlay.targetAt(hit.area, hit.tx, hit.ty)
    if (!target) return false
    if (phase.value === 'gathering') return true
    selection.value = { target, tx: hit.tx, ty: hit.ty }
    outcome.value = null
    phase.value = 'idle'
    return true
  }

  function close(): void {
    if (phase.value === 'gathering') return
    selection.value = null
    outcome.value = null
    phase.value = 'idle'
  }

  function gather(): boolean {
    const current = selection.value
    if (!current || phase.value === 'gathering') return false
    // You gather what you stand next to: walking away ends the interaction.
    const player = game()?.playerSnapshot()
    if (player && !isBeside(player, current)) {
      close()
      return false
    }
    session.sync()
    const state = session.state.value
    const inspection = inspectDemoNode(state, current.target)
    if (resolveNodeStatus({ ...inspection, phase: 'idle' }) !== 'available' || !inspection.check.ok) return false

    phase.value = 'gathering'
    outcome.value = null
    game()?.setInputLocked(true)
    overlay.start({
      target: current.target, tx: current.tx, ty: current.ty,
      timeline: forageTimeline(inspection.check.preview.actionSeconds, forageStyle(inspection.check.preview.bareHands)),
      tier: (demoTool(state, 'alchemy')?.definition.tier ?? 1) as SickleTier,
      workerSpeciesId: demoWorker(state, 'alchemy')?.speciesId ?? null,
      onResult: () => {
        const result = session.gather(current.target)
        outcome.value = result
        if (!result.ok) return null
        return { stacks: [...result.result.drops, ...result.result.rareDrops], xp: result.result.xp, rarity: outcomeRarity(result.result) }
      },
      onDone: () => {
        phase.value = outcome.value?.ok ? 'result' : 'idle'
        game()?.setInputLocked(false)
      },
    })
    return true
  }

  return { selection, phase, outcome, overlay, attach, detach, isPlant, inspect, close, gather }
}

export type ForageController = ReturnType<typeof useForageController>
