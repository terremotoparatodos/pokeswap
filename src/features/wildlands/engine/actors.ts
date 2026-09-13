// Actors and grid movement — WildLands prototype
//
// Movement is tile-to-tile like the handheld games: an actor commits to the
// next tile and glides there. Wanderers (NPC trainers and wild Pokémon) pick
// cosmetic random steps around a home tile; none of this is persisted.

import type { Dir, PokemonFrames, TrainerSprites } from './characters'
import { TILE } from './world'

export type ActorKind = 'player' | 'npc' | 'pokemon'
export type Habitat = 'land' | 'water' | 'any'

export interface PokemonInfo {
  id: number
  name: string
  shiny: boolean
  frames: PokemonFrames
}

export interface Actor {
  id: string
  kind: ActorKind
  habitat: Habitat
  tx: number
  ty: number
  fromTx: number
  fromTy: number
  /** 0..1 progress toward (tx, ty); 1 when resting. */
  progress: number
  dir: Dir
  speed: number
  walkClock: number
  homeTx: number
  homeTy: number
  nextThink: number
  trainer?: TrainerSprites
  /** Running frames, used while `running` and moving. */
  trainerRun?: TrainerSprites
  running: boolean
  /** Walking in place against an obstacle. */
  bumping: boolean
  /** Stays put (standing residents); only turns when talked to. */
  stationary?: boolean
  /** What this NPC says when talked to. */
  lines?: readonly string[]
  pokemon?: PokemonInfo
  /** Bounce offset for Pokémon hops, in world px. */
  hop: number
}

export const DIRS: Record<Dir, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
}

export function createActor(init: Pick<Actor, 'id' | 'kind' | 'habitat' | 'tx' | 'ty'> & Partial<Actor>): Actor {
  return {
    dir: 'down', speed: 4, walkClock: 0, nextThink: 0, hop: 0, running: false, bumping: false,
    ...init,
    fromTx: init.tx, fromTy: init.ty, progress: 1, homeTx: init.homeTx ?? init.tx, homeTy: init.homeTy ?? init.ty,
  }
}

export function isMoving(actor: Actor): boolean {
  return actor.progress < 1
}

/**
 * Feet position in world pixels, interpolated between tiles. Rounded to whole
 * pixels so sprites and the (camera-locked) ground move in lockstep.
 */
export function actorPosition(actor: Actor): { x: number; y: number } {
  const t = actor.progress
  const tx = actor.fromTx + (actor.tx - actor.fromTx) * t
  const ty = actor.fromTy + (actor.ty - actor.fromTy) * t
  return { x: Math.round(tx * TILE + TILE / 2), y: Math.round(ty * TILE + TILE - 2) }
}

export interface MoveRules {
  /** True when the tile is blocked for this actor (terrain, props, habitat). */
  blocked(actor: Actor, tx: number, ty: number): boolean
  /** True when another actor occupies or is entering the tile. */
  occupied(tx: number, ty: number, self: Actor): boolean
}

/** Faces `dir` and starts a step if the target tile is free. Returns whether it moved. */
export function tryStep(actor: Actor, dir: Dir, rules: MoveRules): boolean {
  actor.dir = dir
  if (isMoving(actor)) return false
  const [dx, dy] = DIRS[dir]
  const nx = actor.tx + dx
  const ny = actor.ty + dy
  if (rules.blocked(actor, nx, ny) || rules.occupied(nx, ny, actor)) return false
  actor.fromTx = actor.tx
  actor.fromTy = actor.ty
  actor.tx = nx
  actor.ty = ny
  actor.progress = 0
  return true
}

export function advance(actor: Actor, dt: number): void {
  if (actor.progress < 1) {
    actor.progress = Math.min(1, actor.progress + actor.speed * dt)
    actor.walkClock += actor.speed * dt
    if (actor.kind === 'pokemon') actor.hop = Math.sin(actor.progress * Math.PI) * 1.5
  } else {
    actor.hop = 0
  }
}

const ALL_DIRS: Dir[] = ['up', 'down', 'left', 'right']

/** Random wandering that drifts back toward home when it strays too far. */
export function wander(actor: Actor, now: number, rules: MoveRules, random: () => number = Math.random): void {
  if (actor.stationary || isMoving(actor) || now < actor.nextThink) return
  actor.nextThink = now + 0.6 + random() * 2.4
  if (random() < 0.35) {
    actor.dir = ALL_DIRS[Math.floor(random() * 4)]
    return
  }
  let dir = ALL_DIRS[Math.floor(random() * 4)]
  const offX = actor.tx - actor.homeTx
  const offY = actor.ty - actor.homeTy
  if (Math.abs(offX) > 4 || Math.abs(offY) > 4) {
    dir = Math.abs(offX) > Math.abs(offY) ? (offX > 0 ? 'left' : 'right') : offY > 0 ? 'up' : 'down'
  }
  tryStep(actor, dir, rules)
}

/**
 * Frame index into the idle/stepA/idle/stepB cycle. Each tile lifts a foot in
 * its first half and lands in its second, alternating feet between tiles.
 */
export function walkFrame(actor: Actor): number {
  if (!isMoving(actor) && !actor.bumping) return 0
  return (Math.floor(actor.walkClock * 2) + 1) % 4
}

/** Walking pace in tiles per second: Gen 4 takes 16 frames per tile, 8 when running. */
export const WALK_SPEED = 3.75
export const RUN_SPEED = 7.5
/** A tap shorter than this from standing still only turns the character. */
export const TURN_DELAY = 0.1
const BUMP_PACE = 2

export interface WalkerState {
  want: Dir | null
  held: number
  /** True while chaining steps; turning mid-walk does not pause. */
  walking: boolean
  /** Turned from standing and still waiting for TURN_DELAY. */
  turning: boolean
}

export function createWalkerState(): WalkerState {
  return { want: null, held: 0, walking: false, turning: false }
}

/**
 * Handheld-style player movement:
 *  - leftover time at the end of a tile carries into the next step, so holding
 *    a direction walks without a stall frame between tiles;
 *  - from standing, a new direction turns first and only steps if still held;
 *  - pushing against a blocked tile walks in place.
 *
 * `input` may be a function so a path can hand out its next direction the
 * moment a tile is reached (mid-frame). `instantTurn` skips the tap-to-turn
 * delay, for tap-to-move where the intent is already explicit.
 */
export function driveWalker(
  actor: Actor,
  input: Dir | null | (() => Dir | null),
  dt: number,
  rules: MoveRules,
  state: WalkerState,
  onArrive?: (tx: number, ty: number) => void,
  instantTurn = false,
): void {
  const read = () => (typeof input === 'function' ? input() : input)
  let want = read()
  state.held = want !== null && want === state.want ? state.held + dt : 0
  state.want = want
  let time = dt

  for (let guard = 0; guard < 4; guard++) {
    if (isMoving(actor)) {
      const toGo = (1 - actor.progress) / actor.speed
      const used = Math.min(time, toGo)
      actor.progress = used >= toGo ? 1 : actor.progress + used * actor.speed
      actor.walkClock += used * actor.speed
      time -= used
      if (isMoving(actor)) return
      actor.walkClock = Math.round(actor.walkClock)
      onArrive?.(actor.tx, actor.ty)
      want = read()
    }

    if (want === null) {
      stopWalking(actor, state)
      return
    }
    if (!state.walking && !instantTurn) {
      if (actor.dir !== want) {
        actor.dir = want
        state.turning = true
        return
      }
      if (state.turning && state.held < TURN_DELAY) return
    }
    state.turning = false

    if (tryStep(actor, want, rules)) {
      actor.bumping = false
      state.walking = true
      continue
    }
    // Blocked: shuffle in place, facing the obstacle.
    state.walking = false
    actor.bumping = true
    actor.walkClock += dt * BUMP_PACE
    return
  }
}

function stopWalking(actor: Actor, state: WalkerState): void {
  state.walking = false
  state.turning = false
  if (actor.bumping) {
    actor.bumping = false
    actor.walkClock = Math.ceil(actor.walkClock)
  }
}
