// Procedural world — WildLands prototype
//
// The world is infinite and derived from a seed. Terrain lives on tile
// *vertices* (dual grid): every tile blends its four corners, which is what
// produces the rounded autotile edges without hand-authored transition tiles.

import { fbm, hash2 } from './noise'

export const TILE = 16

/** Terrain ids, ordered by draw priority (higher overlays lower). */
export const T = {
  DEEP: 0,
  WATER: 1,
  SAND: 2,
  GRASS: 3,
  DUNE: 4,
  TALL: 5,
  SNOW: 6,
} as const
export type Terrain = (typeof T)[keyof typeof T]

export type Biome = 'deep' | 'ocean' | 'beach' | 'desert' | 'grassland' | 'forest' | 'tundra'

export const BIOME_LABEL: Record<Biome, string> = {
  deep: 'Océano profundo',
  ocean: 'Mar',
  beach: 'Playa',
  desert: 'Desierto',
  grassland: 'Pradera',
  forest: 'Bosque',
  tundra: 'Tundra',
}

export type DecorKind =
  | 'cactus' | 'rock' | 'boulder' | 'drybush' | 'tree' | 'pine' | 'snowpine'
  | 'bush' | 'palm' | 'icerock' | 'searock' | 'coral' | 'shell' | 'crystal'

const SOLID_DECOR = new Set<DecorKind>([
  'cactus', 'rock', 'boulder', 'drybush', 'tree', 'pine', 'snowpine', 'bush', 'palm', 'icerock', 'searock',
])

export function isSolidDecor(kind: DecorKind | null): boolean {
  return kind !== null && SOLID_DECOR.has(kind)
}

export function isWaterTerrain(t: Terrain): boolean {
  return t === T.DEEP || t === T.WATER
}

export class World {
  readonly seed: number

  constructor(seed: number) {
    this.seed = seed
  }

  /** Biome at a (fractional) vertex coordinate. */
  biomeAt(vx: number, vy: number): Biome {
    const s = this.seed
    const elev = fbm(vx / 70, vy / 70, s, 5)
    if (elev < 0.25) return 'deep'
    if (elev < 0.37) return 'ocean'
    if (elev < 0.395) return 'beach'
    const temp = fbm(vx / 220, vy / 220, s + 7, 3)
    const moist = fbm(vx / 160, vy / 160, s + 13, 3)
    if (temp > 0.5 && moist < 0.6) return 'desert'
    if (temp < 0.28) return 'tundra'
    if (moist > 0.64) return 'forest'
    return 'grassland'
  }

  vertexTerrain(vx: number, vy: number): Terrain {
    const biome = this.biomeAt(vx, vy)
    switch (biome) {
      case 'deep': return T.DEEP
      case 'ocean': return T.WATER
      case 'beach': return T.SAND
      case 'tundra': return T.SNOW
      case 'desert':
        return fbm(vx / 11, vy / 11, this.seed + 29, 3) > 0.62 ? T.DUNE : T.SAND
      default:
        return fbm(vx / 9, vy / 9, this.seed + 31, 3) > 0.64 ? T.TALL : T.GRASS
    }
  }

  /** Terrain under the centre of a tile (the majority corner wins ties by priority). */
  tileTerrain(tx: number, ty: number): Terrain {
    return this.vertexTerrain(tx + 0.5, ty + 0.5)
  }

  /**
   * Decoration for a tile. Only placed on tiles whose four corners agree, so
   * props never float over an autotile edge.
   */
  decorAt(tx: number, ty: number, corners?: readonly Terrain[]): DecorKind | null {
    const c = corners ?? [
      this.vertexTerrain(tx, ty), this.vertexTerrain(tx + 1, ty),
      this.vertexTerrain(tx + 1, ty + 1), this.vertexTerrain(tx, ty + 1),
    ]
    const t = c[0]
    if (c[1] !== t || c[2] !== t || c[3] !== t) return null
    const r = hash2(tx, ty, this.seed + 101)
    const pick = hash2(tx, ty, this.seed + 202)
    const biome = this.biomeAt(tx + 0.5, ty + 0.5)

    if (t === T.DEEP) return r < 0.004 ? 'searock' : null
    if (t === T.WATER) return r < 0.014 ? 'coral' : r < 0.018 ? 'searock' : null
    if (t === T.DUNE) return r < 0.012 ? 'rock' : null
    if (t === T.TALL) return null
    if (t === T.SNOW) {
      if (r < 0.07) return 'snowpine'
      if (r < 0.09) return 'icerock'
      return r < 0.093 ? 'crystal' : null
    }
    if (t === T.SAND && biome === 'beach') {
      if (r < 0.025) return 'palm'
      return r < 0.045 ? 'shell' : null
    }
    if (t === T.SAND) {
      if (r < 0.022) return 'cactus'
      if (r < 0.034) return 'rock'
      if (r < 0.04) return 'boulder'
      if (r < 0.048) return 'drybush'
      return r < 0.0495 ? 'crystal' : null
    }
    // Grass
    if (biome === 'forest') {
      if (r < 0.26) return pick < 0.5 ? 'pine' : 'tree'
      return r < 0.31 ? 'bush' : null
    }
    if (r < 0.03) return 'tree'
    if (r < 0.06) return 'bush'
    if (r < 0.075) return 'rock'
    return r < 0.078 ? 'crystal' : null
  }

  isSolid(tx: number, ty: number): boolean {
    return isSolidDecor(this.decorAt(tx, ty))
  }

  isWater(tx: number, ty: number): boolean {
    return isWaterTerrain(this.tileTerrain(tx, ty))
  }

  private isOpenLand(tx: number, ty: number): boolean {
    return !this.isWater(tx, ty) && !this.isSolid(tx, ty)
  }

  /**
   * Nearest open tile (spiralling out from the origin) in one of the preferred
   * biomes, whose northern neighbour is open too so a return pad fits there.
   * Falls back to any open land.
   */
  findSpawn(prefer: readonly Biome[] = ['desert']): { tx: number; ty: number } {
    let fallback: { tx: number; ty: number } | null = null
    for (let radius = 0; radius < 400; radius += 3) {
      const steps = Math.max(1, Math.ceil((radius * 2 * Math.PI) / 3))
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2
        const tx = Math.round(Math.cos(a) * radius)
        const ty = Math.round(Math.sin(a) * radius)
        if (!this.isOpenLand(tx, ty) || !this.isOpenLand(tx, ty - 1)) continue
        const biome = this.biomeAt(tx + 0.5, ty + 0.5)
        if (prefer.includes(biome) && this.tileTerrain(tx, ty) !== T.TALL) return { tx, ty }
        if (!fallback && biome !== 'beach') fallback = { tx, ty }
      }
      if (fallback && radius > 200) return fallback
    }
    return fallback ?? { tx: 0, ty: 0 }
  }
}
