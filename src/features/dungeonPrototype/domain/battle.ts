// The realtime battle engine (D0, rewritten for D1 §17–§35).
//
// APPROVED and enforced here:
//  - no separate battle screen and **no pause**: `tick` is the only clock and
//    takes no pause flag, so the bag cannot stop the enemy's bar;
//  - each combatant owns an Action Bar; the prepared move can be changed while
//    it fills, and whatever is prepared when it completes is what happens;
//  - **auto-repeat**: doing nothing repeats the last selected move, and a
//    player who never chose uses the first usable one;
//  - an item or a switch spends an Action Window;
//  - a switch keeps HP, PP and the major status, resets stages and starts the
//    bar from zero;
//  - Protect absorbs the next two offensive actions;
//  - one major status at a time; confusion sits beside it;
//  - poison ticks on its own clock, never on the action bar;
//  - every move is single-target in v1, ally damage is impossible.
//
// The engine mutates the `PokemonInstance` objects it is given — that is the
// point: the party wears down and carries the damage to the next floor.

import { attemptCapture, BASIC_BALL, type BallDefinition } from './capture'
import {
  ACTION_BAR, applyStage, computeDamage, confusionSelfDamage, cooldownAfter, cooldownSeconds,
  effectiveStat, poisonDamage, STATUS, type ActionBarConfig, type Combatant, type DamageRolls,
} from './damage'
import { isOffensive, moveById, type MoveDefinition } from './moves'
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
  readonly amount: number
  readonly ball?: BallDefinition
}

export interface BattleActor {
  readonly id: string
  readonly side: BattleSide
  /** Which simulated player owns this Pokémon; 'p1' when solo. */
  readonly owner: string
  combatant: Combatant
  /** 0…1. */
  bar: number
  prepared: PreparedAction
  /** Repeated when nothing new is chosen (APPROVED auto-repeat). */
  lastMoveId: string | null
  /** Multiplies the current cooldown: priority ×0.5, recharge and Protect ×2. */
  cooldownMultiplier: number
  /** Offensive actions the shield still absorbs. */
  shield: number
  poisonAt: number
  /** Damage this actor dealt, for boss participation. */
  damageDealt: number
  actions: number
}

export interface BattleEvent {
  readonly at: number
  readonly actorId: string
  readonly text: string
  readonly kind: 'move' | 'item' | 'switch' | 'status' | 'faint' | 'capture' | 'end' | 'boss'
}

export type BattleOutcome = 'ongoing' | 'victory' | 'defeat' | 'captured' | 'aborted'

export interface BattleState {
  seconds: number
  actors: BattleActor[]
  /** Bench members per owner, in party order. */
  bench: Record<string, PokemonInstance[]>
  log: BattleEvent[]
  outcome: BattleOutcome
  capturedInstanceId: string | null
  readonly items: Readonly<Record<string, BattleItem>>
  readonly rng: Rng
  readonly config: ActionBarConfig
  /** Set by the boss controller; the engine only renders and applies it. */
  telegraph: { readonly skillId: string; readonly name: string; readonly endsAt: number } | null
  /**
   * A Poké Ball is in the air (D1.2.3). While this is set the fight is held:
   * no bar moves, no poison ticks, nothing resolves — exactly like the handheld
   * games, where the throw is its own moment. It resolves itself on `tick`.
   */
  throw: BallThrow | null
  /** How the species behind a bench member is found when it switches in. */
  readonly speciesFor?: (pokemon: PokemonInstance) => Combatant['species']
}

/** A ball in flight: the shakes are decided up front, the verdict lands last. */
export interface BallThrow {
  readonly actorId: string
  readonly targetId: string
  readonly itemId: string
  /** 0–3 wobbles before it opens or clicks. */
  readonly shakes: number
  readonly captured: boolean
  readonly chance: number
  /** Seconds left of the whole animation. */
  remaining: number
}

/** Ball timings, in seconds. PLAYTEST PARAMETERS. */
export const BALL_TIMING = { flight: 0.45, perShake: 0.55, verdict: 0.5 } as const

export const ballDuration = (shakes: number): number =>
  BALL_TIMING.flight + shakes * BALL_TIMING.perShake + BALL_TIMING.verdict

export interface CreateBattleInput {
  readonly allies: readonly { combatant: Combatant; owner?: string }[]
  readonly enemies: readonly Combatant[]
  readonly bench?: Record<string, PokemonInstance[]>
  readonly items?: Readonly<Record<string, BattleItem>>
  readonly rng: Rng
  readonly config?: ActionBarConfig
  /**
   * How to look up the species behind a party member. A switch needs it: the
   * Pokémon coming in has its own types, stats and catch rate, and without it
   * the newcomer would keep fighting with the outgoing one's.
   */
  readonly speciesFor?: (pokemon: PokemonInstance) => Combatant['species']
}

const actorFor = (combatant: Combatant, side: BattleSide, index: number, owner: string): BattleActor => ({
  id: `${side}-${index}`, side, owner, combatant,
  bar: 0, prepared: { kind: 'idle' }, lastMoveId: null,
  cooldownMultiplier: 1, shield: 0, poisonAt: 0, damageDealt: 0, actions: 0,
})

export function createBattle(input: CreateBattleInput): BattleState {
  return {
    seconds: 0,
    actors: [
      ...input.allies.map((ally, i) => actorFor(ally.combatant, 'ally', i, ally.owner ?? 'p1')),
      ...input.enemies.map((combatant, i) => actorFor(combatant, 'enemy', i, 'enemy')),
    ],
    bench: input.bench ? { ...input.bench } : {},
    log: [],
    outcome: 'ongoing',
    capturedInstanceId: null,
    items: input.items ?? {},
    rng: input.rng,
    config: input.config ?? ACTION_BAR,
    telegraph: null,
    throw: null,
    speciesFor: input.speciesFor,
  }
}

export const actorById = (battle: BattleState, id: string): BattleActor | undefined =>
  battle.actors.find(actor => actor.id === id)

export const livingActors = (battle: BattleState, side: BattleSide): BattleActor[] =>
  battle.actors.filter(actor => actor.side === side && !isFainted(actor.combatant.pokemon))

const benchOf = (battle: BattleState, owner: string): PokemonInstance[] => battle.bench[owner] ?? []

export const log = (battle: BattleState, actorId: string, kind: BattleEvent['kind'], text: string): void => {
  battle.log.push({ at: Math.round(battle.seconds * 100) / 100, actorId, text, kind })
}

/** What the player taps. It only changes what is prepared; the bar keeps filling. */
export function prepare(battle: BattleState, actorId: string, action: PreparedAction): boolean {
  const actor = actorById(battle, actorId)
  if (!actor || battle.outcome !== 'ongoing' || isFainted(actor.combatant.pokemon)) return false
  if (action.kind === 'move') {
    const move = moveById(action.moveId)
    if (!move || !actor.combatant.pokemon.moves.includes(action.moveId)) return false
    if ((actor.combatant.pokemon.pp[action.moveId] ?? 0) <= 0) return false
  }
  actor.prepared = action
  return true
}

const rolls = (rng: Rng): DamageRolls => ({
  accuracy: rng.next(), crit: rng.next(), spread: rng.next(), secondary: rng.next(),
})

const usableMoves = (pokemon: PokemonInstance): string[] =>
  pokemon.moves.filter(id => (pokemon.pp[id] ?? 0) > 0)

/**
 * APPROVED auto-repeat: nothing prepared means "do what I did last time", and
 * a player who never chose anything falls back to the first usable move. The
 * fight never stalls because the player looked away.
 */
function resolveChoice(battle: BattleState, actor: BattleActor): PreparedAction {
  if (actor.prepared.kind !== 'idle') return actor.prepared
  const usable = usableMoves(actor.combatant.pokemon)
  if (actor.side === 'enemy') {
    const moveId = battle.rng.pick(usable)
    return moveId ? { kind: 'move', moveId } : { kind: 'idle' }
  }
  if (actor.lastMoveId && usable.includes(actor.lastMoveId)) return { kind: 'move', moveId: actor.lastMoveId }
  return usable.length ? { kind: 'move', moveId: usable[0] } : { kind: 'idle' }
}

/** v1: one target, always the other side. No AoE, no friendly fire (§18, §34). */
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
  actor.lastMoveId = move.id
  actor.cooldownMultiplier = cooldownAfter(move, battle.config)

  if (move.family === 'protect') {
    actor.shield = move.protectCharges ?? 2
    log(battle, actor.id, 'move', `${move.name}: escudo ×${actor.shield}`)
    return
  }

  if (move.statChanges && move.category === 'status' && !move.inflicts) {
    for (const change of move.statChanges) {
      const receiver = change.on === 'self' ? actor : targetFor(battle, actor)
      if (!receiver) continue
      if (change.on === 'target' && receiver.shield > 0) {
        receiver.shield -= 1
        log(battle, receiver.id, 'move', `Protección absorbió ${move.name} (${receiver.shield} restantes)`)
        continue
      }
      receiver.combatant = {
        ...receiver.combatant,
        stages: applyStage(receiver.combatant.stages, change.stat, change.stages),
      }
      log(battle, actor.id, 'move', `${move.name}: ${change.stages > 0 ? '+' : ''}${change.stages} ${change.stat}`)
    }
    return
  }

  const target = targetFor(battle, actor)
  if (!target) return
  if (isOffensive(move) && target.shield > 0) {
    target.shield -= 1
    log(battle, target.id, 'move', `Protección absorbió ${move.name} (${target.shield} restantes)`)
    return
  }

  const result = computeDamage(actor.combatant, target.combatant, move, rolls(battle.rng))
  if (!result.hit) {
    log(battle, actor.id, 'move', `${move.name} falló`)
    return
  }
  if (result.damage > 0) {
    dealDamage(target.combatant.pokemon, result.damage)
    actor.damageDealt += result.damage
    log(battle, actor.id, 'move', `${move.name}: ${result.damage} de daño${result.critical ? ' ¡Crítico!' : ''}`)
  } else if (result.effectiveness === 0) {
    log(battle, actor.id, 'move', `${move.name} no afecta`)
  }
  if (result.statusApplied) {
    target.combatant.pokemon.status = result.statusApplied
    if (result.statusApplied === 'sleep') target.combatant.pokemon.sleepFor = STATUS.sleepSeconds
    log(battle, target.id, 'status', `Estado: ${result.statusApplied}`)
  }
  if (result.confuses && target.combatant.pokemon.confusedFor <= 0) {
    target.combatant.pokemon.confusedFor = STATUS.confusionSeconds
    log(battle, target.id, 'status', 'Confusión')
  }
}

function executeItem(battle: BattleState, actor: BattleActor, itemId: string, targetId?: string): void {
  const item = battle.items[itemId]
  if (!item) return
  if (item.kind === 'ball') {
    const target = livingActors(battle, 'enemy')[0]
    if (!target || battle.throw) return
    const attempt = attemptCapture(
      { target: target.combatant.pokemon, catchRate: target.combatant.species.catchRate, ball: item.ball ?? BASIC_BALL },
      battle.rng.next(),
    )
    // D1.2.3: the throw is its own moment. The wild Pokémon goes into the ball,
    // it wobbles, and only then does it click or break open — and while that is
    // happening the fight is held, the way the handheld games hold it.
    const shakes = attempt.captured ? 3 : Math.min(3, Math.floor(attempt.chance * 4))
    battle.throw = {
      actorId: actor.id,
      targetId: target.id,
      itemId: item.id,
      shakes,
      captured: attempt.captured,
      chance: attempt.chance,
      remaining: ballDuration(shakes),
    }
    log(battle, actor.id, 'capture', `${item.name}: lanzada`)
    return
  }
  const bench = benchOf(battle, actor.owner).find(member => member.instanceId === targetId)
  const pokemon = bench ?? actor.combatant.pokemon
  if (item.kind === 'heal') {
    log(battle, actor.id, 'item', `${item.name}: +${heal(pokemon, item.amount)} HP`)
  } else if (item.kind === 'revive') {
    log(battle, actor.id, 'item', revive(pokemon, item.amount) ? `${item.name}: revivió` : `${item.name} no hizo nada`)
  } else if (item.kind === 'ether') {
    const moveId = pokemon.moves.find(id => (pokemon.pp[id] ?? 0) === 0) ?? pokemon.moves[0]
    const move = moveById(moveId)
    log(battle, actor.id, 'item', `${item.name}: +${move ? restorePp(pokemon, moveId, item.amount, move.pp) : 0} PP`)
  }
}

/**
 * APPROVED switch rules (§29): HP, PP and the major status come along; the
 * temporary stages do not; the new Pokémon starts its bar at zero.
 */
function executeSwitch(battle: BattleState, actor: BattleActor, instanceId: string): void {
  const bench = benchOf(battle, actor.owner)
  const index = bench.findIndex(member => member.instanceId === instanceId && !isFainted(member))
  if (index < 0) {
    log(battle, actor.id, 'switch', 'Ese Pokémon no puede entrar')
    return
  }
  const incoming = bench[index]
  bench[index] = actor.combatant.pokemon
  // D1.2.3: the species comes with it. Keeping the outgoing one's meant the
  // newcomer fought with somebody else's types, stats and catch rate.
  const species = battle.speciesFor?.(incoming) ?? actor.combatant.species
  actor.combatant = { ...actor.combatant, pokemon: incoming, species, stages: {} }
  actor.bar = 0
  actor.shield = 0
  actor.cooldownMultiplier = 1
  actor.lastMoveId = null
  log(battle, actor.id, 'switch', `Cambio: entra ${incoming.instanceId}`)
}

/** One completed Action Window. */
function resolve(battle: BattleState, actor: BattleActor): void {
  const pokemon = actor.combatant.pokemon
  actor.actions += 1

  if (pokemon.confusedFor > 0 && battle.rng.next() < STATUS.confusionSelfHitChance) {
    const self = confusionSelfDamage(actor.combatant)
    dealDamage(pokemon, self)
    log(battle, actor.id, 'status', `Confusión: se golpeó (${self})`)
    actor.cooldownMultiplier = 1
    return
  }

  const action = resolveChoice(battle, actor)
  if (action.kind === 'move') {
    const move = moveById(action.moveId)
    if (move) executeMove(battle, actor, move)
  } else if (action.kind === 'item') {
    executeItem(battle, actor, action.itemId, action.targetId)
    actor.cooldownMultiplier = 1
  } else if (action.kind === 'switch') {
    executeSwitch(battle, actor, action.instanceId)
    return
  } else {
    actor.cooldownMultiplier = 1
  }

  // The enemy re-decides every window; the player's choice stays prepared so
  // auto-repeat works, and an item or a switch is consumed once.
  if (actor.side === 'enemy' || action.kind !== 'move') actor.prepared = { kind: 'idle' }
}

function checkFaints(battle: BattleState): void {
  for (const actor of battle.actors) {
    const pokemon = actor.combatant.pokemon
    if (!isFainted(pokemon) || actor.bar === -1) continue
    actor.bar = -1
    log(battle, actor.id, 'faint', 'Se debilitó')
    if (actor.side !== 'ally') continue
    const bench = benchOf(battle, actor.owner)
    const replacement = bench.findIndex(member => !isFainted(member))
    if (replacement >= 0) {
      const incoming = bench[replacement]
      bench.splice(replacement, 1)
      actor.combatant = { ...actor.combatant, pokemon: incoming, stages: {} }
      actor.bar = 0
      actor.shield = 0
      actor.cooldownMultiplier = 1
      actor.prepared = { kind: 'idle' }
      actor.lastMoveId = null
      log(battle, actor.id, 'switch', `Entra ${incoming.instanceId}`)
    }
  }
}

function checkOutcome(battle: BattleState): void {
  if (battle.outcome !== 'ongoing') return
  const benchLeft = Object.values(battle.bench).flat().filter(member => !isFainted(member)).length
  const alliesLeft = livingActors(battle, 'ally').length + benchLeft
  if (livingActors(battle, 'enemy').length === 0) {
    battle.outcome = 'victory'
    log(battle, 'battle', 'end', 'Victoria')
  } else if (alliesLeft === 0) {
    battle.outcome = 'defeat'
    log(battle, 'battle', 'end', 'Derrota')
  }
}

/**
 * Advances the battle by `dt` seconds. There is **no pause parameter and no
 * pause flag**: whatever the UI is doing, the bars keep filling.
 */
/**
 * Runs the ball animation instead of the fight. Returns true while it owns the
 * clock — nothing else advances until it lands (D1.2.3 §5).
 */
function tickThrow(battle: BattleState, dt: number): boolean {
  const flight = battle.throw
  if (!flight) return false
  flight.remaining -= dt
  if (flight.remaining > 0) return true

  battle.throw = null
  const target = battle.actors.find(actor => actor.id === flight.targetId)
  const percent = Math.round(flight.chance * 100)
  if (flight.captured && target) {
    battle.capturedInstanceId = target.combatant.pokemon.instanceId
    battle.outcome = 'captured'
    log(battle, flight.actorId, 'capture', `¡Capturado! (${percent} %)`)
  } else {
    log(battle, flight.actorId, 'capture', `Se escapó (${percent} %)`)
  }
  return true
}

export function tick(battle: BattleState, dt: number): BattleState {
  if (battle.outcome !== 'ongoing' || dt <= 0) return battle
  // The throw holds everything: bars, poison, cooldowns, the boss.
  if (tickThrow(battle, dt)) return battle
  battle.seconds += dt

  for (const actor of battle.actors) {
    const pokemon = actor.combatant.pokemon
    if (isFainted(pokemon)) continue

    // Poison runs on its own clock, so a fast Pokémon does not take more of it.
    if (pokemon.status === 'poison' && battle.seconds - actor.poisonAt >= STATUS.poisonTickSeconds) {
      actor.poisonAt = battle.seconds
      const tickDamage = poisonDamage(pokemon)
      dealDamage(pokemon, tickDamage)
      log(battle, actor.id, 'status', `Veneno: ${tickDamage}`)
    }

    if (pokemon.confusedFor > 0) pokemon.confusedFor = Math.max(0, pokemon.confusedFor - dt)

    // Sleep eats Action Windows: the bar does not advance at all.
    if (pokemon.status === 'sleep') {
      pokemon.sleepFor = Math.max(0, pokemon.sleepFor - dt)
      if (pokemon.sleepFor === 0) {
        pokemon.status = 'none'
        log(battle, actor.id, 'status', 'Despertó')
      }
      continue
    }

    const seconds = cooldownSeconds(actor.combatant, actor.cooldownMultiplier, battle.config)
    actor.bar = Math.min(1, Math.max(0, actor.bar) + dt / seconds)
    if (actor.bar >= 1) {
      actor.bar = 0
      resolve(battle, actor)
    }
  }

  checkFaints(battle)
  checkOutcome(battle)
  return battle
}

export const barOf = (actor: BattleActor): number => Math.max(0, Math.min(1, actor.bar))

export const speedOf = (actor: BattleActor): number => Math.round(effectiveStat(actor.combatant, 'speed'))

/** Seconds this actor's current bar will take, for the HUD and the reports. */
export const cooldownOf = (battle: BattleState, actor: BattleActor): number =>
  Math.round(cooldownSeconds(actor.combatant, actor.cooldownMultiplier, battle.config) * 100) / 100

/** Ends the fight without a winner: the dungeon clock ran out. */
export function abortBattle(battle: BattleState, reason: string): void {
  if (battle.outcome !== 'ongoing') return
  battle.outcome = 'aborted'
  log(battle, 'battle', 'end', reason)
}
