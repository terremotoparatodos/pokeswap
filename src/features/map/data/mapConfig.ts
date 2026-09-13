// Map world data — R16
//
// Typed constants extracted from data/map-data.js (legacy global).
// Positioning utilities (isWalkable, getSpawnPoint) are purely client-side:
// they compute cosmetic positions that are never persisted (TRUST_BOUNDARY §2).
//
// The WALKMAP grid is declared here as a type; the parsed array is read from
// the legacy global at runtime so the large RLE blob is not duplicated.

import type { MapZone } from '../types'

// --- World dimensions (pixels) ---
export const MAP_W = 3091
export const MAP_H = 2457
export const TILE_W = 16

// --- Zone definitions (image tiles composing the world) ---
export const ZONES: MapZone[] = [
  {
    name: 'hearthome',
    x: 1024, y: 0, w: 1031, h: 788,
    img: '/assets/tiles/hearthome.png',
  },
  {
    name: 'route208',
    x: 0, y: 340, w: 1024, h: 448,
    img: '/assets/tiles/route208.png',
  },
  {
    name: 'route209',
    x: 2055, y: 0, w: 1036, h: 848,
    img: '/assets/tiles/route209.png',
  },
  {
    name: 'route212',
    x: 1017, y: 788, w: 2032, h: 1669,
    img: '/assets/tiles/route212.png',
  },
]

/**
 * Pokémon type affinities per zone.
 * Used to choose a spawn zone that matches the Pokémon's primary type.
 */
export const ZONE_TYPES: Record<string, string[]> = {
  hearthome: ['normal', 'psychic', 'fairy', 'ghost'],
  route208:  ['bug', 'grass', 'flying', 'rock'],
  route209:  ['normal', 'ghost', 'water', 'flying'],
  route212:  ['water', 'grass', 'poison', 'ground'],
}

// The Hearthome zone is where owned Pokémon always spawn.
const HEARTHOME = ZONES.find(z => z.name === 'hearthome')!

// --- Walkability ---

/**
 * Returns the parsed walkmap from the legacy global, or an empty grid if
 * `data/map-data.js` has not yet loaded (e.g. during unit tests).
 */
function getWalkmap(): number[][] {
  return (globalThis as Record<string, unknown>)['WALKMAP'] as number[][] | undefined ?? []
}

/**
 * True when world-space position (px, py) falls on a walkable tile.
 * A walkable tile has value 0 in the WALKMAP grid (1 = obstacle).
 */
export function isWalkable(px: number, py: number): boolean {
  const walkmap = getWalkmap()
  if (!walkmap.length) return true
  const col = Math.floor(px / TILE_W)
  const row = Math.floor(py / TILE_W)
  return walkmap[row]?.[col] === 0
}

// --- Spawn point calculation (client-side, cosmetic, not persisted) ---

const MAX_TRIES = 50

/**
 * Returns a random walkable world-space position within a zone.
 * Falls back to the zone's top-left corner if no walkable tile is found.
 */
function randomPointInZone(zone: MapZone): { x: number; y: number } {
  let px = zone.x
  let py = zone.y
  for (let i = 0; i < MAX_TRIES; i++) {
    px = zone.x + Math.random() * zone.w
    py = zone.y + Math.random() * zone.h
    if (isWalkable(px, py)) return { x: px, y: py }
  }
  return { x: px, y: py }
}

/** Spawn point for an owned Pokémon — always in Hearthome city. */
export function getHearthomePoint(): { x: number; y: number } {
  return randomPointInZone(HEARTHOME)
}

/**
 * Spawn point for a wild Pokémon, placed in a zone whose type affinities
 * match the Pokémon's primary type. Falls back to a random zone.
 */
export function getSpawnPoint(type1: string): { x: number; y: number } {
  const typeLower = type1.toLowerCase()
  const matching = ZONES.filter(z => ZONE_TYPES[z.name]?.includes(typeLower))
  const zone = matching.length
    ? matching[Math.floor(Math.random() * matching.length)]
    : ZONES[Math.floor(Math.random() * ZONES.length)]
  return randomPointInZone(zone)
}

// --- Wild pool constants (mirror of legacy values) ---

/** Maximum wild Pokémon shown on the map at a time. */
export const WILD_POOL_SIZE = 25

/** Wild pool rotation interval in milliseconds (60 minutes). */
export const WILD_ROTATE_MS = 60 * 60 * 1000
