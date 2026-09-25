/**
 * SkillPolicyPort — the WORLD ↔ SKILLS contract (WORLD-1C).
 *
 * WORLD answers "what exists and what is physically happening". SKILLS answers
 * "may this player and this Pokémon do it, how long does it take, and what
 * does it grant". This file is the only place the two meet. WORLD never reads
 * a skill level, an aptitude, a species rule, an XP table or a drop table; it
 * hands SKILLS physical facts and uses the answers it gets back.
 *
 * ```ts
 * interface SkillPolicyPort {
 *   // Before WORLD reserves the node. May be async (a database read).
 *   authorizeWorkAttempt(attempt: WorkAttempt): Promise<Authorization>
 *   // After WORLD has re-validated a finished action. MUST be idempotent on
 *   // `actionId`: WORLD may call it more than once for the same action (a
 *   // retry after a lost reply). Only the first call may grant anything.
 *   settleWork(settlement: WorkSettlement): Promise<SettlementResult>
 *   // Optional. The action ended without completing (moved away, left the
 *   // area, cancelled, or authorized but never reserved). Nothing to grant.
 *   cancelWork?(cancellation: WorkCancellation): Promise<void> | void
 * }
 *
 * interface WorkAttempt {
 *   actionId: string            // minted by WORLD before authorization; unique forever
 *   playerId: string            // authenticated by the transport, never from a payload
 *   pokemon: { instanceId: number; speciesId: number }  // ownership already verified by WORLD
 *   node: { id; resourceKind; variantId; areaId; tx; ty; zone; biome }
 *   workKind: 'chop' | 'mine'   // the physical verb for the node's kind
 *   requestedAt: number         // server clock
 * }
 * type Authorization =
 *   | { ok: true; durationMs: number }   // clamped by WORLD to [MIN, MAX]_ACTION_MS
 *   | { ok: false; reason: string }      // short code shown to the requester, e.g. 'level'
 *
 * interface WorkSettlement {
 *   actionId: string; playerId: string
 *   pokemon: { instanceId: number; speciesId: number }
 *   node: { … as above }; workKind: string
 *   startedAt: number; endsAt: number; completedAt: number
 * }
 * type SettlementResult =
 *   | { ok: true; status: 'applied' | 'duplicate'; summary?: unknown }  // summary goes to the worker only
 *   | { ok: false; retryable: boolean; reason: string }
 *
 * interface WorkCancellation { actionId: string; playerId: string; reason: string }
 * ```
 *
 * What WORLD guarantees in return: one reservation per node at a time, at most
 * one *completion* per action (settle is only ever retried with the same id),
 * no depletion without a successful settlement, and ownership of the Pokémon
 * checked before SKILLS is asked anything.
 */

export const MIN_ACTION_MS = 500
export const MAX_ACTION_MS = 5 * 60_000
const REASON = /^[a-z0-9][a-z0-9-]{0,31}$/

const MESSAGE_LIMIT = 120
const DETAILS_LIMIT = 1024
export const MIN_GROW_MS = 5_000
export const MAX_GROW_MS = 7 * 24 * 60 * 60_000

/** A bounded JSON value, or undefined. What SKILLS tells the requester about its own action. */
function bounded(value, limit) {
  try { return value === undefined || JSON.stringify(value).length > limit ? undefined : value } catch { return undefined }
}

/**
 * Normalizes an authorization answer; anything malformed is a refusal.
 * - `message`: player-facing text ("Requiere Talar 12"), to the requester only.
 * - `details`: SKILLS' terms for the requester's own UI (XP, reward range…).
 * - `plot`: for a plant, the crop and its grow time — SKILLS' rule, WORLD's clock.
 */
export function readAuthorization(answer) {
  if (!answer || typeof answer !== 'object') return { ok: false, reason: 'skills-invalid' }
  const message = typeof answer.message === 'string' ? answer.message.slice(0, MESSAGE_LIMIT) : undefined
  if (answer.ok === true) {
    if (!Number.isFinite(answer.durationMs)) return { ok: false, reason: 'skills-invalid' }
    const plot = answer.plot && typeof answer.plot.cropId === 'string' && /^[a-z]{2,16}$/.test(answer.plot.cropId) && Number.isFinite(answer.plot.growMs)
      ? { cropId: answer.plot.cropId, growMs: Math.round(Math.min(MAX_GROW_MS, Math.max(MIN_GROW_MS, answer.plot.growMs))) }
      : undefined
    return {
      ok: true, durationMs: Math.round(Math.min(MAX_ACTION_MS, Math.max(MIN_ACTION_MS, answer.durationMs))),
      ...(plot ? { plot } : {}),
      ...(bounded(answer.details, DETAILS_LIMIT) === undefined ? {} : { details: answer.details }),
    }
  }
  return {
    ok: false, reason: typeof answer.reason === 'string' && REASON.test(answer.reason) ? answer.reason : 'skills-denied',
    ...(message ? { message } : {}),
  }
}

const SUMMARY_LIMIT = 2048

/** Normalizes a settlement answer. A summary too large to forward is dropped, not truncated. */
export function readSettlement(answer) {
  if (answer?.ok === true && (answer.status === 'applied' || answer.status === 'duplicate')) {
    let summary
    try { summary = answer.summary === undefined || JSON.stringify(answer.summary).length > SUMMARY_LIMIT ? undefined : answer.summary } catch { summary = undefined }
    return { ok: true, status: answer.status, summary }
  }
  return { ok: false, retryable: answer?.retryable === true, reason: typeof answer?.reason === 'string' && REASON.test(answer.reason) ? answer.reason : 'skills-failed' }
}

/**
 * The production default until SKILLS ships its adapter: every attempt is
 * refused, so the world can run shared resources without any fake reward
 * path existing in a production process.
 */
export const unavailableSkillPolicy = Object.freeze({
  async authorizeWorkAttempt() { return { ok: false, reason: 'skills-unavailable' } },
  async settleWork() { return { ok: false, retryable: false, reason: 'skills-unavailable' } },
})
