// The Skills layer inside WildLands: the scene overlays for rocks and trees,
// and the one interaction the player learns —
//
//   walk up to a node → pick a Pokémon → it works → +XP, +item.
//
// Vue state only; every rule and every result is the server's (INTEGRATION-1:
// WORLD owns the node, SKILLS decides and pays, the database remembers), every
// picture is the scene's. The session is the shared-world one.

import { computed, ref, shallowRef } from 'vue'
import type { Area } from '../../wildlands/engine/area'
import { CompositeOverlay } from '../../wildlands/engine/compositeOverlay'
import type { SceneOverlay } from '../../wildlands/engine/sceneOverlay'
import type { SkillId } from '../domain/skills'
import type { SettleResult } from '../service/skillsService'
import { choppingTimeline } from '../scene/logging/choppingTimeline'
import type { GatheringOutcome, GatheringReward } from '../scene/overworld/gatheringOverlayCore'
import { LoggingOverlay } from '../scene/logging/loggingOverlay'
import { miningTimeline } from '../scene/mining/miningAction'
import { MiningOverlay, type OverlayPlayer } from '../scene/mining/miningOverlay'
import { rewardRarity } from '../scene/mining/miningRarity'
import type { NodeTarget } from '../scene/nodeTarget'
import { isBeside } from '../scene/overworld/workerPresence'
import type { SkillsSession } from './skillsSession'
import type { WorkerRef } from './workerRef'

/** The part of WildlandsGame the layer needs. */
export interface SkillsGamePort {
  setSceneOverlay(overlay: SceneOverlay | null): void
  setInputLocked(locked: boolean): void
  playerSnapshot(): OverlayPlayer
}

export interface WorldHit {
  readonly area: Area
  readonly tx: number
  readonly ty: number
}

export interface WorkSelection {
  readonly target: NodeTarget
  readonly tx: number
  readonly ty: number
}

export type WorkPhase = 'idle' | 'working' | 'result'

/**
 * The running action as this client knows it (SKILLS PROB-2): who works and
 * when it started on the server clock. How long it lasts is the server's
 * secret; the result ends it.
 */
export interface WorkRun {
  readonly actionId: string
  readonly workerName: string
  /** Server clock. */
  readonly startedAt: number
}

/** `serverNow`: the shared world's clock, to put the owner's blows on the worker's beat. */
export function useSkillsLayer(game: () => SkillsGamePort | null, session: SkillsSession, serverNow: () => number | null = () => null) {
  /** Bumped on every change the session reports; views read through it. */
  const version = ref(0)
  const touch = () => { version.value++ }
  const unsubscribe = session.subscribe(touch)

  const selection = shallowRef<WorkSelection | null>(null)
  const phase = ref<WorkPhase>('idle')
  const run = shallowRef<WorkRun | null>(null)
  const result = shallowRef<SettleResult | null>(null)
  const refusal = ref<string | null>(null)
  /** Last Pokémon used per skill, so "Otra vez" is one tap. */
  const lastWorker = ref<Partial<Record<SkillId, string>>>({})

  const deps = {
    nodeState: (target: NodeTarget) => session.nodeState(target.nodeId, target.resource),
    player: () => game()?.playerSnapshot() ?? null,
    targetId: () => selection.value?.target.nodeId ?? null,
  }
  const mining = new MiningOverlay(deps)
  const logging = new LoggingOverlay(deps)
  const overlay = new CompositeOverlay(mining, logging)

  const targetAt = (hit: WorldHit): NodeTarget | null =>
    mining.targetAt(hit.area, hit.tx, hit.ty) ?? logging.targetAt(hit.area, hit.tx, hit.ty)

  const xp = computed(() => { void version.value; return session.xp() })
  const inventory = computed(() => { void version.value; return session.inventory() })
  const workers = computed(() => { void version.value; return session.workers() })
  const nodeState = computed(() => {
    void version.value
    return selection.value ? session.nodeState(selection.value.target.nodeId, selection.value.target.resource) : null
  })

  function isWorldObject(hit: WorldHit): boolean {
    return targetAt(hit) !== null
  }

  function inspect(hit: WorldHit): boolean {
    const target = targetAt(hit)
    if (!target) return false
    if (phase.value === 'working') return true
    selection.value = { target, tx: hit.tx, ty: hit.ty }
    phase.value = 'idle'
    result.value = null
    refusal.value = null
    touch()
    return true
  }

  function close(): void {
    if (phase.value === 'working') return
    selection.value = null
    phase.value = 'idle'
    result.value = null
    refusal.value = null
  }

  async function work(worker: WorkerRef, workerName: string): Promise<boolean> {
    const current = selection.value
    const host = game()
    if (!current || phase.value === 'working') return false
    // You work what you stand next to: walking away ends the interaction.
    const player = host?.playerSnapshot()
    if (player && !isBeside(player, current)) {
      close()
      return false
    }
    // WORK CANCEL-1: input is never locked while the Pokémon works. Walking is
    // how a player stops: the move reaches the server, which cancels the action
    // (`moved`) and answers; the scene then ends at once (outcome 'failed').
    phase.value = 'working'
    refusal.value = null
    result.value = null
    const begin = await session.begin(current.target.nodeId, worker)
    if (!begin.allowed) {
      phase.value = 'idle'
      refusal.value = begin.message
      touch()
      return false
    }
    const skill = current.target.resource.skill
    lastWorker.value = { ...lastWorker.value, [skill]: worker.instanceId }
    run.value = { actionId: begin.actionId, workerName, startedAt: begin.startedAt }

    // The scene swings once per work tick for as long as the server has not
    // ended the sequence (it alone knows when). Each confirmed unit pops its +1
    // and the work goes on (YIELD-2); only the end closes the timeline: a
    // depleted node plays its ending (the tree falls), anything else — walked
    // away, cancelled, disconnected, an error — ends the scene at once.
    const outcome = (): GatheringOutcome => {
      const settled = session.result(begin.actionId)
      if (settled === undefined) return 'pending'
      const paid = !!settled && (settled.status === 'settled' || settled.status === 'already_settled') && settled.settlement.outcome === 'completed'
      return paid && session.endReason(begin.actionId) === 'depleted' ? 'success' : 'failed'
    }
    let unitRewards: GatheringReward[] = []
    const units = (): readonly GatheringReward[] => {
      const confirmed = session.units(begin.actionId)
      if (confirmed.length === unitRewards.length) return unitRewards
      unitRewards = confirmed.map(unit => {
        const rewards = 'settlement' in unit ? unit.settlement.rewards : []
        return { stacks: rewards, xp: 'settlement' in unit ? unit.settlement.xpGained : 0, rarity: rewardRarity(rewards) }
      })
      return unitRewards
    }
    const onResult = () => {
      const settled = session.result(begin.actionId)
      if (settled === undefined) return undefined
      result.value = settled
      touch()
      if (!settled || (settled.status !== 'settled' && settled.status !== 'already_settled') || settled.settlement.outcome !== 'completed') return null
      const { rewards, xpGained } = settled.settlement
      return { stacks: rewards, xp: xpGained, rarity: rewardRarity(rewards) }
    }
    const onDone = () => {
      phase.value = result.value ? 'result' : 'idle'
      run.value = null
      // Walked away (the usual reason an action ends without a result): the card goes too.
      const player = game()?.playerSnapshot()
      if (!result.value && player && !isBeside(player, current)) close()
    }
    // The Pokémon itself is WORLD's to draw (worker.stand): the scene only animates the node.
    const now = serverNow()
    const elapsedMs = now === null ? 0 : Math.max(0, now - begin.startedAt)
    const start = { target: current.target, tx: current.tx, ty: current.ty, onResult, onDone, outcome, units, elapsedMs }
    if (skill === 'mining') mining.start({ ...start, timeline: miningTimeline() })
    // In the shared world the last unit depletes the node: the tree falls then.
    else logging.start({ ...start, timeline: choppingTimeline() })
    return true
  }

  function detach(): void {
    mining.cancel()
    logging.cancel()
    if (run.value) session.cancel(run.value.actionId)
    game()?.setSceneOverlay(null)
    game()?.setInputLocked(false)
    unsubscribe()
  }

  const open = computed(() => selection.value !== null)

  return {
    session, version, overlay, selection, phase, run, result, refusal, lastWorker, xp, inventory, workers, nodeState, open,
    isWorldObject, inspect, close, work, detach,
  }
}

export type SkillsLayer = ReturnType<typeof useSkillsLayer>
