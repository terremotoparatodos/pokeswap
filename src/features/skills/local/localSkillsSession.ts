// The playtest's local Skills session: the real Skills service with in-memory
// adapters, plus a PRE-WORLD stand-in doing WORLD's physical part (is the
// node depleted? consume its charge; mint the actionId).
//
// Non-persistent by design, like the rest of the playtest: a refresh resets
// it, and nothing here can reach a real account. When WORLD-1 lands, the
// physical part moves to the server and this file shrinks to a client that
// sends intents and renders results (see docs/skills/SKILLS_1_REPORT.md §21).

import type { Clock } from '../service/ports'
import { createMemorySkillsStore } from '../service/memoryAdapters'
import { createSkillsService, type SettleResult, type WorkAuthorization } from '../service/skillsService'
import { createSeededRandom } from '../domain/rng'
import type { SkillId } from '../domain/skills'
import { levelForXp } from '../domain/xpCurve'
import type { NodeState, NodeTarget } from '../scene/nodeTarget'
import { consumeCharge, remainingCharges, respawnInSeconds, type ChargeLedger } from '../localWorld/nodeCharges'

/** The PokemonInstance doing the work: the player's own, never a separate "work Pokémon". */
export interface WorkerRef {
  readonly instanceId: string
  readonly speciesId: number
}

export type LocalBegin =
  | WorkAuthorization
  | { readonly allowed: false; readonly actionId: string; readonly reason: 'depleted' | 'busy'; readonly message: string }

export interface LocalSkillsSession {
  readonly playerId: string
  xp(): Readonly<Record<SkillId, number>>
  inventory(): Readonly<Record<string, number>>
  nodeState(target: NodeTarget): NodeState
  /** WORLD's checks, then Skills' authorization. */
  begin(target: NodeTarget, worker: WorkerRef): LocalBegin
  /** WORLD consumes the node's charge, then Skills settles. */
  complete(actionId: string): SettleResult
  cancel(actionId: string): SettleResult
  /** Test/dev only. */
  seedXp(skillId: SkillId, xp: number): void
}

export interface LocalSessionOptions {
  readonly playerId?: string
  readonly clock?: Clock
  readonly seed?: number
}

export function createLocalSkillsSession(options: LocalSessionOptions = {}): LocalSkillsSession {
  const playerId = options.playerId ?? 'playtest-player'
  const clock = options.clock ?? { now: () => Date.now() }
  const store = createMemorySkillsStore()
  // Client RNG is fine here only because nothing persists (AGENTS §11).
  const service = createSkillsService({ progress: store.progress, ledger: store.ledger, clock, random: createSeededRandom(options.seed ?? 0x5c11) })
  let charges: ChargeLedger = new Map()
  let counter = 0
  /** actionId → node being worked. One action at a time per player (WORLD's concurrency rule). */
  const running = new Map<string, NodeTarget>()

  function nodeState(target: NodeTarget): NodeState {
    const now = clock.now()
    const remaining = remainingCharges(charges, target.nodeId, target.resource, now)
    const level = levelForXp(store.progress.xpOf(playerId)[target.resource.skill])
    const status = remaining <= 0 ? 'depleted' : level < target.resource.requiredLevel ? 'locked_level' : 'available'
    return { status, remainingCharges: remaining, respawnInSeconds: respawnInSeconds(charges, target.nodeId, target.resource, now) }
  }

  function begin(target: NodeTarget, worker: WorkerRef): LocalBegin {
    const actionId = `${playerId}:${clock.now()}:${++counter}`
    if (running.size > 0) return { allowed: false, actionId, reason: 'busy', message: 'Tu Pokémon ya está trabajando.' }
    if (remainingCharges(charges, target.nodeId, target.resource, clock.now()) <= 0) {
      return { allowed: false, actionId, reason: 'depleted', message: 'Agotado. Vuelve en un rato.' }
    }
    const authorization = service.authorizeWorkAttempt({
      actionId, playerId, worker, target: { kind: 'gather', resourceId: target.resource.id },
    })
    if (authorization.allowed) running.set(actionId, target)
    return authorization
  }

  function complete(actionId: string): SettleResult {
    const target = running.get(actionId)
    const result = service.settleWork(actionId, { outcome: 'completed' })
    // Too early: nothing happened, the caller may retry. Anything else closes the action.
    if (result.status === 'too_early' || !target) return result
    running.delete(actionId)
    if (result.status === 'settled' && result.settlement.outcome === 'completed') {
      charges = consumeCharge(charges, target.nodeId, target.resource, clock.now()) ?? charges
    }
    return result
  }

  function cancel(actionId: string): SettleResult {
    running.delete(actionId)
    return service.settleWork(actionId, { outcome: 'cancelled' })
  }

  return {
    playerId,
    xp: () => store.progress.xpOf(playerId),
    inventory: () => store.inventoryOf(playerId),
    nodeState, begin, complete, cancel,
    seedXp: (skillId, xp) => store.setXp(playerId, skillId, xp),
  }
}
