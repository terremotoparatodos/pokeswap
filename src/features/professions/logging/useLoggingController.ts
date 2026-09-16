// Logging controller: connects a WildLands game, the local demo session and
// the logging overlay. Used by the playground field lab and the dev-only
// WildLands demo, so both surfaces behave identically.

import { ref, shallowRef, watch } from 'vue'
import type { WorldObjectTarget } from '../../wildlands/engine/game'
import type { AxeTier } from '../art/loggingPalette'
import { demoAffinity, demoTool, demoWorker, inspectDemoNode, type DemoGatherOutcome, type DemoNodeTarget } from '../demo/demoSession'
import type { ProfessionDemoSession } from '../demo/useProfessionDemo'
import { outcomeRarity } from '../mining/miningRarity'
import type { MiningGamePort } from '../mining/useMiningController'
import { isBeside } from '../overworld/workerPresence'
import { resolveNodeStatus } from '../ui/nodeStatus'
import { choppingTimeline } from './choppingTimeline'
import { LoggingOverlay } from './loggingOverlay'

export interface LoggingSelection {
  readonly target: DemoNodeTarget
  readonly tx: number
  readonly ty: number
}

export type LoggingPhase = 'idle' | 'chopping' | 'result'

/** Same engine surface the other professions need. */
export type LoggingGamePort = MiningGamePort

export function useLoggingController(session: ProfessionDemoSession, game: () => LoggingGamePort | null, detectionOverride: () => number | null = () => null) {
  const selection = shallowRef<LoggingSelection | null>(null)
  const phase = ref<LoggingPhase>('idle')
  const outcome = shallowRef<DemoGatherOutcome | null>(null)

  const overlay = new LoggingOverlay({
    state: () => session.state.value,
    player: () => game()?.playerSnapshot() ?? null,
    detection: () => detectionOverride() ?? demoAffinity(session.state.value, 'woodcutting')?.bonuses.detection ?? 0,
    targetId: () => selection.value?.target.nodeId ?? null,
  })

  watch(() => demoWorker(session.state.value, 'woodcutting')?.speciesId ?? null, speciesId => {
    if (speciesId !== null) overlay.preloadWorker(speciesId)
  }, { immediate: true })

  const attach = () => game()?.setSceneOverlay(overlay)
  const detach = () => {
    overlay.cancel()
    game()?.setSceneOverlay(null)
    game()?.setInputLocked(false)
  }

  /** Side-effect-free probe for the engine navigator. */
  const isTree = (hit: WorldObjectTarget) => overlay.targetAt(hit.area, hit.tx, hit.ty) !== null

  function inspect(hit: WorldObjectTarget): boolean {
    const target = overlay.targetAt(hit.area, hit.tx, hit.ty)
    if (!target) return false
    if (phase.value === 'chopping') return true
    selection.value = { target, tx: hit.tx, ty: hit.ty }
    outcome.value = null
    phase.value = 'idle'
    return true
  }

  function close(): void {
    if (phase.value === 'chopping') return
    selection.value = null
    outcome.value = null
    phase.value = 'idle'
  }

  function chop(): boolean {
    const current = selection.value
    if (!current || phase.value === 'chopping') return false
    // You fell what you stand next to: walking away ends the interaction.
    const player = game()?.playerSnapshot()
    if (player && !isBeside(player, current)) {
      close()
      return false
    }
    session.sync()
    const state = session.state.value
    const inspection = inspectDemoNode(state, current.target)
    if (resolveNodeStatus({ ...inspection, phase: 'idle' }) !== 'available' || !inspection.check.ok) return false

    phase.value = 'chopping'
    outcome.value = null
    game()?.setInputLocked(true)
    overlay.start({
      target: current.target, tx: current.tx, ty: current.ty,
      // The tree only gives way when this action takes its last charge.
      timeline: choppingTimeline(inspection.check.preview.actionSeconds, inspection.remainingCharges <= 1),
      tier: (demoTool(state, 'woodcutting')?.definition.tier ?? 1) as AxeTier,
      workerSpeciesId: demoWorker(state, 'woodcutting')?.speciesId ?? null,
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

  return { selection, phase, outcome, overlay, attach, detach, isTree, inspect, close, chop }
}

export type LoggingController = ReturnType<typeof useLoggingController>
