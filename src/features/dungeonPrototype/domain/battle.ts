// The realtime battle engine (D2).
//
// APPROVED and enforced here:
//  - no separate battle screen and **no pause**: `tick` is the only clock and
//    nothing in this module can stop it. Opening the bag is a UI state that the
//    engine never hears about;
//  - each combatant owns an Action Bar; the player may change the prepared
//    move while it fills, and whatever is prepared when the bar completes is
//    what happens;
//  - using an item spends an Action Window instead of attacking;
//  - switching Pokémon also spends an Action Window (PROTOTYPE ASSUMPTION);
//  - HP, PP, faint and status are the party's own state, so they persist when
//    the battle ends and the expedition goes on.
//
// The engine is pure except for mutating the `PokemonInstance` objects it was
// given — which is the point: the party wears down.

import { attemptCapture, BASIC_BALL, type BallDefinition } from './capture'
import {
  applyStage, barSecondsFor, computeDamage, effectiveStat, FIZZLE_CHANCE, RESIDUAL,
  residualDamage, type Combatant, type DamageRolls,
} from './damage'
import { moveById, releaseThreshold, type MoveDefinition } from './moves'
import { damage as dealDamage, heal, isFainted, restorePp, revive, spendPp, type PokemonInstance } from './party'
import type { Rng } from './rng'

export type BattleSide = 'ally' | 'enemy'

export type PreparedAction =
  | { readonly kind: 'move'; readonly moveId: string }
  | { readonly kind: 'item'; readonly itemId: string; readonly targetId?: string }
  | { readonly kind: 'switch'; readonly instanceId: string }
  | { readonly kind: 'idle' }

export type ItemKind = 'heal' | 'revive' | 'ether' | 'ball'

export interface BattleItem {
  readonly id: string
  readonly name: string
  readonly kind: ItemKind
  /** HP healed, PP restored, or the revive fraction. */
  readonly amount: number
  readonly ball?: BallDefinition
}

export interface BattleActor {
  readonly id: string
  readonly side: BattleSide
  combatant: Combatant
  /** 0…1. */
  bar: number
  prepared: PreparedAction
  /** Set by a recharge move: the next completed bar is spent doing nothing. */
  recharging: boolean
  /** Battle seconds until which this actor cannot be hit. */
  protectedUntil: number
  /** Consecutive protects, for the diminishing returns. */
  protectStreak: number
  residualAt: number
}

export interface BattleEvent {
  readonly at: number
  readonly actorId: string
  readonly text: string
  readonly kind: 'move' | 'item' | 'switch' | 'status' | 'faint' | 'capture' | 'end'
}

export type BattleOutcome = 'ongoing' | 'victory' | 'defeat' | 'captured'

export interface BattleState {
  seconds: number
  actors: BattleActor[]
  /** Bench members, in party order, that may still be switched in. */
  bench: PokemonInstance[]
  log: BattleEvent[]
  outcome: BattleOutcome
  /** Set when a capture succeeds, so the expedition can record it. */
  capturedInstanceId: string | null
  readonly items: Readonly<Record<string, BattleItem>>
  readonly rng: Rng
  /** Total damage each actor dealt, for boss participation. */
  damageBy: Record<string, number>
}

export interface CreateBattleInput {
  readonly allies: readonly Combatant[]
  readonly enemies: readonly Combatant[]
  readonly bench?: readonly PokemonInstance[]
  readonly items?: Readonly<Record<string, BattleItem>>
  readonly rng: Rng
}

const actorFor = (combatant: Combatant, side: BattleSide, index: number): BattleActor => ({
  id: `${side}-${index}`,
  side,
  combatant,
  bar: 0,
  prepared: { kind: 'idle' },
  recharging: false,
  protectedUntil: -1,
  protectStreak: 0,
  residualAt: 0,
})

export function createBattle(input: CreateBattleInput): BattleState {
  return {
    seconds: 0,
    actors: [
      ...input.allies.map((combatant, i) => actorFor(combatant, 'ally', i)),
      ...input.enemies.map((combatant, i) => actorFor(combatant, 'enemy', i)),
    ],
    bench: [...(input.bench ?? [])],
    log: [],
    outcome: 'ongoing',
    capturedInstanceId: null,
    items: input.items ?? {},
    rng: input.rng,
    damageBy: {},
  }
}

export const actorById = (battle: BattleState, id: string): BattleActor | undefined =>
  battle.actors.find(actor => actor.id === id)

export const livingActors = (battle: BattleState, side: BattleSide): BattleActor[] =>
  battle.actors.filter(actor => actor.side === side && !isFainted(actor.combatant.pokemon))

/** What the player taps. It only changes what is prepared; the bar keeps filling. */
export function prepare(battle: BattleState, actorId: string, action: PreparedAction): boolean {
  const actor = actorById(battle, actorId)
  if (!actor || battle.outcome !== 'ongoing' || isFainted(actor.combatant.pokemon)) return false
  if (action.kind === 'move') {
    const move = moveById(action.moveId)
    if (!move || (actor.combatant.pokemon.pp[action.moveId] ?? 0) <= 0) return false
  }
  actor.prepared = action
  return true
}

const log = (battle: BattleState, actorId: string, kind: BattleEvent['kind'], text: string): void => {
  battle.log.push({ at: Math.round(battle.seconds * 100) / 100, actorId, text, kind })
}

const rolls = (rng: Rng): DamageRolls => ({
  accuracy: rng.next(), crit: rng.next(), spread: rng.next(), secondary: rng.next(),
})

/** The simplest enemy that still exercises the systems: a usable move at random. */
function enemyChoice(battle: BattleState, actor: BattleActor): PreparedAction {
  const usable = actor.combatant.pokemon.moves.filter(id => (actor.combatant.pokemon.pp[id] ?? 0) > 0)
  const moveId = battle.rng.pick(usable)
  return moveId ? { kind: 'move', moveId } : { kind: 'idle' }
}

function targetFor(battle: BattleState, actor: BattleActor): BattleActor | undefined {
  const enemies = livingActors(battle, actor.side === 'ally' ? 'enemy' : 'ally')
  return battle.rng.pick(enemies)
}

function executeMove(battle: BattleState, actor: BattleActor, move: MoveDefinition): void {
  const pokemon = actor.combatant.pokemon
  if (!spendPp(pokemon, move.id)) {
    log(battle, actor.id, 'move', `${move.name} no tiene PP`)
    return
  }

  if (move.family === 'protect') {
    // Diminishing returns: the second consecutive Protect usually fails.
    const success = actor.protectStreak === 0 || battle.rng.next() < 1 / (actor.protectStreak * 3 + 1)
    actor.protectStreak = success ? actor.protectStreak + 1 : 0
    if (success) {
      actor.protectedUntil = battle.seconds + (move.protectSeconds ?? 1.5)
      log(battle, actor.id, 'move', `${move.name}: se protege`)
    } else {
      log(battle, actor.id, 'move', `${move.name} falló`)
    }
    return
  }
  actor.protectStreak = 0

  if (move.statChanges && move.category === 'status' && !move.inflicts) {
    for (const change of move.statChanges) {
      const receiver = change.on === 'self' ? actor : targetFor(battle, actor)
      if (!receiver) continue
      receiver.combatant = { ...receiver.combatant, stages: applyStage(receiver.combatant.stages, change.stat, change.stages) }
      log(battle, actor.id, 'move', `${move.name}: ${change.stages > 0 ? '+' : ''}${change.stages} ${change.stat}`)
    }
    return
  }

  const target = targetFor(battle, actor)
  if (!target) return
  if (battle.seconds < target.protectedUntil) {
    log(battle, actor.id, 'move', `${move.name} chocó contra Protección`)
    return
  }

  const result = computeDamage(actor.combatant, target.combatant, move, rolls(battle.rng))
  if (!result.hit) {
    log(battle, actor.id, 'move', `${move.name} falló`)
    return
  }
  if (result.damage > 0) {
    dealDamage(target.combatant.pokemon, result.damage)
    battle.damageBy[actor.id] = (battle.damageBy[actor.id] ?? 0) + result.damage
    const extra = result.critical ? ' ¡Crítico!' : ''
    log(battle, actor.id, 'move', `${move.name}: ${result.damage} de daño${extra}`)
  } else if (result.effectiveness === 0) {
    log(battle, actor.id, 'move', `${move.name} no afecta`)
  }
  if (result.statusApplied) {
    target.combatant.pokemon.status = result.statusApplied
    if (result.statusApplied === 'sleep') target.combatant.pokemon.sleepFor = 4
    log(battle, target.id, 'status', `Estado: ${result.statusApplied}`)
  }
  if (move.recharges) actor.recharging = true
}

function executeItem(battle: BattleState, actor: BattleActor, itemId: string, targetId?: string): void {
  const item = battle.items[itemId]
  if (!item) return
  if (item.kind === 'ball') {
    const target = livingActors(battle, 'enemy')[0]
    if (!target) return
    const attempt = attemptCapture(
      { target: target.combatant.pokemon, catchRate: target.combatant.species.catchRate, ball: item.ball ?? BASIC_BALL },
      battle.rng.next(),
    )
    if (attempt.captured) {
      battle.capturedInstanceId = target.combatant.pokemon.instanceId
      battle.outcome = 'captured'
      log(battle, actor.id, 'capture', `¡Capturado! (${Math.round(attempt.chance * 100)} %)`)
    } else {
      log(battle, actor.id, 'capture', `Se escapó (${Math.round(attempt.chance * 100)} %)`)
    }
    return
  }
  const bench = battle.bench.find(member => member.instanceId === targetId)
  const pokemon = bench ?? actor.combatant.pokemon
  if (item.kind === 'heal') {
    const healed = heal(pokemon, item.amount)
    log(battle, actor.id, 'item', `${item.name}: +${healed} HP`)
  } else if (item.kind === 'revive') {
    const revived = revive(pokemon, item.amount)
    log(battle, actor.id, 'item', revived ? `${item.name}: revivió` : `${item.name} no hizo nada`)
  } else if (item.kind === 'ether') {
    const moveId = pokemon.moves.find(id => (pokemon.pp[id] ?? 0) === 0) ?? pokemon.moves[0]
    const move = moveById(moveId)
    const restored = move ? restorePp(pokemon, moveId, item.amount, move.pp) : 0
    log(battle, actor.id, 'item', `${item.name}: +${restored} PP`)
  }
}

function executeSwitch(battle: BattleState, actor: BattleActor, instanceId: string): void {
  const index = battle.bench.findIndex(member => member.instanceId === instanceId && !isFainted(member))
  if (index < 0) {
    log(battle, actor.id, 'switch', 'Ese Pokémon no puede entrar')
    return
  }
  const incoming = battle.bench[index]
  battle.bench[index] = actor.combatant.pokemon
  // Stat stages are left behind, as in the games.
  actor.combatant = { ...actor.combatant, pokemon: incoming, stages: {} }
  actor.protectStreak = 0
  actor.recharging = false
  log(battle, actor.id, 'switch', `Cambio: entra ${incoming.instanceId}`)
}

/** One completed Action Window. */
function resolve(battle: BattleState, actor: BattleActor): void {
  const pokemon = actor.combatant.pokemon
  if (actor.recharging) {
    actor.recharging = false
    log(battle, actor.id, 'move', 'Debe recargar')
    return
  }
  if (pokemon.status === 'paralysis' && battle.rng.next() < FIZZLE_CHANCE) {
    log(battle, actor.id, 'status', 'Parálisis: no pudo moverse')
    return
  }
  const action = actor.side === 'enemy' && actor.prepared.kind === 'idle'
    ? enemyChoice(battle, actor)
    : actor.prepared

  if (action.kind === 'move') {
    const move = moveById(action.moveId)
    if (move) executeMove(battle, actor, move)
  } else if (action.kind === 'item') {
    executeItem(battle, actor, action.itemId, action.targetId)
  } else if (action.kind === 'switch') {
    executeSwitch(battle, actor, action.instanceId)
  }
  // The enemy re-decides every window; the player's choice stays prepared.
  if (actor.side === 'enemy') actor.prepared = { kind: 'idle' }
}

function checkFaints(battle: BattleState): void {
  for (const actor of battle.actors) {
    const pokemon = actor.combatant.pokemon
    if (!isFainted(pokemon) || actor.bar === -1) continue
    actor.bar = -1
    log(battle, actor.id, 'faint', 'Se debilitó')
    if (actor.side === 'ally') {
      const replacement = battle.bench.findIndex(member => !isFainted(member))
      if (replacement >= 0) {
        const incoming = battle.bench[replacement]
        battle.bench.splice(replacement, 1)
        actor.combatant = { ...actor.combatant, pokemon: incoming, stages: {} }
        actor.bar = 0
        actor.prepared = { kind: 'idle' }
        log(battle, actor.id, 'switch', `Entra ${incoming.instanceId}`)
      }
    }
  }
}

function checkOutcome(battle: BattleState): void {
  if (battle.outcome !== 'ongoing') return
  const alliesLeft = livingActors(battle, 'ally').length + battle.bench.filter(member => !isFainted(member)).length
  const enemiesLeft = livingActors(battle, 'enemy').length
  if (enemiesLeft === 0) {
    battle.outcome = 'victory'
    log(battle, 'battle', 'end', 'Victoria')
  } else if (alliesLeft === 0) {
    battle.outcome = 'defeat'
    log(battle, 'battle', 'end', 'Derrota')
  }
}

/**
 * Advances the battle by `dt` seconds. There is no pause parameter and no
 * pause flag: whatever the UI is doing, the bars keep filling.
 */
export function tick(battle: BattleState, dt: number): BattleState {
  if (battle.outcome !== 'ongoing' || dt <= 0) return battle
  battle.seconds += dt

  for (const actor of battle.actors) {
    const pokemon = actor.combatant.pokemon
    if (isFainted(pokemon)) continue

    if (pokemon.status === 'sleep') {
      pokemon.sleepFor = Math.max(0, pokemon.sleepFor - dt)
      if (pokemon.sleepFor === 0) {
        pokemon.status = 'none'
        log(battle, actor.id, 'status', 'Despertó')
      }
      continue
    }

    if (battle.seconds - actor.residualAt >= RESIDUAL.everySeconds) {
      actor.residualAt = battle.seconds
      const residual = residualDamage(pokemon)
      if (residual > 0) {
        dealDamage(pokemon, residual)
        log(battle, actor.id, 'status', `${pokemon.status}: ${residual} de daño`)
      }
    }

    const seconds = barSecondsFor(actor.combatant)
    actor.bar = Math.min(1, Math.max(0, actor.bar) + dt / seconds)

    const prepared = actor.prepared.kind === 'move' ? moveById(actor.prepared.moveId) : null
    const threshold = prepared ? releaseThreshold(prepared) : 1
    if (actor.bar >= threshold) {
      actor.bar = 0
      resolve(battle, actor)
    }
  }

  checkFaints(battle)
  checkOutcome(battle)
  return battle
}

/** How full each bar is, for the UI. */
export const barOf = (actor: BattleActor): number => Math.max(0, Math.min(1, actor.bar))

/** Effective speed, so a lab can show why one bar is faster. */
export const speedOf = (actor: BattleActor): number => Math.round(effectiveStat(actor.combatant, 'speed'))
