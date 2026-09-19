// The only ways a rule may change a battle (R32.3).
//
// Every rule in R32.3 goes through this file to touch the state. That is not
// ceremony: it is where the invariants are enforced once instead of at every
// call site. HP never leaves `0…maxHp`, PP never leaves `0…maxPP`, a faint is
// announced exactly once, and a Pokémon can never carry two major statuses —
// because there is one place that could break any of those and it does not.
//
// A `Working` is a state and the events produced so far. Nothing here mutates
// a `BattleState`: each helper reassigns `working.state` to a new one. The
// `Working` itself is a local of one `reduceBattle` call and never escapes, so
// the engine stays pure from the outside while staying readable inside.

import { maxPPOf, remainingPP } from '../../pokemon/model'
import type { MajorStatus } from '../../pokemon/model'
import { isExecutable } from './moveSupport'
import type { BattleRulesCatalog } from './catalogView'
import type { BattleEvent } from './events'
import { applyStage } from './stats'
import type { BattleCombatant, BattleState, StageKey } from './state'
import {
  combatantOf, currentHpOf, isCombatantFainted, withCombatant, withConditionPatch, withRuntime,
} from './state'

/** A `BattleEvent` without the two fields the emitter fills in. */
export type EventPayload = BattleEvent extends infer T
  ? T extends BattleEvent ? Omit<T, 'seq' | 'atMs'> : never
  : never

export interface Working {
  state: BattleState
  readonly events: BattleEvent[]
  readonly catalog: BattleRulesCatalog
  /** Combatants that have already announced their faint, so it is announced once. */
  readonly fainted: Set<string>
}

export function emit(working: Working, payload: EventPayload): void {
  const event = { ...payload, seq: working.state.eventSeq, atMs: working.state.timeMs } as BattleEvent
  working.events.push(event)
  working.state = { ...working.state, eventSeq: working.state.eventSeq + 1 }
}

export const requireCombatant = (working: Working, id: string): BattleCombatant | null =>
  combatantOf(working.state, id)

export function update(working: Working, combatant: BattleCombatant): void {
  working.state = withCombatant(working.state, combatant)
}

// ── HP ──────────────────────────────────────────────────────────────────────

/**
 * Takes HP off a combatant and announces it.
 *
 * `amount` is clamped to what is actually left, so the event reports the
 * damage that happened rather than the damage that was asked for — a hit for
 * 400 on a Pokémon with 12 HP is a hit for 12.
 */
export function applyDamage(
  working: Working,
  targetId: string,
  amount: number,
  cause: 'move' | 'recoil' | 'confusion' | 'status',
  options: {
    readonly sourceId?: string | null
    readonly critical?: boolean
    readonly effectiveness?: number
    readonly hit?: number
    readonly status?: MajorStatus
  } = {},
): number {
  const target = requireCombatant(working, targetId)
  if (!target) return 0
  const before = currentHpOf(target)
  const dealt = Math.max(0, Math.min(before, Math.floor(amount)))
  const after = before - dealt
  update(working, withConditionPatch(target, { currentHp: after }))

  if (cause === 'status' && options.status) {
    emit(working, {
      type: 'STATUS_TICK', combatantId: targetId, status: options.status, damage: dealt, remainingHp: after,
    })
  } else if (cause === 'confusion') {
    emit(working, { type: 'CONFUSION_SELF_HIT', combatantId: targetId, damage: dealt })
    emit(working, {
      type: 'DAMAGE', combatantId: targetId, sourceId: targetId, amount: dealt, remainingHp: after,
      critical: false, effectiveness: 1, hit: 1, cause: 'confusion',
    })
  } else {
    emit(working, {
      type: 'DAMAGE',
      combatantId: targetId,
      sourceId: options.sourceId ?? null,
      amount: dealt,
      remainingHp: after,
      critical: options.critical ?? false,
      effectiveness: options.effectiveness ?? 1,
      hit: options.hit ?? 1,
      cause,
    })
  }
  announceFaint(working, targetId)
  return dealt
}

/** Heals, clamped to max HP. A fainted Pokémon is not healed by this: use a revive. */
export function applyHeal(
  working: Working, targetId: string, amount: number, cause: 'move' | 'drain' | 'item',
): number {
  const target = requireCombatant(working, targetId)
  if (!target || isCombatantFainted(target)) return 0
  const before = currentHpOf(target)
  const healed = Math.max(0, Math.min(target.stats.hp - before, Math.floor(amount)))
  if (healed === 0) return 0
  const after = before + healed
  update(working, withConditionPatch(target, { currentHp: after === target.stats.hp ? null : after }))
  emit(working, { type: 'HEAL', combatantId: targetId, amount: healed, remainingHp: after, cause })
  return healed
}

/** Brings a fainted Pokémon back with a fraction of its max HP. */
export function applyRevive(working: Working, targetId: string, hpFraction: number): boolean {
  const target = requireCombatant(working, targetId)
  if (!target || !isCombatantFainted(target)) return false
  const hp = Math.max(1, Math.min(target.stats.hp, Math.floor(target.stats.hp * hpFraction)))
  update(working, withConditionPatch(target, { currentHp: hp }))
  working.fainted.delete(targetId)
  emit(working, { type: 'HEAL', combatantId: targetId, amount: hp, remainingHp: hp, cause: 'item' })
  return true
}

/** Announces a faint once, and clears the runtime a fainted Pokémon must not keep. */
export function announceFaint(working: Working, combatantId: string): void {
  const combatant = requireCombatant(working, combatantId)
  if (!combatant || !isCombatantFainted(combatant) || working.fainted.has(combatantId)) return
  working.fainted.add(combatantId)
  update(working, withRuntime(combatant, {
    actionElapsedMs: 0, cooldownMultiplier: 1, protectCharges: 0, confusionRemainingMs: 0, selected: null,
  }))
  emit(working, { type: 'FAINTED', combatantId })
}

// ── PP ──────────────────────────────────────────────────────────────────────

/** This Pokémon's PP ceiling for a move: catalog PP plus its own PP Ups. */
export function maxPpOf(
  combatant: BattleCombatant, moveId: number, catalog: BattleRulesCatalog,
): number | null {
  const slot = combatant.instance.moves.find(entry => entry.moveId === moveId)
  if (!slot) return null
  const move = catalog.move(moveId)
  return move ? maxPPOf(move.pp, slot.ppUps) : null
}

export function remainingPpOf(
  combatant: BattleCombatant, moveId: number, catalog: BattleRulesCatalog,
): number | null {
  const max = maxPpOf(combatant, moveId, catalog)
  return max === null ? null : remainingPP(combatant.condition, moveId, max)
}

/** Spends one PP. Returns false when there is none, and then nothing changed. */
export function spendPp(working: Working, combatantId: string, moveId: number): boolean {
  const combatant = requireCombatant(working, combatantId)
  if (!combatant) return false
  const max = maxPpOf(combatant, moveId, working.catalog)
  if (max === null) return false
  const left = remainingPP(combatant.condition, moveId, max)
  if (left <= 0) return false
  const next = left - 1
  update(working, withConditionPatch(combatant, { pp: { ...combatant.condition.pp, [moveId]: next } }))
  emit(working, { type: 'PP_CHANGED', combatantId, moveId, remaining: next, max })
  return true
}

/** Restores PP up to the ceiling. Returns how much was actually restored. */
export function restorePp(
  working: Working, combatantId: string, moveId: number, amount: number,
): number {
  const combatant = requireCombatant(working, combatantId)
  if (!combatant) return 0
  const max = maxPpOf(combatant, moveId, working.catalog)
  if (max === null) return 0
  const left = remainingPP(combatant.condition, moveId, max)
  const restored = Math.max(0, Math.min(max - left, Math.floor(amount)))
  if (restored === 0) return 0
  const next = left + restored
  update(working, withConditionPatch(combatant, { pp: { ...combatant.condition.pp, [moveId]: next } }))
  emit(working, { type: 'PP_CHANGED', combatantId, moveId, remaining: next, max })
  return restored
}

/** Every move this Pokémon still has PP for, in slot order. */
export function usableMoveIds(
  combatant: BattleCombatant, catalog: BattleRulesCatalog,
): number[] {
  return combatant.instance.moves
    .filter(slot => (remainingPpOf(combatant, slot.moveId, catalog) ?? 0) > 0)
    .map(slot => slot.moveId)
}

/**
 * The moves this Pokémon can actually *use*: PP left **and** a rule that can
 * run them.
 *
 * The two conditions have to be checked together. A Gengar whose only move
 * with PP is one R32.3 defers would otherwise spend every Action Window being
 * refused — full PP, and standing there. The fallback chain reads this list,
 * and a Pokémon with nothing in it reaches Struggle (§22).
 */
export function executableMoveIds(
  combatant: BattleCombatant, catalog: BattleRulesCatalog,
): number[] {
  return usableMoveIds(combatant, catalog).filter(moveId => {
    const move = catalog.move(moveId)
    return move ? isExecutable(move) : false
  })
}

// ── Status ──────────────────────────────────────────────────────────────────

/**
 * Gives a major status, or says why it could not.
 *
 * One at a time, as in the games and as R32.2.1 persists it: a new one is
 * refused, never stacked. Sleep also sets how long it lasts, which is runtime
 * even though the status itself is condition.
 */
export function applyMajorStatus(
  working: Working, targetId: string, status: MajorStatus, sourceId: string | null,
): boolean {
  const target = requireCombatant(working, targetId)
  if (!target) return false
  if (isCombatantFainted(target)) {
    emit(working, { type: 'STATUS_FAILED', combatantId: targetId, status, reason: 'fainted' })
    return false
  }
  if (target.condition.majorStatus !== 'none') {
    emit(working, { type: 'STATUS_FAILED', combatantId: targetId, status, reason: 'alreadyHasMajorStatus' })
    return false
  }
  update(working, withConditionPatch(target, { majorStatus: status }))
  const withStatus = requireCombatant(working, targetId)
  if (withStatus) {
    update(working, withRuntime(withStatus, {
      sleepRemainingMs: status === 'sleep' ? working.state.config.status.sleepMs : 0,
      nextPoisonTickMs: status === 'poison' || status === 'badlyPoisoned'
        ? working.state.timeMs + working.state.config.status.poisonTickMs
        : withStatus.runtime.nextPoisonTickMs,
    }))
  }
  emit(working, { type: 'STATUS_APPLIED', combatantId: targetId, status, sourceId })
  return true
}

/** Confusion: volatile, sits beside a major status, never persisted (§26). */
export function applyConfusion(working: Working, targetId: string): boolean {
  const target = requireCombatant(working, targetId)
  if (!target) return false
  if (isCombatantFainted(target)) {
    emit(working, { type: 'STATUS_FAILED', combatantId: targetId, status: 'confusion', reason: 'fainted' })
    return false
  }
  if (target.runtime.confusionRemainingMs > 0) {
    emit(working, { type: 'STATUS_FAILED', combatantId: targetId, status: 'confusion', reason: 'alreadyConfused' })
    return false
  }
  const durationMs = working.state.config.confusion.durationMs
  update(working, withRuntime(target, { confusionRemainingMs: durationMs }))
  emit(working, { type: 'CONFUSION_APPLIED', combatantId: targetId, durationMs })
  return true
}

// ── Stat stages ─────────────────────────────────────────────────────────────

/**
 * Moves one stat stage, and says out loud when it could not.
 *
 * This is the **only** way a stat changes, and it takes a stat and a number —
 * never a move. Swords Dance, Growl and Shadow Ball's secondary all arrive
 * here as data read out of the catalog, which is why there is no branch for
 * any of them anywhere in these rules.
 *
 * The clamp is on the **stage**: at +2 another buff does nothing at all, and a
 * single −1 takes it to +1 immediately. There is no hidden surplus to eat
 * through, because a player cannot learn a rule they cannot see.
 */
export function modifyStat(
  working: Working,
  combatantId: string,
  stat: StageKey,
  delta: number,
  sourceId: string | null,
): boolean {
  const combatant = requireCombatant(working, combatantId)
  if (!combatant || isCombatantFainted(combatant)) return false
  const config = working.state.config.statStages
  const result = applyStage(combatant.runtime.stages, stat, delta, config)

  if (!result.changed) {
    emit(working, {
      type: 'STAT_STAGE_UNCHANGED',
      combatantId,
      stat,
      stage: result.stage,
      reason: delta > 0 ? 'atCeiling' : 'atFloor',
    })
    return false
  }
  update(working, withRuntime(combatant, { stages: result.stages }))
  emit(working, { type: 'STAT_STAGE_CHANGED', combatantId, stat, delta, stage: result.stage, sourceId })
  return true
}

/** Clears a major status, announcing it. Used when sleep runs out. */
export function clearMajorStatus(working: Working, combatantId: string): void {
  const combatant = requireCombatant(working, combatantId)
  if (!combatant || combatant.condition.majorStatus === 'none') return
  const status = combatant.condition.majorStatus
  update(working, withRuntime(withConditionPatch(combatant, { majorStatus: 'none' }), { sleepRemainingMs: 0 }))
  emit(working, { type: 'STATUS_ENDED', combatantId, status })
}
