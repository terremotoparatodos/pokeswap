// Ground chunks — WildLands prototype
//
// A chunk is 32×32 tiles baked into one bitmap. Baking happens in two passes:
//   1. resolve a terrain id per pixel by blending the tile's corner terrains
//      (dual-grid autotiling, with a little noise so edges look hand-drawn);
//   2. colour each pixel, adding outlines, foam and dune cliff faces by
//      looking at neighbouring ids.
// Water pixels stay transparent: the renderer paints animated water beneath.

import { hash2 } from './noise'
import { packColor, pixelsToCanvas, TRANSPARENT } from './pixels'
import type { Sprite } from './sprite'
import { sampleTexture, terrainArt, TEX } from './terrainArt'
import { T, TILE, type DecorKind, type Terrain, type World } from './world'

export const CHUNK_TILES = 32
export const CHUNK_PX = CHUNK_TILES * TILE
const PAD = 3
const SPAN = CHUNK_PX + PAD * 2
const GRID = CHUNK_TILES + 3

export interface DecorInstance {
  /** Wild prop kind; null when the area supplies its own `sprite`. */
  kind: DecorKind | null
  sprite?: Sprite
  /** Emits light at night (street lamps). */
  light?: boolean
  tx: number
  ty: number
  /** Feet position in world pixels. */
  x: number
  y: number
  seed: number
}

export interface ChunkPixels {
  pixels: Uint32Array
  decor: DecorInstance[]
}

const EDGE: Record<number, number> = {
  [T.SAND]: packColor('#c9a765'),
  [T.GRASS]: packColor('#4a8f37'),
  [T.DUNE]: packColor('#8c521d'),
  [T.TALL]: packColor('#23602d'),
  [T.SNOW]: packColor('#b3c7df'),
}
const DUNE_EDGE_INNER = packColor('#c07a2c')
const DUNE_FACE = [packColor('#a4672a'), packColor('#bf8235'), packColor('#d49a47')]
const SAND_SHADOW = packColor('#d6b87a')
const GRASS_SHADOW = packColor('#579f40')
const FOAM_NEAR = packColor('#ffffff', 190)
const FOAM_FAR = packColor('#e4f3ff', 80)
const DEEP = packColor('#0b1f7a', 120)
const DEEP_SOFT = packColor('#0b1f7a', 60)

/** Corner terrains for every vertex touching the chunk (plus a one-tile border). */
function cornerGrid(world: World, tx0: number, ty0: number): Uint8Array {
  const grid = new Uint8Array(GRID * GRID)
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) grid[gy * GRID + gx] = world.vertexTerrain(tx0 - 1 + gx, ty0 - 1 + gy)
  }
  return grid
}

/** Pass 1: terrain id for every pixel of the padded chunk area. */
export function resolveTerrainIds(grid: Uint8Array, cx: number, cy: number, jitter: Float32Array): Uint8Array {
  const ids = new Uint8Array(SPAN * SPAN)
  const ox = cx * CHUNK_PX - PAD
  const oy = cy * CHUNK_PX - PAD
  const distinct = [0, 0, 0, 0]

  for (let ty = -1; ty <= CHUNK_TILES; ty++) {
    for (let tx = -1; tx <= CHUNK_TILES; tx++) {
      const g = (ty + 1) * GRID + (tx + 1)
      const tl = grid[g], tr = grid[g + 1], bl = grid[g + GRID], br = grid[g + GRID + 1]
      const px0 = Math.max(0, tx * TILE + PAD), px1 = Math.min(SPAN, (tx + 1) * TILE + PAD)
      const py0 = Math.max(0, ty * TILE + PAD), py1 = Math.min(SPAN, (ty + 1) * TILE + PAD)
      if (px0 >= px1 || py0 >= py1) continue

      if (tl === tr && tl === bl && tl === br) {
        for (let py = py0; py < py1; py++) ids.fill(tl, py * SPAN + px0, py * SPAN + px1)
        continue
      }

      let count = 0
      for (const c of [tl, tr, br, bl]) if (!distinct.slice(0, count).includes(c)) distinct[count++] = c
      const sorted = distinct.slice(0, count).sort((a, b) => a - b)

      for (let py = py0; py < py1; py++) {
        const wy = oy + py
        const v = (wy - (cy * CHUNK_TILES + ty) * TILE + 0.5) / TILE
        for (let px = px0; px < px1; px++) {
          const wx = ox + px
          const u = (wx - (cx * CHUNK_TILES + tx) * TILE + 0.5) / TILE
          const j = jitter[(wy & (TEX - 1)) * TEX + (wx & (TEX - 1))]
          let id = sorted[0]
          for (let k = 1; k < sorted.length; k++) {
            const layer = sorted[k]
            const field =
              (tl >= layer ? (1 - u) * (1 - v) : 0) + (tr >= layer ? u * (1 - v) : 0) +
              (br >= layer ? u * v : 0) + (bl >= layer ? (1 - u) * v : 0)
            if (field + j <= 0.5) break
            id = layer
          }
          ids[py * SPAN + px] = id
        }
      }
    }
  }
  return ids
}

/** Pass 2: final colours for the unpadded chunk. */
function colourise(ids: Uint8Array, cx: number, cy: number): Uint32Array {
  const { textures } = terrainArt()
  const out = new Uint32Array(CHUNK_PX * CHUNK_PX)
  const ox = cx * CHUNK_PX - PAD
  const oy = cy * CHUNK_PX - PAD
  const S = SPAN

  for (let py = PAD; py < PAD + CHUNK_PX; py++) {
    for (let px = PAD; px < PAD + CHUNK_PX; px++) {
      const i = py * S + px
      const id = ids[i] as Terrain
      const up = ids[i - S], down = ids[i + S], left = ids[i - 1], right = ids[i + 1]
      const minN = Math.min(up, down, left, right)
      let col: number

      if (id <= T.WATER) {
        const landNear = Math.max(up, down, left, right) >= T.SAND
        const landFar = !landNear && Math.max(ids[i - 2 * S], ids[i + 2 * S], ids[i - 2], ids[i + 2],
          ids[i - S - 1], ids[i - S + 1], ids[i + S - 1], ids[i + S + 1]) >= T.SAND
        if (landNear) col = FOAM_NEAR
        else if (landFar) col = FOAM_FAR
        else if (id === T.DEEP) col = Math.max(up, down, left, right) === T.WATER ? DEEP_SOFT : DEEP
        else col = TRANSPARENT
      } else if (minN < id) {
        col = EDGE[id]
      } else if (id === T.DUNE && Math.min(ids[i - 2 * S], ids[i + 2 * S], ids[i - 2], ids[i + 2]) < T.DUNE) {
        col = DUNE_EDGE_INNER
      } else {
        col = sampleTexture(textures[id], ox + px, oy + py)
        if (id < T.DUNE) {
          for (let k = 1; k <= 3; k++) {
            if (ids[i - k * S] === T.DUNE) { col = DUNE_FACE[k - 1]; break }
          }
        }
        if (id === T.SAND && up >= T.GRASS && up !== T.DUNE) col = SAND_SHADOW
        if (id === T.GRASS && up === T.TALL) col = GRASS_SHADOW
      }
      out[(py - PAD) * CHUNK_PX + (px - PAD)] = col
    }
  }
  return out
}

export function buildChunkPixels(world: World, cx: number, cy: number): ChunkPixels {
  const tx0 = cx * CHUNK_TILES
  const ty0 = cy * CHUNK_TILES
  const grid = cornerGrid(world, tx0, ty0)
  const ids = resolveTerrainIds(grid, cx, cy, terrainArt().jitter)
  const decor: DecorInstance[] = []

  for (let ty = 0; ty < CHUNK_TILES; ty++) {
    for (let tx = 0; tx < CHUNK_TILES; tx++) {
      const g = (ty + 1) * GRID + (tx + 1)
      const corners = [grid[g], grid[g + 1], grid[g + GRID + 1], grid[g + GRID]] as Terrain[]
      const kind = world.decorAt(tx0 + tx, ty0 + ty, corners)
      if (!kind) continue
      const seed = hash2(tx0 + tx, ty0 + ty, world.seed + 7)
      decor.push({
        kind, tx: tx0 + tx, ty: ty0 + ty, seed,
        // Small offsets break up the grid without leaving the tile.
        x: (tx0 + tx) * TILE + 8 + Math.round((seed - 0.5) * 4),
        y: (ty0 + ty) * TILE + 13,
      })
    }
  }
  return { pixels: colourise(ids, cx, cy), decor }
}

export interface Chunk {
  cx: number
  cy: number
  canvas: HTMLCanvasElement
  decor: DecorInstance[]
  lastUsed: number
}

export class ChunkStore {
  private readonly world: World
  private readonly chunks = new Map<string, Chunk>()
  private readonly removed = new Set<string>()
  private frame = 0

  constructor(world: World) {
    this.world = world
  }

  get(cx: number, cy: number): Chunk {
    const key = `${cx},${cy}`
    let chunk = this.chunks.get(key)
    if (!chunk) {
      const { pixels, decor } = buildChunkPixels(this.world, cx, cy)
      chunk = {
        cx, cy,
        canvas: pixelsToCanvas(CHUNK_PX, CHUNK_PX, pixels),
        decor: decor.filter(d => !this.isRemoved(d.tx, d.ty)),
        lastUsed: this.frame,
      }
      this.chunks.set(key, chunk)
    }
    chunk.lastUsed = this.frame
    return chunk
  }

  /** Removes a collected decor item (cosmetic, session-only). */
  removeDecor(tx: number, ty: number): void {
    this.removed.add(`${tx},${ty}`)
    const cx = Math.floor(tx / CHUNK_TILES), cy = Math.floor(ty / CHUNK_TILES)
    const chunk = this.chunks.get(`${cx},${cy}`)
    if (chunk) chunk.decor = chunk.decor.filter(d => d.tx !== tx || d.ty !== ty)
  }

  isRemoved(tx: number, ty: number): boolean {
    return this.removed.has(`${tx},${ty}`)
  }

  /** Advances the usage clock and evicts chunks unused for a while. */
  tick(): void {
    this.frame++
    if (this.chunks.size <= 48) return
    for (const [key, chunk] of this.chunks) {
      if (this.frame - chunk.lastUsed > 240) this.chunks.delete(key)
    }
  }
}
