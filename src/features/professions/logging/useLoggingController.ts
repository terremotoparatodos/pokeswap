// Logging controller: connects a WildLands game, the local demo session and
// the logging overlay. Used by the playground field lab and the dev-only
// WildLands demo, so both surfaces behave identically.
//
// R31-Z: selecting, closing and running an action are shared with mining and
// foraging in `overworld/gatheringController.ts`. This facade keeps logging's
// public surface — its refs, `isTree`, `chop` and the `chopping` phase — and
// its one rule of its own: the tree falls on the action that takes its last
// charge.

import { ref, shallowRef, watch } from 'vue'
import type { AxeTier } from '../art/loggingPalette'
import { demoAffinity, demoWorker, type DemoGatherOutcome, type DemoNodeTarget } from '../demo/demoSession'
import type { ProfessionDemoSession } from '../demo/useProfessionDemo'
import type { MiningGamePort } from '../mining/useMiningController'
import { gatheringController } from '../overworld/gatheringController'
import { choppingTimeline, type ChoppingTimeline } from './choppingTimeline'
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

  const core = gatheringController<'chopping', ChoppingTimeline, AxeTier>({
    session, game, profession: 'woodcutting', overlay, selection, phase, outcome, busyPhase: 'chopping',
    // The tree only gives way when this action takes its last charge.
    timeline: (preview, inspection) => choppingTimeline(preview.actionSeconds, inspection.remainingCharges <= 1),
  })

  return {
    selection, phase, outcome, overlay,
    attach: core.attach, detach: core.detach, isTree: core.isTarget, inspect: core.inspect, close: core.close, chop: core.act,
  }
}

export type LoggingController = ReturnType<typeof useLoggingController>
