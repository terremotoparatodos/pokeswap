// Mining controller: connects a WildLands game, the local demo session and the
// mining overlay. Used by the playground field lab and the dev-only WildLands
// demo, so both surfaces behave identically.
//
// R31-Z: selecting, closing and running an action are shared with logging and
// foraging in `overworld/gatheringController.ts`. This facade keeps mining's
// public surface — its refs, `isNode`, `mine` and the `mining` phase.

import { ref, shallowRef, watch } from 'vue'
import type { PickaxeTier } from '../art/miningItems'
import { demoAffinity, demoWorker, type DemoGatherOutcome, type DemoNodeTarget } from '../demo/demoSession'
import type { ProfessionDemoSession } from '../demo/useProfessionDemo'
import { gatheringController, type GatheringGamePort } from '../overworld/gatheringController'
import { miningTimeline, type MiningTimeline } from './miningAction'
import { MiningOverlay } from './miningOverlay'

/** The part of WildlandsGame the controller needs. */
export type MiningGamePort = GatheringGamePort

export interface MiningSelection {
  readonly target: DemoNodeTarget
  readonly tx: number
  readonly ty: number
}

export type MiningPhase = 'idle' | 'mining' | 'result'

export function useMiningController(session: ProfessionDemoSession, game: () => MiningGamePort | null, detectionOverride: () => number | null = () => null) {
  const selection = shallowRef<MiningSelection | null>(null)
  const phase = ref<MiningPhase>('idle')
  const outcome = shallowRef<DemoGatherOutcome | null>(null)

  const overlay = new MiningOverlay({
    state: () => session.state.value,
    player: () => game()?.playerSnapshot() ?? null,
    detection: () => detectionOverride() ?? demoAffinity(session.state.value, 'mining')?.bonuses.detection ?? 0,
    targetId: () => selection.value?.target.nodeId ?? null,
  })

  // Warm the worker's overworld sheet whenever the assigned Pokémon changes.
  watch(() => demoWorker(session.state.value, 'mining')?.speciesId ?? null, speciesId => {
    if (speciesId !== null) overlay.preloadWorker(speciesId)
  }, { immediate: true })

  const core = gatheringController<'mining', MiningTimeline, PickaxeTier>({
    session, game, profession: 'mining', overlay, selection, phase, outcome, busyPhase: 'mining',
    timeline: preview => miningTimeline(preview.actionSeconds),
  })

  return {
    selection, phase, outcome, overlay,
    attach: core.attach, detach: core.detach, isNode: core.isTarget, inspect: core.inspect, close: core.close, mine: core.act,
  }
}

export type MiningController = ReturnType<typeof useMiningController>
