// Mining controller: connects a WildLands game, the local demo session and the
// mining overlay. Used by the playground field lab and the dev-only WildLands
// demo, so both surfaces behave identically.

import { ref, shallowRef } from 'vue'
import type { WorldObjectTarget } from '../../wildlands/engine/game'
import type { SceneOverlay } from '../../wildlands/engine/sceneOverlay'
import { demoAffinity, demoTool, inspectDemoNode, type DemoGatherOutcome, type DemoNodeTarget } from '../demo/demoSession'
import type { ProfessionDemoSession } from '../demo/useProfessionDemo'
import type { PickaxeTier } from '../art/miningItems'
import { resolveNodeStatus } from '../ui/nodeStatus'
import { miningTimeline } from './miningAction'
import { MiningOverlay, type OverlayPlayer } from './miningOverlay'
import { outcomeRarity } from './miningRarity'

/** The part of WildlandsGame the controller needs. */
export interface MiningGamePort {
  setSceneOverlay(overlay: SceneOverlay | null): void
  setInputLocked(locked: boolean): void
  playerSnapshot(): OverlayPlayer
}

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

  const attach = () => game()?.setSceneOverlay(overlay)
  const detach = () => {
    overlay.cancel()
    game()?.setSceneOverlay(null)
    game()?.setInputLocked(false)
  }

  /** Side-effect-free probe for the engine navigator. */
  const isNode = (hit: WorldObjectTarget) => overlay.targetAt(hit.area, hit.tx, hit.ty) !== null

  function inspect(hit: WorldObjectTarget): boolean {
    const target = overlay.targetAt(hit.area, hit.tx, hit.ty)
    if (!target) return false
    if (phase.value === 'mining') return true
    selection.value = { target, tx: hit.tx, ty: hit.ty }
    outcome.value = null
    phase.value = 'idle'
    return true
  }

  function close(): void {
    if (phase.value === 'mining') return
    selection.value = null
    outcome.value = null
    phase.value = 'idle'
  }

  function mine(): boolean {
    const current = selection.value
    if (!current || phase.value === 'mining') return false
    session.sync()
    const state = session.state.value
    const inspection = inspectDemoNode(state, current.target)
    if (resolveNodeStatus({ ...inspection, phase: 'idle' }) !== 'available' || !inspection.check.ok) return false
    phase.value = 'mining'
    outcome.value = null
    game()?.setInputLocked(true)
    overlay.start({
      target: current.target, tx: current.tx, ty: current.ty,
      timeline: miningTimeline(inspection.check.preview.actionSeconds),
      tier: (demoTool(state, 'mining')?.definition.tier ?? 1) as PickaxeTier,
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

  return { selection, phase, outcome, overlay, attach, detach, isNode, inspect, close, mine }
}

export type MiningController = ReturnType<typeof useMiningController>
