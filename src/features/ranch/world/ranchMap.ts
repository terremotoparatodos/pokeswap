// Ranch map — Rancho
//
// Rasterises ranchLayout.ts into the grids everything else reads: terrain per
// tile corner (for the WildLands chunk baker), water, paths, solidity, zones
// and decor. Built once at load; pure data, no canvas.

import type { ChunkSource } from '../../wildlands/engine/chunks'
import { fbm, hash2 } from '../../wildlands/engine/noise'
import { T, type DecorKind, type Terrain } from '../../wildlands/engine/world'
import { ZONE_IDS, type ZoneId } from '../domain/zones'
import {
  ACCENT_BUSHES, ACCENT_TREES, CAMPFIRE_CLEARING, DECALS, ENTRANCE, FOREST_CLEARING, INTERIOR, ISLAND, LAKE,
  LAKE_ZONE_REACH, MAP_H, MAP_W, PADDOCKS, PATHS, PLAZA, POND, PROPS, ZONE_REGIONS,
  type DecalDef, type Ellipse, type PropDef, type Pt, type TileRect,
} from './ranchLayout'

export const RANCH_SEED = 1717

/** Decor kinds the ranch uses, stored as small ints in the decor grid. */
export const DECOR_KINDS = ['tree', 'pine', 'bush', 'rock', 'boulder'] as const satisfies readonly DecorKind[]
export type RanchDecor = (typeof DECOR_KINDS)[number]

const within = (r: TileRect, x: number, y: number) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1

function segmentDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy || 1
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
}

/** How far a point is inside a path, in tiles (positive = on the path). */
function pathCover(x: number, y: number): number {
  let best = -Infinity
  for (const path of PATHS) {
    for (let i = 1; i < path.points.length; i++) {
      best = Math.max(best, path.half - segmentDistance({ x, y }, path.points[i - 1], path.points[i]))
    }
  }
  return Math.max(best, PLAZA.r - Math.hypot(x - PLAZA.x, y - PLAZA.y))
}

/** Normalised ellipse distance with a wobbly shoreline (1 = shore). */
function ellipseDistance(e: Ellipse, x: number, y: number, salt: number): number {
  const d = ((x - e.cx) / e.rx) ** 2 + ((y - e.cy) / e.ry) ** 2
  return d + (fbm(x / 5, y / 5, RANCH_SEED + salt, 3) - 0.5) * 0.35
}

export const lakeDistance = (x: number, y: number) => ellipseDistance(LAKE, x, y, 3)
const pondDistance = (x: number, y: number) => ellipseDistance(POND, x, y, 5)

/** Inside the ranch (not the surrounding forest belt). */
export function isInterior(x: number, y: number): boolean {
  if (x >= ENTRANCE.x0 && x <= ENTRANCE.x1 + 1 && y >= ENTRANCE.y0) return true
  const { x0, y0, x1, y1, radius } = INTERIOR
  const cx = Math.max(x0 + radius, Math.min(x1 - radius, x))
  const cy = Math.max(y0 + radius, Math.min(y1 - radius, y))
  const d = Math.hypot(x - cx, y - cy) - radius
  return d + (fbm(x / 6, y / 6, RANCH_SEED + 71, 3) - 0.5) * 3 < 0
}

const inPaddock = (x: number, y: number) => PADDOCKS.some(p => x > p.x0 && x < p.x1 && y > p.y0 && y < p.y1)
const regionOf = (x: number, y: number) => ZONE_REGIONS.find(([, r]) => within(r, x, y))?.[0] ?? null

function vertexTerrainAt(vx: number, vy: number): Terrain {
  if (!isInterior(vx, vy)) return fbm(vx / 4, vy / 4, RANCH_SEED + 9, 3) > 0.46 ? T.TALL : T.GRASS
  if (Math.hypot(vx - ISLAND.x, vy - ISLAND.y) < ISLAND.r) return T.GRASS
  const lake = lakeDistance(vx, vy)
  if (lake < 0.5) return T.DEEP
  if (lake < 1) return T.WATER
  const pond = pondDistance(vx, vy)
  if (pond < 0.45) return T.DEEP
  if (pond < 1) return T.WATER
  const cover = pathCover(vx, vy)
  if (cover >= 0) return T.SAND
  if (Math.hypot(vx - CAMPFIRE_CLEARING.x, vy - CAMPFIRE_CLEARING.y) < CAMPFIRE_CLEARING.r) return T.SAND
  if (lake < 1.45 && vx < LAKE.cx + 3 && vy > LAKE.cy + 1) return T.SAND // beach
  if (inPaddock(vx, vy)) return fbm(vx / 4, vy / 4, RANCH_SEED + 31, 3) > 0.53 ? T.SAND : T.GRASS
  const region = regionOf(vx, vy)
  if (region === 'rocas' && fbm(vx / 6, vy / 6, RANCH_SEED + 21, 3) > 0.57) return T.SAND
  if ((region === 'bosque' || region === null || region === 'descanso') && cover < -1.5) {
    if (fbm(vx / 7, vy / 7, RANCH_SEED + 11, 3) > 0.62) return T.TALL
  }
  return T.GRASS
}

export interface PlacedProp extends PropDef {
  /** Feet of the sprite in world pixels: bottom centre of the footprint. */
  x: number
  y: number
}

const PATH_MARGIN_FOR_TREES = 1.2

export class RanchMap implements ChunkSource {
  readonly seed = RANCH_SEED
  readonly w = MAP_W
  readonly h = MAP_H
  private readonly vertices: Uint8Array
  readonly water: Uint8Array
  readonly path: Uint8Array
  readonly solid: Uint8Array
  /** Walkable tiles that must not become homes (soil, dock, blanket, doormat…). */
  readonly reserved: Uint8Array
  readonly fence: Uint8Array
  /** Index into ZONE_IDS, or -1 (forest belt). */
  readonly zones: Int8Array
  /** Index into DECOR_KINDS, or -1. */
  readonly decor: Int8Array
  readonly props: PlacedProp[]
  readonly decals: readonly DecalDef[] = DECALS
  /** Water tiles carrying a lily pad (painted into the ground). */
  readonly lilies: { tx: number; ty: number; seed: number }[] = []

  constructor() {
    const { w, h } = this
    const n = w * h
    this.vertices = new Uint8Array((w + 1) * (h + 1))
    for (let vy = 0; vy <= h; vy++) {
      for (let vx = 0; vx <= w; vx++) this.vertices[vy * (w + 1) + vx] = vertexTerrainAt(vx, vy)
    }
    this.water = new Uint8Array(n)
    this.path = new Uint8Array(n)
    this.solid = new Uint8Array(n)
    this.reserved = new Uint8Array(n)
    this.fence = new Uint8Array(n)
    this.zones = new Int8Array(n).fill(-1)
    this.decor = new Int8Array(n).fill(-1)
    this.props = PROPS.map(p => ({
      ...p,
      x: ((p.at.x0 + p.at.x1 + 1) / 2) * 16,
      y: (p.at.y1 + 1) * 16 - 1,
    }))
    this.rasterise()
  }

  private rasterise(): void {
    const { w, h } = this
    const blocked = new Uint8Array(w * h) // no decor here
    for (let ty = 0; ty < h; ty++) {
      for (let tx = 0; tx < w; tx++) {
        const i = ty * w + tx
        const corners = [this.vertexTerrain(tx, ty), this.vertexTerrain(tx + 1, ty), this.vertexTerrain(tx + 1, ty + 1), this.vertexTerrain(tx, ty + 1)]
        if (corners.filter(c => c === T.WATER || c === T.DEEP).length >= 2) this.water[i] = 1
        const cx = tx + 0.5
        const cy = ty + 0.5
        const cover = pathCover(cx, cy)
        if (cover >= -0.25) this.path[i] = 1
        if (cover >= -PATH_MARGIN_FOR_TREES) blocked[i] = 1
        this.zones[i] = this.zoneFor(cx, cy)
      }
    }
    // Paddock fences, minus the gates.
    for (const p of PADDOCKS) {
      for (let x = p.x0; x <= p.x1; x++) {
        for (let y = p.y0; y <= p.y1; y++) {
          const edge = x === p.x0 || x === p.x1 || y === p.y0 || y === p.y1
          if (!edge || p.gates.some(g => g.x === x && g.y === y)) continue
          this.fence[y * w + x] = 1
          this.solid[y * w + x] = 1
        }
      }
      for (let x = p.x0; x <= p.x1; x++) for (let y = p.y0; y <= p.y1; y++) blocked[y * w + x] = 1
    }
    for (const prop of this.props) {
      const { x0, y0, x1, y1 } = prop.at
      for (let y = y0 - 1; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (!this.inside(x, y)) continue
          blocked[y * w + x] = 1
          const blocks = prop.solid ? prop.solid.some(t => t.x === x && t.y === y) : y >= y0
          if (blocks && !prop.walkable) this.solid[y * w + x] = 1
          if (y >= y0) this.reserved[y * w + x] = 1
        }
      }
    }
    for (const decal of this.decals) {
      const { x0, y0, x1, y1 } = decal.at
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = y * w + x
          blocked[i] = 1
          if (decal.kind === 'flowerBed') this.solid[i] = 1
          else if (decal.kind === 'dock') {
            this.water[i] = 0
            this.reserved[i] = 1
          } else if (decal.kind !== 'boat') this.reserved[i] = 1
        }
      }
    }
    this.scatterShore(blocked)
    const clearings = [FOREST_CLEARING, CAMPFIRE_CLEARING]
    for (let ty = 0; ty < h; ty++) {
      for (let tx = 0; tx < w; tx++) {
        const i = ty * w + tx
        if (this.water[i] || blocked[i]) continue
        if (clearings.some(c => Math.hypot(tx + 0.5 - c.x, ty + 0.5 - c.y) < c.r + 0.5)) continue
        const kind = this.naturalDecor(tx, ty)
        if (kind) this.decor[i] = DECOR_KINDS.indexOf(kind)
      }
    }
    for (const t of ACCENT_TREES) this.decor[t.y * w + t.x] = DECOR_KINDS.indexOf('tree')
    for (const b of ACCENT_BUSHES) this.decor[b.y * w + b.x] = DECOR_KINDS.indexOf('bush')
    for (let i = 0; i < w * h; i++) {
      if (this.water[i] || this.decor[i] >= 0) this.solid[i] = 1
    }
  }

  /** Reeds along grassy shores and lily pads on shallow water. */
  private scatterShore(blocked: Uint8Array): void {
    const { w, h } = this
    for (let ty = 1; ty < h - 1; ty++) {
      for (let tx = 1; tx < w - 1; tx++) {
        const i = ty * w + tx
        const seed = hash2(tx, ty, RANCH_SEED + 83)
        if (this.water[i]) {
          const shallow = [0, 1].every(dy => [0, 1].every(dx => this.vertexTerrain(tx + dx, ty + dy) === T.WATER))
          if (shallow && seed < 0.07) this.lilies.push({ tx, ty, seed: hash2(tx, ty, RANCH_SEED + 84) })
          continue
        }
        if (blocked[i] || this.path[i] || !isInterior(tx + 0.5, ty + 0.5)) continue
        const shore = this.water[i - 1] || this.water[i + 1] || this.water[i - w] || this.water[i + w]
        const sandy = [0, 1].some(dy => [0, 1].some(dx => this.vertexTerrain(tx + dx, ty + dy) === T.SAND))
        if (!shore || sandy || seed > 0.22) continue
        this.props.push({ kind: 'reeds', at: { x0: tx, y0: ty, x1: tx, y1: ty }, walkable: true, x: tx * 16 + 8, y: ty * 16 + 15 })
        blocked[i] = 1
      }
    }
  }

  private zoneFor(x: number, y: number): number {
    if (!isInterior(x, y)) return -1
    let zone: ZoneId
    if (inPaddock(x, y)) zone = 'corrales'
    else if (within(ZONE_REGIONS[0][1], x, y)) zone = 'casa'
    else if (lakeDistance(x, y) <= LAKE_ZONE_REACH) zone = 'lago'
    else zone = regionOf(x, y) ?? 'prado'
    return ZONE_IDS.indexOf(zone)
  }

  /** Forest, rocks and scattered bushes, from hashes: same map on every load. */
  private naturalDecor(tx: number, ty: number): RanchDecor | null {
    const x = tx + 0.5
    const y = ty + 0.5
    const h1 = hash2(tx, ty, RANCH_SEED + 41)
    const checker = (tx + ty) % 2 === 0
    if (!isInterior(x, y)) {
      if (checker) return h1 < 0.8 ? 'pine' : h1 < 0.95 ? 'tree' : null
      return h1 < 0.1 ? 'bush' : null
    }
    const region = regionOf(x, y)
    if (region === 'bosque') {
      if (checker && fbm(tx / 5, ty / 5, RANCH_SEED + 43, 3) > 0.47 && h1 < 0.85) return h1 < 0.6 ? 'pine' : 'tree'
      return h1 < 0.025 ? 'bush' : h1 < 0.035 ? 'rock' : null
    }
    if (region === 'rocas') {
      if (h1 < 0.04) return 'boulder'
      if (h1 < 0.1) return 'rock'
      if (checker && fbm(tx / 6, ty / 6, RANCH_SEED + 61, 3) > 0.68 && h1 < 0.6) return 'pine'
      return null
    }
    const lake = lakeDistance(x, y)
    if (lake > 1.6 && lake < 2.4 && y < LAKE.cy && checker && h1 < 0.4) return 'pine'
    // Hedges frame the garden to the north and south, with gaps to walk through.
    if ((ty === 43 || ty === 62) && tx >= 5 && tx <= 30 && tx % 7 !== 3) return 'bush'
    if (region === 'descanso' && (tx < 9 || ty > 82) && checker && h1 < 0.5) return 'tree'
    return h1 < 0.012 ? 'bush' : null
  }

  inside(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h
  }

  vertexTerrain(vx: number, vy: number): Terrain {
    if (vx < 0 || vy < 0 || vx > this.w || vy > this.h) return T.GRASS
    return this.vertices[vy * (this.w + 1) + vx] as Terrain
  }

  decorAt(tx: number, ty: number): DecorKind | null {
    if (!this.inside(tx, ty)) {
      // Beyond the edge the forest simply continues.
      if ((tx + ty) % 2 !== 0) return null
      return hash2(tx, ty, RANCH_SEED + 41) < 0.85 ? 'pine' : 'tree'
    }
    const d = this.decor[ty * this.w + tx]
    return d >= 0 ? DECOR_KINDS[d] : null
  }

  isSolid(tx: number, ty: number): boolean {
    return !this.inside(tx, ty) || this.solid[ty * this.w + tx] === 1
  }

  isPath(tx: number, ty: number): boolean {
    return this.inside(tx, ty) && this.path[ty * this.w + tx] === 1
  }

  zoneAt(tx: number, ty: number): ZoneId | null {
    if (!this.inside(tx, ty)) return null
    const z = this.zones[ty * this.w + tx]
    return z >= 0 ? ZONE_IDS[z] : null
  }

  /** Whether an inhabitant may stand here at all (its own zone is checked by the caller). */
  isHabitable(tx: number, ty: number): boolean {
    if (!this.inside(tx, ty)) return false
    const i = ty * this.w + tx
    return !this.solid[i] && !this.path[i]
  }

  get pixelWidth(): number {
    return this.w * 16
  }

  get pixelHeight(): number {
    return this.h * 16
  }
}
