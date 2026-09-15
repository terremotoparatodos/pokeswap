// Deterministic resource nodes derived from the world seed.
//
// Client and server compute the same node for the same tile, so node
// positions are never stored or broadcast. Only depletion (nodeDepletion.ts)
// is state, and it is sparse and short-lived.

import { GATHERING_NODES } from './catalog/nodes'
import { hash2 } from '../../wildlands/engine/noise'
import { T, type DecorKind, type World } from '../../wildlands/engine/world'
import type { Biome, GatheringNodeDefinition, NodeAnchor } from './types'

/** Structural port so the resolver runs on the server without canvas code. */
export interface NodeWorldPort {
  readonly seed: number
  biomeAt(vx: number, vy: number): Biome
  decorAt(tx: number, ty: number): DecorKind | null
  isWater(tx: number, ty: number): boolean
  isTallGrass(tx: number, ty: number): boolean
}

export function worldNodePort(world: World): NodeWorldPort {
  return {
    seed: world.seed,
    biomeAt: (vx, vy) => world.biomeAt(vx, vy),
    decorAt: (tx, ty) => world.decorAt(tx, ty),
    isWater: (tx, ty) => world.isWater(tx, ty),
    isTallGrass: (tx, ty) => world.tileTerrain(tx, ty) === T.TALL,
  }
}

/** Keeps node rolls independent from decor and wild-population hashes. */
export const NODE_SALT = 31_031
export const ZONE_RING_TILES = 96
export const MAX_ZONE = 3
export const BASE_DETECTION_RADIUS = 8

/** Share of anchors of each kind that host a node. Unlisted anchors host none. */
export const ANCHOR_DENSITY: Readonly<Partial<Record<NodeAnchor, number>>> = {
  rock: 0.35, boulder: 0.5, icerock: 0.4, crystal: 0.6,
  tree: 0.12, pine: 0.1, snowpine: 0.1, palm: 0.2,
  bush: 0.3, tallGrass: 0.02, shore: 0.05, coral: 0.15, searock: 0.15,
}

export interface NodePlacement {
  readonly nodeId: string
  readonly definitionId: string
  readonly tx: number
  readonly ty: number
  readonly zone: number
  readonly biome: Biome
}

export function zoneAt(tx: number, ty: number): number {
  return Math.min(MAX_ZONE, Math.floor(Math.hypot(tx, ty) / ZONE_RING_TILES))
}

export function anchorAt(world: NodeWorldPort, tx: number, ty: number): NodeAnchor | null {
  const decor = world.decorAt(tx, ty)
  if (decor) return decor
  if (world.isWater(tx, ty)) return null
  if (world.isTallGrass(tx, ty)) return 'tallGrass'
  const nearWater = world.isWater(tx + 1, ty) || world.isWater(tx - 1, ty) || world.isWater(tx, ty + 1) || world.isWater(tx, ty - 1)
  return nearWater ? 'shore' : null
}

/** O(1) per tile: what a server checks when a player asks to gather at (tx, ty). */
export function nodeAt(world: NodeWorldPort, tx: number, ty: number, nodes: readonly GatheringNodeDefinition[] = GATHERING_NODES): NodePlacement | null {
  const anchor = anchorAt(world, tx, ty)
  if (!anchor || hash2(tx, ty, world.seed + NODE_SALT) >= (ANCHOR_DENSITY[anchor] ?? 0)) return null

  const biome = world.biomeAt(tx + 0.5, ty + 0.5)
  const zone = zoneAt(tx, ty)
  const candidates = nodes.filter(node => node.anchors.includes(anchor) && node.biomes.includes(biome) && node.minZone <= zone)
  if (!candidates.length) return null

  const totalWeight = candidates.reduce((sum, node) => sum + node.spawnWeight, 0)
  let roll = hash2(tx, ty, world.seed + NODE_SALT + 1) * totalWeight
  let picked = candidates[candidates.length - 1]
  for (const node of candidates) {
    roll -= node.spawnWeight
    if (roll < 0) { picked = node; break }
  }
  return { nodeId: `${world.seed}:${tx}:${ty}:${picked.id}`, definitionId: picked.id, tx, ty, zone, biome }
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

/** Tiles within which nodes are highlighted for the player (presentation only). */
export function detectionRadius(detectionBonus: number): number {
  return Math.round(BASE_DETECTION_RADIUS * (1 + Math.min(1, Math.max(0, detectionBonus))))
}
