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

export interface WorkRun {
  readonly actionId: string
  readonly workerName: string
  readonly durationMs: number
  readonly startedAt: number
}

export function useSkillsLayer(game: () => SkillsGamePort | null, session: SkillsSession) {
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
    phase.value = 'working'
    refusal.value = null
    result.value = null
    host?.setInputLocked(true)
    const begin = await session.begin(current.target.nodeId, worker)
    if (!begin.allowed) {
      phase.value = 'idle'
      refusal.value = begin.message
      game()?.setInputLocked(false)
      touch()
      return false
    }
    const skill = current.target.resource.skill
    lastWorker.value = { ...lastWorker.value, [skill]: worker.instanceId }
    run.value = { actionId: begin.actionId, workerName, durationMs: begin.durationMs, startedAt: Date.now() }

    // The scene reaches its "result" beat at the end of the work; the server
    // settles right then. Until its answer arrives the scene holds (undefined).
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
      game()?.setInputLocked(false)
    }
    // The Pokémon itself is WORLD's to draw (worker.stand): the scene only animates the node.
    const start = { target: current.target, tx: current.tx, ty: current.ty, onResult, onDone }
    if (skill === 'mining') mining.start({ ...start, timeline: miningTimeline(begin.durationMs) })
    // In the shared world one completed job depletes a node: the tree falls.
    else logging.start({ ...start, timeline: choppingTimeline(begin.durationMs, true) })
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
