import { ARRIVALS } from '../protocol/arrival.js'

/**
 * Areas whose dynamic world the service owns (WORLD-1).
 *
 * Only Pradera is procedural: its seed is the one the browser's atlas uses
 * (`areas/atlas.ts`, WORLDS) and its spawn is the arrival contract. Ciudad
 * Corazón is hand-authored art the service does not model; it hosts no
 * resource nodes and no wild Pokémon.
 */
export const WORLD_AREAS = Object.freeze({
  pradera: Object.freeze({ id: 'pradera', seed: 208, procedural: true, spawn: Object.freeze({ tx: ARRIVALS.pradera.tx, ty: ARRIVALS.pradera.ty }) }),
  'ciudad-corazon': Object.freeze({ id: 'ciudad-corazon', seed: null, procedural: false, spawn: null }),
})

/** @returns the area definition, or null for an area the world does not know. */
export function worldArea(areaId) {
  return Object.hasOwn(WORLD_AREAS, areaId) ? WORLD_AREAS[areaId] : null
}

/** Interest and index granularity for world entities, in tiles. */
export const WORLD_CHUNK_TILES = 16

export function chunkOf(tx, ty) {
  return `${Math.floor(tx / WORLD_CHUNK_TILES)},${Math.floor(ty / WORLD_CHUNK_TILES)}`
}
