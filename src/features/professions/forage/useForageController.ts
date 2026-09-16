// Alchemy foraging controller: connects a WildLands game, the local demo
// session and the forage overlay. Used by the field lab and the dev-only
// WildLands demo, so both surfaces behave identically.
//
// R31-Z: selecting, closing and running an action are shared with mining and
// logging in `overworld/gatheringController.ts`. This facade keeps foraging's
// public surface — its refs, `isPlant`, `gather`, the `gathering` phase and
// `forageStyle` — and its one rule of its own: the domain decides hand or
// sickle.

import { ref, shallowRef, watch } from 'vue'
import type { SickleTier } from '../art/foragePalette'
import { demoAffinity, demoWorker, type DemoGatherOutcome, type DemoNodeTarget } from '../demo/demoSession'
import type { ProfessionDemoSession } from '../demo/useProfessionDemo'
import type { MiningGamePort } from '../mining/useMiningController'
import { gatheringController } from '../overworld/gatheringController'
import { ForageOverlay } from './forageOverlay'
import { forageTimeline, type ForageStyle, type ForageTimeline } from './forageTimeline'

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

  const core = gatheringController<'gathering', ForageTimeline, SickleTier>({
    session, game, profession: 'alchemy', overlay, selection, phase, outcome, busyPhase: 'gathering',
    timeline: preview => forageTimeline(preview.actionSeconds, forageStyle(preview.bareHands)),
  })

  return {
    selection, phase, outcome, overlay,
    attach: core.attach, detach: core.detach, isPlant: core.isTarget, inspect: core.inspect, close: core.close, gather: core.act,
  }
}

export type ForageController = ReturnType<typeof useForageController>
