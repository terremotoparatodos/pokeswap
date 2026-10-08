// ECO-OVERWORLD-BATTLE-1 (experimental, development builds only): what the overworld battle draws,
// derived from what the SERVER sent. Pure — no DOM, no clock of its own, no randomness.
//
// It never runs the battle: no reduce, no tick, no rolls. HP, PP, status and the action bar's
// position come from the last snapshot; between two snapshots the action bar is only drawn moving
// at the local clock's pace (capped full: a full bar waits for the server), and nothing else moves.
// Effects are the server's typed events, turned into marks on the two Pokémon.
//
// The action bar uses the core's own `actionBarFill` on the client view (the snapshot carries
// every field it reads: stats, stages, cooldown multiplier, major status, elapsed time, config) —
// no copy of the formula. See docs/design/ECO_OVERWORLD_BATTLE_1_NOTES.md §2.

import type { AuthorityEventEnvelope, ClientBattleSnapshot, ClientCombatantView } from '../../battle/authority'
import type { BattleCatalogIndex } from '../../battle/catalog'
import { actionBarFill } from '../../battle/rules/actionBar'
import type { BattleCombatant } from '../../battle/rules/state'
import type { MajorStatus } from '../../pokemon/model/condition'

export const PLAYER_COMBATANT = 'player-0'
export const WILD_COMBATANT = 'wild-0'

export interface PresentedCombatant {
  readonly combatantId: string
  readonly speciesId: number
  readonly level: number
  readonly hp: number
  readonly maxHp: number
  /** 0…1, from the snapshot only. */
  readonly hpFraction: number
  /** 0…1: the server's position plus the local time since the snapshot arrived (visual only). */
  readonly actionFill: number
  readonly status: Exclude<MajorStatus, 'none'> | null
  readonly confused: boolean
}

export interface PresentationClock {
  /** Local ms when this snapshot arrived. */
  readonly receivedAt: number
  /** Local ms now. */
  readonly now: number
  /** False while the server pauses the battle (owner disconnected). */
  readonly connected: boolean
}

/** A combatant as drawn now. Null when the snapshot does not have it. */
export function presentCombatant(snapshot: ClientBattleSnapshot, combatantId: string, clock: PresentationClock): PresentedCombatant | null {
  const view = snapshot.combatants[combatantId]
  if (!view) return null
  const hp = Math.max(0, view.condition.currentHp ?? view.stats.hp)
  const status = view.condition.majorStatus === 'none' ? null : view.condition.majorStatus
  const moving = clock.connected && snapshot.outcome.kind === 'ongoing' && status !== 'sleep' && hp > 0
  const extra = moving ? Math.max(0, clock.now - clock.receivedAt) : 0
  return {
    combatantId, speciesId: view.instance.speciesId, level: view.level,
    hp, maxHp: view.stats.hp, hpFraction: view.stats.hp > 0 ? Math.min(1, hp / view.stats.hp) : 0,
    actionFill: fillOf(view, snapshot, extra),
    status, confused: view.runtime.confusionRemainingMs > 0,
  }
}

function fillOf(view: ClientCombatantView, snapshot: ClientBattleSnapshot, extraMs: number): number {
  // The client view carries every field `cooldownMs` reads; the cast only names that fact.
  const shifted = { ...view, runtime: { ...view.runtime, actionElapsedMs: view.runtime.actionElapsedMs + extraMs } }
  return Math.min(1, actionBarFill(shifted as unknown as BattleCombatant, snapshot.config))
}

// ── Effects from events ─────────────────────────────────────────────────────

export type EcoVfxKind = 'physical' | 'special' | 'statusHit' | 'shield' | 'heal'

/** A mark to draw: on `at`, optionally flying from `from`. Positions are resolved by the overlay. */
export type EcoVfx =
  | { readonly type: 'effect'; readonly kind: EcoVfxKind; readonly at: string; readonly from?: string; readonly colour: string; readonly life: number }
  | { readonly type: 'text'; readonly at: string; readonly text: string; readonly colour: string; readonly life: number }

/** Lives and colours as the Dungeon prototype draws them (its approved look). */
const LIFE = { physical: 0.32, special: 0.42, statusHit: 0.6, shield: 0.5, heal: 0.6, text: 0.9 } as const
const STATUS_COLOUR: Readonly<Record<string, string>> = {
  burn: '#f0603c', paralysis: '#f8d030', poison: '#a040a0', badlyPoisoned: '#a040a0', freeze: '#9ad8d8', sleep: '#8b93b8', confusion: '#e8a33c',
}

/**
 * The server's events of one message as marks on the battlefield. `colourOfType` comes from the
 * caller (Dungeon's type palette) so this module stays free of render code.
 */
export function vfxOf(
  events: readonly AuthorityEventEnvelope[], catalog: BattleCatalogIndex | null, colourOfType: (type: string | undefined) => string,
): EcoVfx[] {
  const out: EcoVfx[] = []
  for (const { event } of events) {
    switch (event.type) {
      case 'MOVE_USED': {
        const move = catalog?.move(event.moveId) ?? null
        const colour = colourOfType(move?.type)
        const target = event.targetId ?? event.combatantId
        if (move?.category === 'status') out.push({ type: 'effect', kind: 'statusHit', at: target, colour, life: LIFE.statusHit })
        else if (move?.category === 'special') out.push({ type: 'effect', kind: 'special', at: target, from: event.combatantId, colour, life: LIFE.special })
        else out.push({ type: 'effect', kind: 'physical', at: target, colour, life: LIFE.physical })
        break
      }
      case 'DAMAGE':
        out.push({ type: 'text', at: event.combatantId, text: `-${event.amount}${event.critical ? '!' : ''}`, colour: '#ffb0a8', life: LIFE.text })
        break
      case 'HEAL':
        out.push({ type: 'effect', kind: 'heal', at: event.combatantId, colour: '#7be08f', life: LIFE.heal })
        out.push({ type: 'text', at: event.combatantId, text: `+${event.amount}`, colour: '#9ff0b8', life: LIFE.text })
        break
      case 'MOVE_MISSED':
        out.push({ type: 'text', at: event.combatantId, text: 'falló', colour: '#dce6ff', life: LIFE.text })
        break
      case 'STATUS_APPLIED':
        out.push({ type: 'effect', kind: 'statusHit', at: event.combatantId, colour: STATUS_COLOUR[event.status] ?? '#e8a33c', life: LIFE.statusHit })
        break
      case 'CONFUSION_APPLIED':
        out.push({ type: 'effect', kind: 'statusHit', at: event.combatantId, colour: STATUS_COLOUR.confusion, life: LIFE.statusHit })
        break
      case 'PROTECT_GAINED':
      case 'PROTECT_BLOCKED':
        out.push({ type: 'effect', kind: 'shield', at: event.combatantId, colour: '#9fc6ff', life: LIFE.shield })
        break
      case 'FAINTED':
        out.push({ type: 'text', at: event.combatantId, text: 'debilitado', colour: '#ffd27a', life: LIFE.text })
        break
      default:
        break
    }
  }
  return out
}

// ── Where the battle stands ─────────────────────────────────────────────────

export interface StageInput {
  /** The trainer's tile (the local player, owner of the battle). */
  readonly player: { readonly tx: number; readonly ty: number }
  /** The encounter's server-listed tile (where it stands still while busy). */
  readonly wild: { readonly tx: number; readonly ty: number }
}

export interface Stage {
  /** Tile of the synthetic Pikachu: beside the trainer, on the wild one's side. */
  readonly pikachu: { readonly tx: number; readonly ty: number }
  readonly pikachuFacing: 'up' | 'down' | 'left' | 'right'
  readonly wildFacing: 'up' | 'down' | 'left' | 'right'
}

const facing = (dx: number, dy: number): Stage['pikachuFacing'] =>
  Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'down' : 'up')

/** The Pikachu one tile from the trainer toward the wild Pokémon (on the trainer's tile when they touch). */
export function stageOf({ player, wild }: StageInput): Stage {
  const dx = wild.tx - player.tx
  const dy = wild.ty - player.ty
  const horizontal = Math.abs(dx) >= Math.abs(dy)
  const step = { x: horizontal ? Math.sign(dx) : 0, y: horizontal ? 0 : Math.sign(dy) }
  const pikachu = Math.max(Math.abs(dx), Math.abs(dy)) > 1 ? { tx: player.tx + step.x, ty: player.ty + step.y } : { tx: player.tx, ty: player.ty }
  return { pikachu, pikachuFacing: facing(dx, dy), wildFacing: facing(-dx, -dy) }
}
