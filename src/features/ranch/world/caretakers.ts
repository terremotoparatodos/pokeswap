// Guti and Sky — Rancho
//
// The only two people on the map. Everyone else living here is a Pokémon.
// They do the rounds of the places that matter — house, paddocks, barn,
// plaza, garden, lake — walking a real path between them and then standing
// around for a good while, so they read as caretakers rather than as NPCs
// pacing a loop. Only two actors do this, so full pathfinding is cheap.

import { advance, isMoving, tryStep, type Actor, type MoveRules } from '../../wildlands/engine/actors'
import { createActor } from '../../wildlands/engine/actors'
import { loadTrainerSheet, type Dir, type TrainerSprites } from '../../wildlands/engine/characters'
import { findPath } from '../../wildlands/engine/pathfinding'
import { devWarn } from '../../../shared/utils/devTools'
import { hashString, seededRandom } from '../domain/seededRandom'
import type { Tile } from './slots'
import type { RanchMap } from './ranchMap'

export const CARETAKER_SHEETS = {
  guti: '/assets/trainers/protahombre.png',
  sky: '/assets/trainers/dawnrosa.png',
} as const

export type CaretakerId = keyof typeof CARETAKER_SHEETS

/** Seconds spent standing at a stop before setting off again. */
const PAUSE_MIN = 10
const PAUSE_MAX = 30
/** An unhurried walk: slower than the handheld player. */
const CARETAKER_SPEED = 2.6
/** A* budget: the ranch is 120 x 90 tiles, so a generous radius still ends fast. */
const PATH_RADIUS = 140

export interface CaretakerRoute {
  id: CaretakerId
  name: string
  stops: Tile[]
}

/** Tile rounds for each of them, in the order they walk. */
export function caretakerRoutes(): CaretakerRoute[] {
  return [
    {
      id: 'guti',
      name: 'Guti',
      stops: [
        { tx: 64, ty: 47 }, // puerta de la casa
        { tx: 60, ty: 55 }, // plaza
        { tx: 92, ty: 62 }, // corral oeste
        { tx: 97, ty: 56 }, // granero
        { tx: 88, ty: 72 }, // corral grande
        { tx: 66, ty: 52 }, // vuelta por el pozo
      ],
    },
    {
      id: 'sky',
      name: 'Sky',
      stops: [
        { tx: 14, ty: 58 }, // huerta
        { tx: 24, ty: 52 }, // camino del jardín
        { tx: 53, ty: 44 }, // subida a las rocas
        { tx: 84, ty: 38 }, // orilla del lago
        { tx: 62, ty: 50 }, // plaza
        { tx: 57, ty: 47 }, // casa
      ],
    },
  ]
}

export interface Caretaker {
  id: CaretakerId
  name: string
  actor: Actor
  stops: Tile[]
  /** Stop being walked to. */
  target: number
  /** Directions left to reach it. */
  steps: Dir[]
  /** Time before which it does not set off again. */
  restUntil: number
  random: () => number
}

export function createCaretakers(routes: readonly CaretakerRoute[], map: RanchMap, now: number): Caretaker[] {
  return routes.map((route, index) => {
    const start = nearestOpen(map, route.stops[0])
    const random = seededRandom(hashString(`caretaker:${route.id}`))
    return {
      id: route.id,
      name: route.name,
      actor: createActor({
        id: `caretaker:${route.id}`,
        kind: 'npc',
        habitat: 'land',
        tx: start.tx,
        ty: start.ty,
        speed: CARETAKER_SPEED,
        dir: 'down',
      }),
      stops: route.stops.map(stop => nearestOpen(map, stop)),
      target: 1 % route.stops.length,
      steps: [],
      restUntil: now + PAUSE_MIN + random() * PAUSE_MAX + index * 4,
      random,
    }
  })
}

/** The given tile, or the closest walkable one to it (stops are hand-placed). */
function nearestOpen(map: RanchMap, tile: Tile): Tile {
  if (!map.isSolid(tile.tx, tile.ty)) return tile
  for (let r = 1; r <= 6; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        const tx = tile.tx + dx
        const ty = tile.ty + dy
        if (!map.isSolid(tx, ty)) return { tx, ty }
      }
    }
  }
  return tile
}

export function caretakerRules(map: RanchMap): MoveRules {
  return {
    blocked: (_actor, tx, ty) => map.isSolid(tx, ty),
    occupied: () => false,
  }
}

export function tickCaretaker(caretaker: Caretaker, now: number, dt: number, rules: MoveRules): void {
  const { actor } = caretaker
  advance(actor, dt)
  if (isMoving(actor)) return

  if (caretaker.steps.length === 0) {
    if (now < caretaker.restUntil) return
    const stop = caretaker.stops[caretaker.target]
    const path = findPath({
      start: { tx: actor.tx, ty: actor.ty },
      target: stop,
      isGoal: (tx, ty) => tx === stop.tx && ty === stop.ty,
      blocked: (tx, ty) => rules.blocked(actor, tx, ty),
      radius: PATH_RADIUS,
    })
    caretaker.target = (caretaker.target + 1) % caretaker.stops.length
    if (!path || path.length === 0) {
      // Unreachable stop: rest briefly and try the next one instead.
      caretaker.restUntil = now + 2
      return
    }
    caretaker.steps = path
    return
  }

  const next = caretaker.steps[0]
  if (tryStep(actor, next, rules)) {
    caretaker.steps.shift()
    if (caretaker.steps.length === 0) {
      caretaker.restUntil = now + PAUSE_MIN + caretaker.random() * (PAUSE_MAX - PAUSE_MIN)
    }
    return
  }
  // Something appeared in the way: drop the plan and set off again shortly.
  caretaker.steps.length = 0
  caretaker.restUntil = now + 1.5
}

/** Loads the two bundled trainer sheets; on failure the caretaker stays invisible. */
export function loadCaretakerArt(caretakers: readonly Caretaker[]): void {
  for (const caretaker of caretakers) {
    loadTrainerSheet(CARETAKER_SHEETS[caretaker.id])
      .then(sheet => {
        caretaker.actor.trainer = sheet.walk as TrainerSprites
        if (sheet.run) caretaker.actor.trainerRun = sheet.run
      })
      .catch(error => devWarn('[rancho] no se pudo cargar el sprite de', caretaker.name, error))
  }
}
