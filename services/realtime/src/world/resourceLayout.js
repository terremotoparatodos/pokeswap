import { WORLD_CHUNK_TILES, chunkOf, worldArea } from './areas.js'
import { biomeAt, decorAt, hash2 } from './terrain.js'

/**
 * Where resource nodes are — the deterministic base layout (WORLD-1B).
 *
 * A node is a property of the tile, not a row anywhere: seed + area + tile +
 * variant always give the same node, so client and server agree on every id
 * without storing or sending the layout. Only what *happens* to a node is
 * state (`resourceStore.js`), and that is sparse.
 *
 * WORLD owns the physical side: which props are workable, what kind of thing
 * they are and how the world regrows them. What a node yields, which skill
 * and level it needs and how long it takes are SKILLS decisions made behind
 * `skillPolicy.js`; nothing here knows about them.
 */

/** Physical resource kinds. Farming plots will be a third kind with its own lifecycle. */
export const RESOURCE_KIND = Object.freeze({ TREE: 'tree', ROCK: 'rock' })

/** The physical verb a worker performs on each kind. */
export const WORK_KIND = Object.freeze({ tree: 'chop', rock: 'mine' })

/**
 * Workable props. The variant is the prop the world already draws there; the
 * density is the share of those props that host a node. The shares and the
 * salt are the ones the R31 professions demo used (`nodePlacement.ts`), so the
 * same trees and rocks stay workable.
 *
 * Deliberately absent: bushes and herbs (foraging), shores and reefs (fishing,
 * removed by SKILLS), and crystals, which the world already treats as a
 * walk-over pickup (`WildArea.collect`) — see WORLD_1_REPORT.md, open questions.
 */
export const RESOURCE_VARIANTS = Object.freeze({
  tree: Object.freeze({ kind: 'tree', density: 0.12 }),
  pine: Object.freeze({ kind: 'tree', density: 0.1 }),
  snowpine: Object.freeze({ kind: 'tree', density: 0.1 }),
  palm: Object.freeze({ kind: 'tree', density: 0.2 }),
  rock: Object.freeze({ kind: 'rock', density: 0.35 }),
  boulder: Object.freeze({ kind: 'rock', density: 0.5 }),
  icerock: Object.freeze({ kind: 'rock', density: 0.4 }),
})

/**
 * How long a depleted node takes to come back. WORLD-owned pacing: it is how
 * fast the world regrows, not what a skill yields. Provisional numbers (the
 * shortest respawn the demo catalog had); SKILLS may ask for a per-variant
 * table, and it would land here.
 */
export const RESPAWN_MS = Object.freeze({ tree: 90_000, rock: 90_000 })

export const NODE_SALT = 31_031
export const ZONE_RING_TILES = 96
export const MAX_ZONE = 3

export function zoneAt(tx, ty) {
  return Math.min(MAX_ZONE, Math.floor(Math.hypot(tx, ty) / ZONE_RING_TILES))
}

export function resourceId(areaId, tx, ty, variantId) {
  return `${areaId}:${tx}:${ty}:${variantId}`
}

/**
 * The node on a tile, or null. O(1): this is what the service evaluates when a
 * client names a node, and what a client evaluates for a prop it draws.
 */
export function resourceAt(areaId, tx, ty) {
  const area = worldArea(areaId)
  if (!area?.procedural || !Number.isInteger(tx) || !Number.isInteger(ty)) return null
  const variantId = decorAt(area.seed, tx, ty)
  const variant = variantId ? RESOURCE_VARIANTS[variantId] : undefined
  if (!variant || hash2(tx, ty, area.seed + NODE_SALT) >= variant.density) return null
  return Object.freeze({
    id: resourceId(areaId, tx, ty, variantId),
    resourceKind: variant.kind,
    variantId,
    areaId,
    chunkId: chunkOf(tx, ty),
    tx,
    ty,
    zone: zoneAt(tx, ty),
    biome: biomeAt(area.seed, tx + 0.5, ty + 0.5),
  })
}

const ID_PATTERN = /^([a-z][a-z0-9-]{0,31}):(-?\d{1,6}):(-?\d{1,6}):([a-z]{1,16})$/

/**
 * Resolves a client-supplied id. The id is only a name: the node must exist
 * where the id says, with the variant the id says, or it does not exist.
 */
export function resourceById(id) {
  if (typeof id !== 'string' || id.length > 64) return null
  const match = ID_PATTERN.exec(id)
  if (!match) return null
  const node = resourceAt(match[1], Number(match[2]), Number(match[3]))
  return node && node.id === id ? node : null
}

/** Every node of one world chunk (tests, metrics and the load benchmark). */
export function resourcesInChunk(areaId, cx, cy, chunkTiles = WORLD_CHUNK_TILES) {
  const nodes = []
  for (let ty = cy * chunkTiles; ty < (cy + 1) * chunkTiles; ty++) {
    for (let tx = cx * chunkTiles; tx < (cx + 1) * chunkTiles; tx++) {
      const node = resourceAt(areaId, tx, ty)
      if (node) nodes.push(node)
    }
  }
  return nodes
}
