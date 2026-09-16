// Gathering controller core (R31-Z): the part of the mining, logging and
// foraging controllers that was the same in all three — select a node, close
// it, and run one action: stand beside the node, re-check it against the demo
// session, lock input, hand the overlay a timeline and apply the result when
// the overlay reaches it.
//
// The public controllers (`useMiningController`, `useLoggingController`,
// `useForageController`) stay the entry points: they own their Vue refs and
// their overlay, and expose this under their own names (`mine`, `chop`,
// `gather`…). This module takes those refs structurally so it stays free of
// Vue, and it knows nothing about how a profession looks.
//
// Fishing and alchemy do not use it: casting and brewing have their own flow.

import type { Area } from '../../wildlands/engine/area'
import type { SceneOverlay } from '../../wildlands/engine/sceneOverlay'
import { demoTool, demoWorker, inspectDemoNode, type DemoGatherOutcome, type DemoNodeTarget, type NodeInspection } from '../demo/demoSession'
import type { ProfessionDemoSession } from '../demo/useProfessionDemo'
import type { GatheringPreview } from '../domain/gathering'
import type { ProfessionId } from '../domain/types'
import type { OverlayPlayer } from '../mining/miningOverlay'
import { outcomeRarity } from '../mining/miningRarity'
import { resolveNodeStatus } from '../ui/nodeStatus'
import type { GatheringReward } from './gatheringOverlayCore'
import { isBeside } from './workerPresence'

/** A mutable box: a Vue ref satisfies it, and so does a plain object in tests. */
export interface ValueBox<T> {
  value: T
}

/** The part of WildlandsGame a profession controller needs. */
export interface GatheringGamePort {
  setSceneOverlay(overlay: SceneOverlay | null): void
  setInputLocked(locked: boolean): void
  playerSnapshot(): OverlayPlayer
}

/** A tile the engine asks about: the same shape as the engine's WorldObjectTarget. */
export interface GatheringHit {
  readonly area: Area
  readonly tx: number
  readonly ty: number
}

export interface GatheringSelection {
  readonly target: DemoNodeTarget
  readonly tx: number
  readonly ty: number
}

/** What the core hands the overlay to start an action. */
export interface GatheringStart<Timeline, Tier> {
  readonly target: DemoNodeTarget
  readonly tx: number
  readonly ty: number
  readonly timeline: Timeline
  readonly tier: Tier
  readonly workerSpeciesId: number | null
  readonly onResult: () => GatheringReward | null
  readonly onDone: () => void
}

export interface GatheringOverlayPort<Timeline, Tier> extends SceneOverlay {
  targetAt(area: Area, tx: number, ty: number): DemoNodeTarget | null
  start(options: GatheringStart<Timeline, Tier>): void
  cancel(): void
}

export interface GatheringControllerOptions<Busy extends string, Timeline, Tier> {
  readonly session: ProfessionDemoSession
  readonly game: () => GatheringGamePort | null
  /** Whose level, tool and worker the action uses. */
  readonly profession: ProfessionId
  readonly overlay: GatheringOverlayPort<Timeline, Tier>
  readonly selection: ValueBox<GatheringSelection | null>
  readonly phase: ValueBox<'idle' | Busy | 'result'>
  readonly outcome: ValueBox<DemoGatherOutcome | null>
  /** The controller's name for "an action is running" (`mining`, `chopping`, `gathering`). */
  readonly busyPhase: Busy
  /** The profession's timeline for this action, from the node check the core just made. */
  timeline(preview: GatheringPreview, inspection: NodeInspection): Timeline
}

export function gatheringController<Busy extends string, Timeline, Tier>(options: GatheringControllerOptions<Busy, Timeline, Tier>) {
  const { session, game, profession, overlay, selection, phase, outcome, busyPhase } = options

  const attach = () => game()?.setSceneOverlay(overlay)
  const detach = () => {
    overlay.cancel()
    game()?.setSceneOverlay(null)
    game()?.setInputLocked(false)
  }

  /** Side-effect-free probe for the engine navigator. */
  const isTarget = (hit: GatheringHit) => overlay.targetAt(hit.area, hit.tx, hit.ty) !== null

  function inspect(hit: GatheringHit): boolean {
    const target = overlay.targetAt(hit.area, hit.tx, hit.ty)
    if (!target) return false
    if (phase.value === busyPhase) return true
    selection.value = { target, tx: hit.tx, ty: hit.ty }
    outcome.value = null
    phase.value = 'idle'
    return true
  }

  function close(): void {
    if (phase.value === busyPhase) return
    selection.value = null
    outcome.value = null
    phase.value = 'idle'
  }

  function act(): boolean {
    const current = selection.value
    if (!current || phase.value === busyPhase) return false
    // You work what you stand next to: walking away ends the interaction.
    const player = game()?.playerSnapshot()
    if (player && !isBeside(player, current)) {
      close()
      return false
    }
    session.sync()
    const state = session.state.value
    const inspection = inspectDemoNode(state, current.target)
    if (resolveNodeStatus({ ...inspection, phase: 'idle' }) !== 'available' || !inspection.check.ok) return false

    phase.value = busyPhase
    outcome.value = null
    game()?.setInputLocked(true)
    overlay.start({
      target: current.target, tx: current.tx, ty: current.ty,
      timeline: options.timeline(inspection.check.preview, inspection),
      tier: (demoTool(state, profession)?.definition.tier ?? 1) as Tier,
      workerSpeciesId: demoWorker(state, profession)?.speciesId ?? null,
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

  return { attach, detach, isTarget, inspect, close, act }
}
