// Procedural world — WildLands prototype
//
// The world is infinite and derived from a seed. Terrain lives on tile
// *vertices* (dual grid): every tile blends its four corners, which is what
// produces the rounded autotile edges without hand-authored transition tiles.

import {
  biomeAt, decorAt, findSpawn, isSolidDecor as sharedIsSolidDecor, isSolidTile, isWaterTerrain as sharedIsWaterTerrain,
  isWaterTile, T as SHARED_T, tileTerrain, vertexTerrain,
} from '../../../../services/realtime/src/world/terrain.js'

export const TILE = 16

/** Terrain ids, ordered by draw priority (higher overlays lower). */
export const T = SHARED_T
export type Terrain = (typeof T)[keyof typeof T]

export type { Biome, DecorKind } from '../../../../services/realtime/src/world/terrain.js'
import type { Biome, DecorKind } from '../../../../services/realtime/src/world/terrain.js'

export const BIOME_LABEL: Record<Biome, string> = {
  deep: 'Océano profundo',
  ocean: 'Mar',
  beach: 'Playa',
  desert: 'Desierto',
  grassland: 'Pradera',
  forest: 'Bosque',
  tundra: 'Tundra',
}

export function isSolidDecor(kind: DecorKind | null): boolean {
  return sharedIsSolidDecor(kind)
}

export function isWaterTerrain(t: Terrain): boolean {
  return sharedIsWaterTerrain(t)
}

/**
 * One seeded world. The generator itself is shared with the realtime service
 * (WORLD-1, `services/realtime/src/world/terrain.js`), which is how the server
 * knows the same trees, rocks and walkable tiles this class answers for.
 */
export class World {
  readonly seed: number

  constructor(seed: number) {
    this.seed = seed
  }

  /** Biome at a (fractional) vertex coordinate. */
  biomeAt(vx: number, vy: number): Biome {
    return biomeAt(this.seed, vx, vy)
  }

  vertexTerrain(vx: number, vy: number): Terrain {
    return vertexTerrain(this.seed, vx, vy)
  }

  /** Terrain under the centre of a tile (the majority corner wins ties by priority). */
  tileTerrain(tx: number, ty: number): Terrain {
    return tileTerrain(this.seed, tx, ty)
  }

  /**
   * Decoration for a tile. Only placed on tiles whose four corners agree, so
   * props never float over an autotile edge.
   */
  decorAt(tx: number, ty: number, corners?: readonly Terrain[]): DecorKind | null {
    return decorAt(this.seed, tx, ty, corners)
  }

  isSolid(tx: number, ty: number): boolean {
    return isSolidTile(this.seed, tx, ty)
  }

  isWater(tx: number, ty: number): boolean {
    return isWaterTile(this.seed, tx, ty)
  }

  /**
   * Nearest open tile (spiralling out from the origin) in one of the preferred
   * biomes, whose northern neighbour is open too so a return pad fits there.
   * Falls back to any open land.
   */
  findSpawn(prefer: readonly Biome[] = ['desert']): { tx: number; ty: number } {
    return findSpawn(this.seed, prefer)
  }
}
