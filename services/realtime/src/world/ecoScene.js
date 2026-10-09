import { isWalkable, portalAt } from './navigation.js'
import { buildPatrol, samplePatrol } from './patrol.js'
import { WILD_SPEED } from './wildPopulation.js'

/**
 * ECO-BATTLE-SCENE-1 (EXPERIMENTAL, development sandbox only): where a test battle stands, decided
 * by the server once, when it is reserved. Pure: no clock, no randomness of its own.
 *
 * Every client draws an ECO encounter on its SHARED patrol (patrol.js, WORLD-1D): a pure function of
 * its id, its home tile, the area's walkability and the server's time. The server samples the same
 * patrol at the engage instant to freeze the wild one exactly where it was seen — never back at its
 * home tile — and stands the player's Pokémon in front of it. The client's walkability for a wild
 * actor is the area's minus its portals (game.ts `walkable`); `wildWalkable` is that same rule, so
 * the patrol here is the patrol there (a parity test keeps them equal).
 */

/** A wild actor may stand here: walkable for the area, and not a portal (the client's rule). */
export function wildWalkable(areaId, tx, ty) {
  return isWalkable(areaId, tx, ty) && portalAt(areaId, tx, ty) === null
}

/** The shared patrol of an encounter, as every client builds it (ecoPopulace.ts). */
export function encounterPatrol(encounter) {
  return buildPatrol({ key: encounter.id, home: { tx: encounter.tx, ty: encounter.ty }, walkable: (tx, ty) => wildWalkable(encounter.areaId, tx, ty), speed: WILD_SPEED })
}

/**
 * The tile an encounter is seen on at server time `nowMs`: the tile it stands on, or, mid-step, the
 * one it is closer to (a step is drawn as a slide between two tiles).
 */
export function wildPoseAt(encounter, nowMs) {
  const pose = samplePatrol(encounterPatrol(encounter), nowMs)
  return pose.progress < 0.5 ? { tx: pose.fromTx, ty: pose.fromTy } : { tx: pose.tx, ty: pose.ty }
}

const NEIGHBOURS = Object.freeze([[0, -1], [1, 0], [0, 1], [-1, 0]])

/** Facing from one tile toward another, as the client's sprites name it. */
export function facing(from, to) {
  const dx = to.tx - from.tx
  const dy = to.ty - from.ty
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'down' : 'up')
}

/**
 * The battle's scene: the wild one frozen at `wild`, the player's Pokémon on the walkable tile
 * beside it that is closest to the trainer — never the wild one's tile nor the trainer's — facing
 * the wild one. Ties keep a fixed order (up, right, down, left). Null when no such tile exists.
 */
export function battleStage({ areaId, trainer, wild }) {
  let best = null
  for (const [dx, dy] of NEIGHBOURS) {
    const tile = { tx: wild.tx + dx, ty: wild.ty + dy }
    if (!wildWalkable(areaId, tile.tx, tile.ty)) continue
    if (tile.tx === trainer.tx && tile.ty === trainer.ty) continue
    const distance = Math.abs(tile.tx - trainer.tx) + Math.abs(tile.ty - trainer.ty)
    if (!best || distance < best.distance) best = { tile, distance }
  }
  if (!best) return null
  return {
    owner: { tx: trainer.tx, ty: trainer.ty },
    wild: { tx: wild.tx, ty: wild.ty },
    pokemon: best.tile,
    pokemonFacing: facing(best.tile, wild),
    wildFacing: facing(wild, best.tile),
  }
}
