// The Skills layer inside WildLands: the scene overlays for rocks and trees,
// the local session, and the one interaction the player learns —
//
//   walk up to a node → pick a Pokémon → it works → +XP, +item.
//
// Vue state only; every rule is the Skills service's, every picture is the
// scene's. The local session plays WORLD's physical part until WORLD-1.

import { computed, ref, shallowRef } from 'vue'
import type { Area } from '../../wildlands/engine/area'
import { CompositeOverlay } from '../../wildlands/engine/compositeOverlay'
import type { SceneOverlay } from '../../wildlands/engine/sceneOverlay'
import { createLocalSkillsSession, type LocalBegin, type LocalSkillsSession, type WorkerRef } from '../local/localSkillsSession'
import type { SkillId } from '../domain/skills'
import type { SettleResult } from '../service/skillsService'
import { choppingTimeline } from '../scene/logging/choppingTimeline'
import { LoggingOverlay } from '../scene/logging/loggingOverlay'
import { miningTimeline } from '../scene/mining/miningAction'
import { MiningOverlay, type OverlayPlayer } from '../scene/mining/miningOverlay'
import { rewardRarity } from '../scene/mining/miningRarity'
import type { NodeTarget } from '../scene/nodeTarget'
import { isBeside } from '../scene/overworld/workerPresence'

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

export function useSkillsLayer(game: () => SkillsGamePort | null, session: LocalSkillsSession = createLocalSkillsSession()) {
  /** Bumped on every change the session makes; views read through it. */
  const version = ref(0)
  const touch = () => { version.value++ }

  const selection = shallowRef<WorkSelection | null>(null)
  const phase = ref<WorkPhase>('idle')
  const run = shallowRef<WorkRun | null>(null)
  const result = shallowRef<SettleResult | null>(null)
  const refusal = ref<string | null>(null)
  /** Last Pokémon used per skill, so "Otra vez" is one tap. */
  const lastWorker = ref<Partial<Record<SkillId, string>>>({})

  const deps = {
    nodeState: (target: NodeTarget) => session.nodeState(target),
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
  const nodeState = computed(() => {
    void version.value
    return selection.value ? session.nodeState(selection.value.target) : null
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

  function refuse(begin: Extract<LocalBegin, { allowed: false }>): void {
    refusal.value = begin.message
    touch()
  }

  function work(worker: WorkerRef, workerName: string): boolean {
    const current = selection.value
    const host = game()
    if (!current || phase.value === 'working') return false
    // You work what you stand next to: walking away ends the interaction.
    const player = host?.playerSnapshot()
    if (player && !isBeside(player, current)) {
      close()
      return false
    }
    const begin = session.begin(current.target, worker)
    if (!begin.allowed) {
      refuse(begin)
      return false
    }
    const skill = current.target.resource.skill
    lastWorker.value = { ...lastWorker.value, [skill]: worker.instanceId }
    refusal.value = null
    result.value = null
    phase.value = 'working'
    run.value = { actionId: begin.actionId, workerName, durationMs: begin.durationMs, startedAt: Date.now() }
    host?.setInputLocked(true)

    const onResult = () => {
      const settled = session.complete(begin.actionId)
      result.value = settled
      touch()
      if (settled.status !== 'settled' || settled.settlement.outcome !== 'completed') return null
      const { rewards, xpGained } = settled.settlement
      return { stacks: rewards, xp: xpGained, rarity: rewardRarity(rewards) }
    }
    const onDone = () => {
      phase.value = result.value ? 'result' : 'idle'
      run.value = null
      game()?.setInputLocked(false)
    }
    const start = { target: current.target, tx: current.tx, ty: current.ty, workerSpeciesId: worker.speciesId, onResult, onDone }
    if (skill === 'mining') {
      mining.start({ ...start, timeline: miningTimeline(begin.durationMs) })
    } else {
      // The tree only gives way when this action takes its last charge.
      const felling = session.nodeState(current.target).remainingCharges <= 1
      logging.start({ ...start, timeline: choppingTimeline(begin.durationMs, felling) })
    }
    return true
  }

  function detach(): void {
    mining.cancel()
    logging.cancel()
    if (run.value) session.cancel(run.value.actionId)
    game()?.setSceneOverlay(null)
    game()?.setInputLocked(false)
  }

  const open = computed(() => selection.value !== null)

  return {
    session, version, overlay, selection, phase, run, result, refusal, lastWorker, xp, inventory, nodeState, open,
    isWorldObject, inspect, close, work, detach,
  }
}

export type SkillsLayer = ReturnType<typeof useSkillsLayer>
