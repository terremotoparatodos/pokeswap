// PRE-WORLD STAND-IN. Deterministic resource nodes derived from the world seed.
//
// Until WORLD-1 owns resource nodes (identity, position, state, respawn,
// sharing), the playtest client derives them from decor the procedural world
// already draws: each rock/tree has a chance of hosting a node, and which
// resource it hosts follows the ADVISORY `world` hints in domain/resources.ts
// (habitat, anchor, ring, weight). Nothing here decides who may work a node —
// that is the Skills service. Delete this folder when WORLD-1 lands.

import { hash2 } from '../../wildlands/engine/noise'
import type { Biome, DecorKind, World } from '../../wildlands/engine/world'
import { RESOURCES, type ResourceAnchor, type ResourceDefinition, type ResourceId } from '../domain/resources'

/** Structural port so placement never needs canvas code. */
export interface NodeWorldPort {
  readonly seed: number
  biomeAt(vx: number, vy: number): Biome
  decorAt(tx: number, ty: number): DecorKind | null
}

export function worldNodePort(world: World): NodeWorldPort {
  return {
    seed: world.seed,
    biomeAt: (vx, vy) => world.biomeAt(vx, vy),
    decorAt: (tx, ty) => world.decorAt(tx, ty),
  }
}

/** Keeps node rolls independent from decor and wild-population hashes. */
export const NODE_SALT = 31_031
/** Tiles per distance ring from the world origin (the area's entrance). */
export const RING_TILES = 96
export const MAX_RING = 2

/** Share of each anchor kind that hosts a node. */
export const ANCHOR_DENSITY: Readonly<Record<ResourceAnchor, number>> = {
  rock: 0.35, boulder: 0.5, icerock: 0.4, crystal: 0.6,
  tree: 0.12, pine: 0.1, snowpine: 0.1, palm: 0.2,
}

export interface NodePlacement {
  readonly nodeId: string
  readonly resourceId: ResourceId
  readonly tx: number
  readonly ty: number
  readonly ring: number
  readonly biome: Biome
}

export function ringAt(tx: number, ty: number): number {
  return Math.min(MAX_RING, Math.floor(Math.hypot(tx, ty) / RING_TILES))
}

const isAnchor = (kind: DecorKind | null): kind is ResourceAnchor => !!kind && kind in ANCHOR_DENSITY

/** O(1) per tile. */
export function nodeAt(world: NodeWorldPort, tx: number, ty: number, resources: readonly ResourceDefinition[] = RESOURCES): NodePlacement | null {
  const anchor = world.decorAt(tx, ty)
  if (!isAnchor(anchor) || hash2(tx, ty, world.seed + NODE_SALT) >= ANCHOR_DENSITY[anchor]) return null

  const biome = world.biomeAt(tx + 0.5, ty + 0.5)
  const ring = ringAt(tx, ty)
  const candidates = resources.filter(resource => resource.world.anchors.includes(anchor)
    && (resource.world.habitats as readonly string[]).includes(biome) && resource.world.minRing <= ring)
  if (!candidates.length) return null

  const totalWeight = candidates.reduce((sum, resource) => sum + resource.world.spawnWeight, 0)
  let roll = hash2(tx, ty, world.seed + NODE_SALT + 1) * totalWeight
  let picked = candidates[candidates.length - 1]
  for (const resource of candidates) {
    roll -= resource.world.spawnWeight
    if (roll < 0) { picked = resource; break }
  }
  return { nodeId: `${world.seed}:${tx}:${ty}:${picked.id}`, resourceId: picked.id, tx, ty, ring, biome }
}

export function nodesInChunk(world: NodeWorldPort, cx: number, cy: number, chunkTiles = 32): NodePlacement[] {
  const placements: NodePlacement[] = []
  for (let ty = cy * chunkTiles; ty < (cy + 1) * chunkTiles; ty++) {
    for (let tx = cx * chunkTiles; tx < (cx + 1) * chunkTiles; tx++) {
      const placement = nodeAt(world, tx, ty)
      if (placement) placements.push(placement)
    }
  }
  return placements
}
