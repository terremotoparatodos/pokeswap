// Which moves these rules can actually execute (R32.3).
//
// The catalog ships a `supported` flag, but that flag was R32.1's **forecast**
// of what R32.3 would reach. This file is the answer, and the two disagree in
// both directions: recoil and recharge were forecast as gaps and are
// implemented here, while every stat-changing move turned out to be
// unreachable for a reason the forecast did not know about (see below).
//
// The rule that decides: **an explicit gap beats a hack.** A move this file
// defers is refused with a reason, never quietly run as a plain hit. A player
// who selects one is told; nothing silently does something else.
//
// The one gap that is data and not work: `move_meta_stat_changes` is not in
// the generated catalog, so a `statChange` move says *that* it changes stats
// and never *which* or *by how much*. Swords Dance and Growl are
// indistinguishable here. The stat-stage machinery exists and is tested
// (`stats.ts`), but no catalog move can drive it until R32.1 emits that table
// — which is a new `catalogVersion`, and therefore not R32.3's to do.

import type { CatalogMove } from '../catalog'
import type { MajorStatus } from '../../pokemon/model'

/** The ailments these rules know how to inflict. */
export const SUPPORTED_AILMENTS: readonly string[] =
  ['burn', 'paralysis', 'poison', 'freeze', 'sleep', 'confusion']

/** Targets that collapse cleanly onto the 1-vs-1 baseline (§38). */
const SINGLE_TARGET = new Set([
  'selected-pokemon', 'all-opponents', 'random-opponent', 'all-other-pokemon',
])

export type MoveExecution =
  | { readonly kind: 'executable'; readonly effect: SupportedEffect }
  | { readonly kind: 'deferred'; readonly reason: string }

/** What the engine will do with a move, resolved once from catalog columns. */
export type SupportedEffect =
  | 'damage'
  | 'damage.multiHit'
  | 'damage.drain'
  | 'damage.recoil'
  | 'damage.recharge'
  | 'damage.ailment'
  | 'ailment'
  | 'heal'
  | 'protect'

const ailmentOf = (move: CatalogMove): string => move.meta.ailment ?? 'none'

/**
 * How this move resolves, or why it does not.
 *
 * Pure and cheap: it reads only the move's own columns, so a caller can build
 * a report over all 621 of them (`npm run battle:sample`).
 */
export function classifyMove(move: CatalogMove): MoveExecution {
  // A charge turn is a turn, and there are no turns. Fly, Dig and Solar Beam
  // need a realtime shape nobody has approved yet.
  if (move.flags.includes('charge')) return { kind: 'deferred', reason: 'charge turn' }

  const selfTargeted = move.target === 'user'
  if (!selfTargeted && !SINGLE_TARGET.has(move.target)) {
    return { kind: 'deferred', reason: `target ${move.target}` }
  }

  const needsPower = (): MoveExecution | null =>
    move.power === null ? { kind: 'deferred', reason: 'variable power' } : null

  switch (move.effectId) {
    case 'damage':
    case 'damage.multiHit':
    case 'damage.drain':
    case 'damage.recoil':
    case 'damage.recharge':
      return needsPower() ?? { kind: 'executable', effect: move.effectId }

    case 'damage.ailment': {
      const missing = needsPower()
      if (missing) return missing
      return SUPPORTED_AILMENTS.includes(ailmentOf(move))
        ? { kind: 'executable', effect: 'damage.ailment' }
        : { kind: 'deferred', reason: `ailment ${ailmentOf(move)}` }
    }

    case 'ailment':
      return SUPPORTED_AILMENTS.includes(ailmentOf(move))
        ? { kind: 'executable', effect: 'ailment' }
        : { kind: 'deferred', reason: `ailment ${ailmentOf(move)}` }

    case 'heal':
      return selfTargeted && (move.meta.healing ?? 0) > 0
        ? { kind: 'executable', effect: 'heal' }
        : { kind: 'deferred', reason: 'heal variant' }

    case 'protect':
      // Wide Guard and Mat Block protect a side, and there are no sides to
      // protect in a 1-vs-1 baseline.
      return selfTargeted
        ? { kind: 'executable', effect: 'protect' }
        : { kind: 'deferred', reason: 'side protect' }

    case 'statChange':
    case 'damage.statChange':
      return { kind: 'deferred', reason: 'stat change payload missing from catalog' }

    case 'damage.flinch':
      // Flinch means "you lose your turn". With an Action Bar the equivalent
      // would be resetting the target's bar, and that is a product decision
      // nobody has made.
      return { kind: 'deferred', reason: 'flinch has no realtime meaning yet' }

    default:
      return { kind: 'deferred', reason: `effect ${move.effectId}` }
  }
}

export const isExecutable = (move: CatalogMove): boolean => classifyMove(move).kind === 'executable'

/** Whether the ailment this move inflicts takes the one major-status slot. */
export const isMajorStatusAilment = (ailment: string): ailment is MajorStatus =>
  ailment === 'burn' || ailment === 'paralysis' || ailment === 'poison'
  || ailment === 'badlyPoisoned' || ailment === 'freeze' || ailment === 'sleep'

export interface MoveCoverageReport {
  readonly total: number
  readonly executable: number
  readonly deferred: number
  /** Deferred counts by reason, most common first. */
  readonly byReason: readonly { readonly reason: string; readonly moves: number }[]
}

/** The honest headline: how much of Generation VI these rules can run. */
export function reportMoveCoverage(moves: readonly CatalogMove[]): MoveCoverageReport {
  const byReason = new Map<string, number>()
  let executable = 0
  for (const move of moves) {
    const verdict = classifyMove(move)
    if (verdict.kind === 'executable') executable += 1
    else byReason.set(verdict.reason, (byReason.get(verdict.reason) ?? 0) + 1)
  }
  return {
    total: moves.length,
    executable,
    deferred: moves.length - executable,
    byReason: [...byReason.entries()]
      .map(([reason, count]) => ({ reason, moves: count }))
      .sort((a, b) => b.moves - a.moves || a.reason.localeCompare(b.reason)),
  }
}
