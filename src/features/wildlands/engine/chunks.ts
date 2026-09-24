// Ground chunks — WildLands prototype
//
// A chunk is 32×32 tiles baked into one bitmap. Baking happens in two passes:
//   1. resolve a terrain id per pixel by blending the tile's corner terrains
//      (dual-grid autotiling, with a little noise so edges look hand-drawn);
//   2. colour each pixel, adding outlines, foam and dune cliff faces by
//      looking at neighbouring ids.
// Water pixels stay transparent: the renderer paints animated water beneath.

import type { ModelPlacement, TownModel } from './townModel'
import { hash2 } from './noise'
import { perfHooks, type ChunkBuildSource } from './perfHooks'
import { packColor, pixelsToCanvas, TRANSPARENT } from './pixels'
import type { Sprite } from './sprite'
import { sampleTexture, terrainArt, TEX } from './terrainArt'
import { T, TILE, type DecorKind, type Terrain, type World } from './world'

export const CHUNK_TILES = 32
export const CHUNK_PX = CHUNK_TILES * TILE
/** 16 one-megabyte canvases cover the active 3×3 population with travel margin. */
export const MAX_CACHED_CHUNKS = 16
/** Start warming the next 3×3 population this many tiles before a boundary. */
export const PREFETCH_EDGE_TILES = 8
const PAD = 3
const SPAN = CHUNK_PX + PAD * 2
const GRID = CHUNK_TILES + 3

/** Measurement context for the next build: set only around idle-callback builds (PERF-1). */
let buildSource: ChunkBuildSource = 'frame'
let buildIdleRemaining: number | null = null
function buildInIdle(source: ChunkBuildSource, deadline: IdleDeadline, build: () => void): void {
  buildSource = source
  buildIdleRemaining = perfHooks.chunks ? deadline.timeRemaining() : null
  try { build() } finally { buildSource = 'frame'; buildIdleRemaining = null }
}

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
  /** Optional source-model placement retained for tooling; gameplay renders the sprite. */
  model?: { model: TownModel; at: ModelPlacement }
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

export interface ChunkMetrics {
  loaded: number
  generated: number
  evicted: number
  lastBuildMs: number
  maxBuildMs: number
}

/** Chunk whose neighbourhood should be warm by the time the player reaches it. */
export function prefetchCenter(tx: number, ty: number): { cx: number; cy: number } {
  const cx = Math.floor(tx / CHUNK_TILES)
  const cy = Math.floor(ty / CHUNK_TILES)
  const localX = tx - cx * CHUNK_TILES
  const localY = ty - cy * CHUNK_TILES
  return {
    cx: cx + (localX < PREFETCH_EDGE_TILES ? -1 : localX >= CHUNK_TILES - PREFETCH_EDGE_TILES ? 1 : 0),
    cy: cy + (localY < PREFETCH_EDGE_TILES ? -1 : localY >= CHUNK_TILES - PREFETCH_EDGE_TILES ? 1 : 0),
  }
}

export class ChunkStore {
  private readonly world: World
  private readonly chunks = new Map<string, Chunk>()
  private readonly removed = new Set<string>()
  private frame = 0
  private idleHandle: number | null = null
  private prefetchCenter = ''
  private prefetchQueue: { cx: number; cy: number }[] = []
  readonly metrics: ChunkMetrics = { loaded: 0, generated: 0, evicted: 0, lastBuildMs: 0, maxBuildMs: 0 }

  constructor(world: World) {
    this.world = world
  }

  get(cx: number, cy: number): Chunk {
    const key = `${cx},${cy}`
    let chunk = this.chunks.get(key)
    if (!chunk) {
      const startedAt = performance.now()
      const { pixels, decor } = buildChunkPixels(this.world, cx, cy)
      chunk = {
        cx, cy,
        canvas: pixelsToCanvas(CHUNK_PX, CHUNK_PX, pixels),
        decor: decor.filter(d => !this.isRemoved(d.tx, d.ty)),
        lastUsed: this.frame,
      }
      this.chunks.set(key, chunk)
      const buildMs = performance.now() - startedAt
      this.metrics.loaded = this.chunks.size
      this.metrics.generated++
      this.metrics.lastBuildMs = buildMs
      this.metrics.maxBuildMs = Math.max(this.metrics.maxBuildMs, buildMs)
      perfHooks.chunks?.built(buildMs, buildSource, buildIdleRemaining)
    }
    chunk.lastUsed = this.frame
    return chunk
  }

  /**
   * Warms the eight chunks around the player's current chunk, one per idle
   * callback. Browsers without requestIdleCallback simply keep the existing
   * synchronous-on-demand behaviour instead of risking movement jank.
   */
  prefetchAround(tx: number, ty: number): void {
    if (typeof requestIdleCallback !== 'function') return
    const { cx, cy } = prefetchCenter(tx, ty)
    const center = `${cx},${cy}`
    if (center === this.prefetchCenter) return
    this.prefetchCenter = center
    this.prefetchQueue = [
      { cx: cx + 1, cy }, { cx: cx - 1, cy }, { cx, cy: cy + 1 }, { cx, cy: cy - 1 },
      { cx: cx + 1, cy: cy + 1 }, { cx: cx - 1, cy: cy + 1 },
      { cx: cx + 1, cy: cy - 1 }, { cx: cx - 1, cy: cy - 1 },
    ].filter(next => !this.chunks.has(`${next.cx},${next.cy}`))
    this.schedulePrefetch()
  }

  /**
   * Prepares the initial 3×3 visible population before the game loop starts.
   * The loading screen remains mounted while each chunk consumes a separate
   * idle window, so cold generation never becomes one giant playable frame.
   */
  async warmAround(tx: number, ty: number): Promise<void> {
    if (typeof requestIdleCallback !== 'function') return
    const cx = Math.floor(tx / CHUNK_TILES)
    const cy = Math.floor(ty / CHUNK_TILES)
    const targets: { cx: number; cy: number }[] = []
    for (let y = cy - 1; y <= cy + 1; y++) {
      for (let x = cx - 1; x <= cx + 1; x++) targets.push({ cx: x, cy: y })
    }
    for (const target of targets) await this.buildWhenIdle(target.cx, target.cy)
  }

  private buildWhenIdle(cx: number, cy: number): Promise<void> {
    if (this.chunks.has(`${cx},${cy}`)) return Promise.resolve()
    return new Promise(resolve => {
      const attempt: IdleRequestCallback = deadline => {
        if (deadline.timeRemaining() < 8 && !deadline.didTimeout) {
          requestIdleCallback(attempt, { timeout: 1000 })
          return
        }
        if (!this.chunks.has(`${cx},${cy}`)) {
          buildInIdle('warm', deadline, () => { this.get(cx, cy).lastUsed = this.frame - 1 })
        }
        resolve()
      }
      requestIdleCallback(attempt, { timeout: 1000 })
    })
  }

  private schedulePrefetch(): void {
    if (this.idleHandle !== null || this.prefetchQueue.length === 0) return
    this.idleHandle = requestIdleCallback(deadline => {
      this.idleHandle = null
      if (deadline.timeRemaining() < 8) {
        this.schedulePrefetch()
        return
      }
      const next = this.prefetchQueue.shift()
      if (next && !this.chunks.has(`${next.cx},${next.cy}`)) {
        // Speculative chunks are the first eviction candidates until rendered.
        buildInIdle('prefetch', deadline, () => { this.get(next.cx, next.cy).lastUsed = this.frame - 1 })
      }
      this.schedulePrefetch()
    })
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

  /** Releases bitmap memory when its world is no longer active. */
  releaseCanvases(): void {
    if (this.idleHandle !== null && typeof cancelIdleCallback === 'function') cancelIdleCallback(this.idleHandle)
    this.idleHandle = null
    this.prefetchQueue.length = 0
    this.prefetchCenter = ''
    perfHooks.chunks?.released(this.chunks.size)
    this.chunks.clear()
    this.metrics.loaded = 0
  }

  /** Advances the usage clock and enforces a per-world LRU memory bound. */
  tick(): void {
    this.frame++
    if (this.chunks.size <= MAX_CACHED_CHUNKS) return
    const oldest = [...this.chunks.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)
    const before = this.chunks.size
    for (let index = 0; this.chunks.size > MAX_CACHED_CHUNKS; index++) {
      this.chunks.delete(oldest[index][0])
      this.metrics.evicted++
    }
    perfHooks.chunks?.evicted(before - this.chunks.size)
    this.metrics.loaded = this.chunks.size
  }
}
