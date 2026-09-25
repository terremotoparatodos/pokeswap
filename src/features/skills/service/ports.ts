// What the Skills service needs from the outside, as narrow ports.
//
// The service is plain TypeScript with no Vue, no DOM, no Supabase and no
// network, so the same code runs in the browser for a local session and on a
// server once WORLD-1 wires it in. Each port says what a production adapter
// must guarantee; memoryAdapters.ts is the reference implementation.

import type { SkillId } from '../domain/skills'
import type { RolledReward, WorkTerms } from '../domain/workRules'

/** Player skill XP. Source of truth in production: the database (AGENTS §8). */
export interface SkillProgressStore {
  xpOf(playerId: string): Readonly<Record<SkillId, number>>
}

/** A work attempt Skills approved and has not settled yet. */
export interface AuthorizedWork {
  readonly actionId: string
  readonly playerId: string
  readonly workerInstanceId: string
  readonly workerSpeciesId: number
  readonly terms: WorkTerms
  readonly authorizedAt: number
}

export type SettlementOutcome = 'completed' | 'cancelled'

/** The one record that makes settlement idempotent. */
export interface WorkSettlement {
  readonly actionId: string
  readonly playerId: string
  readonly skillId: SkillId
  readonly outcome: SettlementOutcome
  readonly xpGained: number
  readonly rewards: readonly RolledReward[]
  readonly levelBefore: number
  readonly levelAfter: number
  readonly xpAfter: number
  readonly settledAt: number
  readonly rulesVersion: string
}

/**
 * Authorizations and settlements, keyed by actionId.
 *
 * Production contract: `commitSettlement` is ONE transaction that
 *   1. inserts the settlement row (unique on action_id — a second insert fails),
 *   2. adds `xpGained` to the player's skill XP,
 *   3. grants `rewards` to the player's inventory,
 * and returns `false` without changing anything if a settlement for this
 * actionId already exists. That uniqueness is what makes a duplicate
 * `settleWork` harmless, even when two arrive concurrently.
 */
export interface WorkLedger {
  authorization(actionId: string): AuthorizedWork | null
  /** False if an authorization or a settlement already uses this actionId. */
  recordAuthorization(work: AuthorizedWork): boolean
  settlement(actionId: string): WorkSettlement | null
  commitSettlement(settlement: WorkSettlement): boolean
}

export interface Clock {
  now(): number
}

/** Server-side randomness for anything persistent (AGENTS §11). */
export type RandomSource = () => number

export interface SkillsServicePorts {
  readonly progress: SkillProgressStore
  readonly ledger: WorkLedger
  readonly clock: Clock
  readonly random: RandomSource
}
