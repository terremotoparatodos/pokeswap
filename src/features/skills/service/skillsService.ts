// The Skills service: the API WORLD calls.
//
//   WORLD                                   SKILLS
//   ─────                                   ──────
//   node exists, same area, distance,
//   availability, owns the Pokémon,
//   no concurrent work              ──▶  authorizeWorkAttempt(input)
//                                         level? aptitude? plot transition?
//                                   ◀──  allowed + durationMs + terms   | refused + reason
//   worker animates for durationMs
//   (others see it: WORLD's job)
//   node charge consumed (WORLD)    ──▶  settleWork(actionId, context)
//                                         XP + items, exactly once per actionId
//                                   ◀──  settlement + level-up + unlocks
//
// Skills never changes a node or a plot. WORLD never decides a level or a
// reward. Both calls are safe to repeat: authorizing a used actionId is
// refused; settling a settled one returns the original settlement.

import { AUTHORIZATION_TTL_MS, SETTLE_EARLY_TOLERANCE_MS, SKILLS_RULES_VERSION } from '../domain/balance'
import type { Aptitude } from '../domain/aptitude/aptitudeScale'
import { levelUpLine, refusalMessage } from '../domain/messages'
import { unlocksBetween, type Unlock } from '../domain/roadmap'
import type { SkillId } from '../domain/skills'
import { evaluateWork, rollDrop, type WorkRejection, type WorkTarget } from '../domain/workRules'
import { cappedGain, levelForXp } from '../domain/xpCurve'
import type { AuthorizedWork, SettlementOutcome, SkillsServicePorts, WorkSettlement } from './ports'

export interface WorkAttemptInput {
  /** Minted by WORLD, unique per attempt. The idempotency key of the whole action. */
  readonly actionId: string
  readonly playerId: string
  /** The player's own PokemonInstance, already ownership-checked by WORLD. */
  readonly worker: { readonly instanceId: string; readonly speciesId: number }
  readonly target: WorkTarget
}

export type AuthorizationRefusal = WorkRejection | 'invalid_request' | 'duplicate_action'

export type WorkAuthorization =
  | {
      readonly allowed: true
      readonly actionId: string
      readonly skillId: SkillId
      readonly durationMs: number
      readonly requiredLevel: number
      readonly playerLevel: number
      readonly aptitude: Aptitude
      /** XP on completion. */
      readonly xp: number
      /** Items on completion, as a range; null when the action gives none. */
      readonly reward: { readonly itemId: string; readonly min: number; readonly max: number } | null
      /** Settling as completed after this instant is refused. */
      readonly expiresAt: number
      readonly rulesVersion: string
    }
  | {
      readonly allowed: false
      readonly actionId: string
      readonly reason: AuthorizationRefusal
      /** Player-facing, e.g. "Requiere Minería 20". */
      readonly message: string
      readonly skillId: SkillId | null
      readonly requiredLevel: number | null
      readonly playerLevel: number | null
      readonly minAptitude: Aptitude | null
      readonly aptitude: Aptitude | null
    }

export interface SettleContext {
  readonly outcome: SettlementOutcome
}

export type SettleResult =
  | {
      readonly status: 'settled' | 'already_settled'
      readonly settlement: WorkSettlement
      /** Unlocks reached by this settlement's level change. */
      readonly unlocks: readonly Unlock[]
      /** "Talar 9 → 10", or null. */
      readonly levelUpLine: string | null
    }
  | { readonly status: 'unknown_action' | 'too_early' | 'invalid_request' }

export interface SkillsService {
  authorizeWorkAttempt(input: WorkAttemptInput): WorkAuthorization
  settleWork(actionId: string, context: SettleContext): SettleResult
}

const isNonEmptyId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128

function validInput(input: WorkAttemptInput): boolean {
  return !!input && isNonEmptyId(input.actionId) && isNonEmptyId(input.playerId)
    && !!input.worker && isNonEmptyId(input.worker.instanceId) && Number.isInteger(input.worker.speciesId)
    && !!input.target && typeof input.target === 'object'
}

export function createSkillsService(ports: SkillsServicePorts): SkillsService {
  const { progress, ledger, clock, random } = ports

  function authorizeWorkAttempt(input: WorkAttemptInput): WorkAuthorization {
    const actionId = typeof input?.actionId === 'string' ? input.actionId : ''
    const refuse = (reason: AuthorizationRefusal, extra: Partial<Extract<WorkAuthorization, { allowed: false }>> = {}): WorkAuthorization => ({
      allowed: false, actionId, reason, message: refusalMessage(reason, extra.skillId ?? null, extra.requiredLevel ?? null, extra.minAptitude ?? null),
      skillId: null, requiredLevel: null, playerLevel: null, minAptitude: null, aptitude: null, ...extra,
    })
    if (!validInput(input)) return refuse('invalid_request')
    if (ledger.authorization(actionId) || ledger.settlement(actionId)) return refuse('duplicate_action')

    const evaluation = evaluateWork({ target: input.target, skillXp: progress.xpOf(input.playerId), workerSpeciesId: input.worker.speciesId })
    if (!evaluation.ok) {
      const { reason, skillId, requiredLevel, playerLevel, minAptitude, aptitude } = evaluation
      return refuse(reason, { skillId, requiredLevel, playerLevel, minAptitude, aptitude })
    }

    const now = clock.now()
    const work: AuthorizedWork = {
      actionId, playerId: input.playerId, workerInstanceId: input.worker.instanceId, workerSpeciesId: input.worker.speciesId,
      terms: evaluation.terms, authorizedAt: now,
    }
    if (!ledger.recordAuthorization(work)) return refuse('duplicate_action')
    const { terms } = evaluation
    return {
      allowed: true, actionId, skillId: terms.skillId, durationMs: terms.durationMs,
      requiredLevel: terms.requiredLevel, playerLevel: terms.playerLevel, aptitude: terms.aptitude, xp: terms.xp,
      reward: terms.drop ? { itemId: terms.drop.itemId, min: terms.drop.min + terms.drop.guaranteedBonus, max: terms.drop.max + terms.drop.guaranteedBonus + (terms.drop.bonusChance > 0 ? 1 : 0) } : null,
      expiresAt: now + AUTHORIZATION_TTL_MS, rulesVersion: SKILLS_RULES_VERSION,
    }
  }

  function describe(status: 'settled' | 'already_settled', settlement: WorkSettlement): SettleResult {
    const unlocks = unlocksBetween(settlement.skillId, settlement.levelBefore, settlement.levelAfter)
    return { status, settlement, unlocks, levelUpLine: levelUpLine(settlement.skillId, settlement.levelBefore, settlement.levelAfter) }
  }

  function settleWork(actionId: string, context: SettleContext): SettleResult {
    if (!isNonEmptyId(actionId) || !context || (context.outcome !== 'completed' && context.outcome !== 'cancelled')) {
      return { status: 'invalid_request' }
    }
    const existing = ledger.settlement(actionId)
    if (existing) return describe('already_settled', existing)
    const work = ledger.authorization(actionId)
    if (!work) return { status: 'unknown_action' }

    const now = clock.now()
    const elapsed = now - work.authorizedAt
    const expired = elapsed > AUTHORIZATION_TTL_MS
    if (context.outcome === 'completed' && !expired && elapsed < work.terms.durationMs - SETTLE_EARLY_TOLERANCE_MS) {
      return { status: 'too_early' }
    }

    const { skillId } = work.terms
    const xpBefore = progress.xpOf(work.playerId)[skillId] ?? 0
    const pays = context.outcome === 'completed' && !expired
    const xpGained = pays ? cappedGain(xpBefore, work.terms.xp) : 0
    const rewards = pays && work.terms.drop ? [rollDrop(work.terms.drop, random)] : []
    const xpAfter = xpBefore + xpGained
    const settlement: WorkSettlement = {
      actionId, playerId: work.playerId, skillId, outcome: pays ? 'completed' : 'cancelled',
      xpGained, rewards, levelBefore: levelForXp(xpBefore), levelAfter: levelForXp(xpAfter), xpAfter,
      settledAt: now, rulesVersion: SKILLS_RULES_VERSION,
    }
    if (!ledger.commitSettlement(settlement)) {
      // Lost a race with a concurrent settle of the same action: report theirs.
      const winner = ledger.settlement(actionId)
      return winner ? describe('already_settled', winner) : { status: 'unknown_action' }
    }
    return describe('settled', settlement)
  }

  return { authorizeWorkAttempt, settleWork }
}

