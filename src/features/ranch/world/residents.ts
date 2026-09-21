// Inhabitants — Rancho
//
// Turns a snapshot into the Pokémon living on the map: each resident's
// (zone, slot) address becomes a home tile, and the actor stays around it.
//
// The ranch is meant to feel calm. WildLands' wander() rethinks every second
// or so, which reads as a field full of restless wild Pokémon; here an
// inhabitant stands still for four to fifteen seconds, then either turns to
// look somewhere or takes a step or three, never leaving its own zone or
// straying more than a couple of tiles from home.
//
// Art loads lazily: a Pokémon is a Poké Ball until its overworld sheet
// arrives, and only species that are actually on screen are ever requested.

import { createActor, isMoving, tryStep, type Actor, type MoveRules } from '../../wildlands/engine/actors'
import { loadOverworldFrames, type Dir, type PokemonFrames } from '../../wildlands/engine/characters'
import { pokeballInfo } from '../../wildlands/engine/pokeball'
import { devWarn } from '../../../shared/utils/devTools'
import type { RanchResident } from '../domain/membership'
import { hashString, seededRandom } from '../domain/seededRandom'
import { speciesName } from '../domain/species'
import type { RanchMap } from './ranchMap'
import type { ZoneSlots } from './slots'

/** Seconds an inhabitant stays put between decisions. */
export const THINK_MIN = 4
export const THINK_MAX = 15
/** How far from home an inhabitant may drift, in tiles. */
export const ROAM = 2
/** Steps taken in one outing. */
const MAX_STEPS = 3
/** A resting pace: Pokémon stroll, they do not march. */
const STROLL_SPEED = 2.4

const DIRECTIONS: Dir[] = ['up', 'down', 'left', 'right']

export interface Inhabitant {
  resident: RanchResident
  actor: Actor
  /** Its own random stream, so behaviour does not depend on frame timing. */
  random: () => number
  /** Steps left in the current outing. */
  stepsLeft: number
  /** The zone it may never leave. */
  zone: number
}

export function createInhabitants(
  residents: readonly RanchResident[],
  map: RanchMap,
  slots: ZoneSlots,
  now: number,
): Inhabitant[] {
  const out: Inhabitant[] = []
  for (const resident of residents) {
    const tile = slots[resident.zone]?.[resident.slot]
    if (!tile) continue
    const random = seededRandom(hashString(`life:${resident.id}`))
    const actor = createActor({
      id: resident.id,
      kind: 'pokemon',
      habitat: 'land',
      tx: tile.tx,
      ty: tile.ty,
      speed: STROLL_SPEED,
      dir: DIRECTIONS[Math.floor(random() * 4)],
      pokemon: pokeballInfo({ id: resident.speciesId, name_es: speciesName(resident.speciesId) }),
    })
    // Spread the first decisions out, so nobody moves in lockstep after load.
    actor.nextThink = now + THINK_MIN + random() * (THINK_MAX - THINK_MIN)
    out.push({ resident, actor, random, stepsLeft: 0, zone: map.zones[tile.ty * map.w + tile.tx] })
  }
  return out
}

/**
 * One decision for one inhabitant. Called only while it is on screen: off
 * screen nobody is watching, and a frozen Pokémon is indistinguishable from a
 * simulated one once you scroll back.
 */
export function thinkInhabitant(life: Inhabitant, now: number, rules: MoveRules): void {
  const { actor, random } = life
  if (isMoving(actor) || now < actor.nextThink) return

  if (life.stepsLeft > 0) {
    life.stepsLeft--
    if (stepHome(life, rules)) {
      actor.nextThink = now + 0.1
      return
    }
    life.stepsLeft = 0
  }

  actor.nextThink = now + THINK_MIN + random() * (THINK_MAX - THINK_MIN)
  const roll = random()
  if (roll < 0.45) {
    // Just look somewhere else.
    actor.dir = DIRECTIONS[Math.floor(random() * 4)]
    return
  }
  if (roll < 0.9) {
    life.stepsLeft = Math.floor(random() * MAX_STEPS)
    if (stepHome(life, rules)) actor.nextThink = now + 0.1
  }
  // The rest of the time it simply stays as it is.
}

/** A step that keeps the inhabitant near home and inside its own zone. */
function stepHome(life: Inhabitant, rules: MoveRules): boolean {
  const { actor, random } = life
  const offX = actor.tx - actor.homeTx
  const offY = actor.ty - actor.homeTy
  let dir: Dir
  if (Math.abs(offX) > ROAM || Math.abs(offY) > ROAM) {
    dir = Math.abs(offX) > Math.abs(offY) ? (offX > 0 ? 'left' : 'right') : offY > 0 ? 'up' : 'down'
  } else {
    dir = DIRECTIONS[Math.floor(random() * 4)]
  }
  return tryStep(actor, dir, rules)
}

/** Blocks a step that leaves the map, hits something solid or leaves the zone. */
export function inhabitantRules(map: RanchMap, occupied: (tx: number, ty: number, self: Actor) => boolean): MoveRules {
  return {
    blocked(actor, tx, ty) {
      if (!map.isHabitable(tx, ty)) return true
      const zone = map.zones[ty * map.w + tx]
      const home = map.zones[actor.homeTy * map.w + actor.homeTx]
      return zone !== home
    },
    occupied,
  }
}

/**
 * Overworld art for the species on screen, fetched once each and shared by
 * everyone of that species. Until it arrives the Poké Ball stands in.
 */
export class SpeciesArt {
  private readonly frames = new Map<number, PokemonFrames>()
  private readonly pending = new Set<number>()
  private readonly failed = new Set<number>()

  has(speciesId: number): boolean {
    return this.frames.has(speciesId)
  }

  /** Requests the sheet if this is the first time the species is seen. */
  request(speciesId: number): PokemonFrames | null {
    const ready = this.frames.get(speciesId)
    if (ready) return ready
    if (this.pending.has(speciesId) || this.failed.has(speciesId)) return null
    this.pending.add(speciesId)
    loadOverworldFrames(speciesId, false)
      .then(frames => {
        this.pending.delete(speciesId)
        this.frames.set(speciesId, frames)
      })
      .catch(error => {
        this.pending.delete(speciesId)
        this.failed.add(speciesId)
        devWarn('[rancho] sin arte overworld para la especie', speciesId, error)
      })
    return null
  }

  get loaded(): number {
    return this.frames.size
  }
}
