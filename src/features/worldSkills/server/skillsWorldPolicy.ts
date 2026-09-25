// The WORLD SkillPolicyPort, implemented with the SKILLS service (INTEGRATION-1).
//
// This file only translates: WORLD's physical facts → a SKILLS WorkTarget,
// SKILLS' answers → WORLD's port shapes, and SKILLS' settlement → one
// database commit that also carries WORLD's new node state. It decides
// nothing: levels, aptitude, duration, XP and rewards are the SKILLS service
// (`createSkillsService`, unchanged); node state and timers are WORLD's.
//
// Bundled for the realtime service by scripts/integration/bundle-skills.mjs
// (services/realtime/src/world/skills/skills.generated.js). Never edit the
// bundle; a test fails when it drifts from this source.
//
// Exactly-once. The SKILLS service's ledger is synchronous; the database is
// the authority. `commitSettlement` only *stages* the settlement; `settleWork`
// then commits it with world_commit_work, whose action_id primary key makes a
// second commit a no-op that returns the first. A failed commit un-stages, so
// a retry recomputes instead of pretending it was paid.

import { SKILLS_RULES_VERSION } from '../../skills/domain/balance'
import { CROP_BY_ID, type CropId, type FarmAction, type PlotKind, type PlotStage } from '../../skills/domain/farming'
import { levelUpLine } from '../../skills/domain/messages'
import { unlocksBetween } from '../../skills/domain/roadmap'
import type { SkillId } from '../../skills/domain/skills'
import type { AuthorizedWork, WorkLedger, WorkSettlement } from '../../skills/service/ports'
import { createSkillsService, type WorkAttemptInput } from '../../skills/service/skillsService'
import { skillsResourceFor } from '../resourceMapping'

// ── What WORLD hands over (services/realtime/src/world/skillPolicy.js) ──────

export interface WorldNode {
  readonly id: string
  readonly resourceKind: string
  readonly variantId: string
  readonly areaId: string
  readonly tx: number
  readonly ty: number
  readonly zone: number
  readonly biome: string
}

export interface WorldFarmFacts {
  readonly action: FarmAction
  readonly plotKind: PlotKind
  readonly stage: PlotStage
  readonly cropId: string | null
  readonly tended: boolean
  /** The crop the player asked to plant (plant only). */
  readonly requestedCropId: string | null
}

export interface WorldAttempt {
  readonly actionId: string
  readonly playerId: string
  readonly pokemon: { readonly instanceId: number; readonly speciesId: number }
  readonly node: WorldNode
  readonly workKind: string
  readonly requestedAt: number
  readonly farm?: WorldFarmFacts | null
}

export interface WorldSettlement {
  readonly actionId: string
  readonly playerId: string
  /** WORLD's new physical state for the node, written in the same transaction. */
  readonly world: unknown
}

export interface PlayerState {
  readonly xp: Readonly<Record<string, number>>
  readonly materials: Readonly<Record<string, number>>
  readonly pokemon: readonly { readonly instanceId: number; readonly speciesId: number }[]
}

export interface CommitResult {
  readonly applied: boolean
  readonly settlement: { readonly xp_after?: number; readonly xp_gained?: number; readonly rewards?: unknown } | null
}

/** The part of PlayerDataAuthority this adapter uses. */
export interface SettlementStore {
  playerState(userId: string): Promise<PlayerState>
  commitWork(commit: {
    actionId: string; userId: string; skillId: SkillId; outcome: 'completed' | 'cancelled'; xpGained: number
    rewards: readonly unknown[]; levelBefore: number; levelAfter: number; rulesVersion: string; node: unknown
  }): Promise<CommitResult>
}

export interface SkillsWorldPolicyOptions {
  readonly store: SettlementStore
  readonly now?: () => number
  readonly random?: () => number
  /** Local/test stacks only: multiplies crop growth (never set in production). */
  readonly growScale?: number
}

const REASON = (value: string) => value.replace(/_/g, '-').slice(0, 32)
const EMPTY_XP: Record<SkillId, number> = { woodcutting: 0, mining: 0, farming: 0 }

/** Server randomness for rewards (AGENTS §11). */
function cryptoRandom(): number {
  const buffer = new Uint32Array(1)
  globalThis.crypto.getRandomValues(buffer)
  return buffer[0] / 4294967296
}

export function createSkillsWorldPolicy(options: SkillsWorldPolicyOptions) {
  const now = options.now ?? (() => Date.now())
  const growScale = options.growScale && options.growScale > 0 ? options.growScale : 1
  const xp = new Map<string, Record<SkillId, number>>()
  const authorizations = new Map<string, AuthorizedWork>()
  const committed = new Map<string, WorkSettlement>()
  const staged = new Map<string, WorkSettlement>()

  const ledger: WorkLedger = {
    authorization: actionId => authorizations.get(actionId) ?? null,
    recordAuthorization: work => {
      if (authorizations.has(work.actionId) || committed.has(work.actionId)) return false
      authorizations.set(work.actionId, work)
      return true
    },
    settlement: actionId => committed.get(actionId) ?? staged.get(actionId) ?? null,
    commitSettlement: settlement => {
      if (committed.has(settlement.actionId) || staged.has(settlement.actionId)) return false
      staged.set(settlement.actionId, settlement)
      return true
    },
  }
  const service = createSkillsService({
    progress: { xpOf: playerId => xp.get(playerId) ?? EMPTY_XP },
    ledger,
    clock: { now },
    random: options.random ?? cryptoRandom,
  })

  async function ensurePlayer(playerId: string): Promise<void> {
    if (xp.has(playerId)) return
    const state = await options.store.playerState(playerId)
    xp.set(playerId, { ...EMPTY_XP, ...state.xp } as Record<SkillId, number>)
  }

  /** Keeps memory bounded: closed actions older than the authorization window are forgotten. */
  function prune(): void {
    const cutoff = now() - 15 * 60_000
    for (const [id, work] of authorizations) if (work.authorizedAt < cutoff) { authorizations.delete(id); committed.delete(id) }
  }

  function targetOf(attempt: WorldAttempt): WorkAttemptInput['target'] | null {
    if (attempt.farm) {
      const farm = attempt.farm
      return {
        kind: 'farm', action: farm.action,
        plot: { plotId: attempt.node.id, kind: farm.plotKind, stage: farm.stage, cropId: (farm.cropId as CropId | null) ?? null, tended: farm.tended },
        cropId: (farm.action === 'plant' ? farm.requestedCropId : farm.cropId) as CropId | null,
      }
    }
    const resource = skillsResourceFor(attempt.node)
    return resource ? { kind: 'gather', resourceId: resource.id } : null
  }

  return {
    /** A session's state was just read at join: keep its XP for authorizations. */
    primePlayer(playerId: string, state: PlayerState): void {
      xp.set(playerId, { ...EMPTY_XP, ...state.xp } as Record<SkillId, number>)
    },

    async authorizeWorkAttempt(attempt: WorldAttempt) {
      prune()
      const target = targetOf(attempt)
      if (!target) return { ok: false, reason: 'not-a-resource', message: 'Esto no se puede trabajar.' }
      await ensurePlayer(attempt.playerId)
      const answer = service.authorizeWorkAttempt({
        actionId: attempt.actionId, playerId: attempt.playerId,
        worker: { instanceId: String(attempt.pokemon.instanceId), speciesId: attempt.pokemon.speciesId }, target,
      })
      if (!answer.allowed) return { ok: false, reason: REASON(answer.reason), message: answer.message }
      const crop = target.kind === 'farm' && target.action === 'plant' && target.cropId ? CROP_BY_ID.get(target.cropId) : undefined
      return {
        ok: true, durationMs: answer.durationMs,
        details: { skillId: answer.skillId, xp: answer.xp, reward: answer.reward, aptitude: answer.aptitude, requiredLevel: answer.requiredLevel, playerLevel: answer.playerLevel },
        ...(crop ? { plot: { cropId: crop.id, growMs: Math.round(crop.growMs * growScale) } } : {}),
      }
    },

    async settleWork(settlement: WorldSettlement) {
      const result = service.settleWork(settlement.actionId, { outcome: 'completed' })
      if (result.status === 'too_early') return { ok: false, retryable: true, reason: 'too-early' }
      if (result.status !== 'settled' && result.status !== 'already_settled') return { ok: false, retryable: false, reason: REASON(result.status) }
      const paid = result.settlement
      if (paid.outcome !== 'completed') {
        // Expired authorization: SKILLS closed it without pay. Nothing to write; WORLD keeps the node.
        committed.set(paid.actionId, paid)
        staged.delete(paid.actionId)
        return { ok: false, retryable: false, reason: 'expired' }
      }
      let stored: CommitResult
      try {
        stored = await options.store.commitWork({
          actionId: paid.actionId, userId: paid.playerId, skillId: paid.skillId, outcome: 'completed', xpGained: paid.xpGained,
          rewards: paid.rewards, levelBefore: paid.levelBefore, levelAfter: paid.levelAfter, rulesVersion: paid.rulesVersion,
          node: settlement.world ?? null,
        })
      } catch {
        staged.delete(paid.actionId)
        return { ok: false, retryable: true, reason: 'store-unavailable' }
      }
      staged.delete(paid.actionId)
      committed.set(paid.actionId, paid)
      const xpAfter = stored.settlement?.xp_after
      const cache = xp.get(paid.playerId)
      if (cache && typeof xpAfter === 'number') cache[paid.skillId] = xpAfter
      if (!stored.applied) {
        // Already committed by an earlier call: report that one, grant nothing.
        xp.delete(paid.playerId)
        return { ok: true, status: 'duplicate', summary: { skillId: paid.skillId, duplicate: true } }
      }
      return {
        ok: true, status: 'applied',
        summary: {
          skillId: paid.skillId, xpGained: paid.xpGained, xpAfter: xpAfter ?? paid.xpAfter, rewards: paid.rewards,
          levelBefore: paid.levelBefore, levelAfter: paid.levelAfter, levelUpLine: levelUpLine(paid.skillId, paid.levelBefore, paid.levelAfter),
          unlocks: unlocksBetween(paid.skillId, paid.levelBefore, paid.levelAfter).map(unlock => ({ skillId: unlock.skillId, level: unlock.level, kind: unlock.kind, id: unlock.id, title: unlock.title, detail: unlock.detail })),
        },
      }
    },

    cancelWork(cancellation: { actionId: string }) {
      // Closes the SKILLS ledger entry without pay; nothing is written anywhere.
      service.settleWork(cancellation.actionId, { outcome: 'cancelled' })
      const closed = staged.get(cancellation.actionId)
      if (closed) { staged.delete(cancellation.actionId); committed.set(cancellation.actionId, closed) }
    },

    rulesVersion: SKILLS_RULES_VERSION,
  }
}

export { skillsResourceFor } from '../resourceMapping'
