// Baked ground — Rancho
//
// The WildLands chunk baker draws the terrain (grass, paths, sand, water and
// their soft edges) straight from RanchMap. On top of each freshly baked chunk
// the ranch paints its own flat details — flower beds, furrows, the dock, the
// picnic blanket, the plaza mosaic, lily pads — so they cost nothing per frame
// and join seamlessly across chunk borders.
//
// Chunks are baked when they first come into view and dropped once they have
// been off screen for a while, so a long pan does not grow the page forever.

import { buildChunkPixels, CHUNK_PX, CHUNK_TILES } from '../../wildlands/engine/chunks'
import { packColor, pixelsToCanvas } from '../../wildlands/engine/pixels'
import { WATER_TEX, waterFramePixels } from '../../wildlands/engine/terrainArt'
import { paintDecal, paintLily, type PixelSink } from '../art/decalArt'
import type { RanchMap } from '../world/ranchMap'

/** Frames of the water loop; the baker leaves water transparent for this layer. */
const WATER_FRAMES = 8
/** Chunks kept in memory; a phone screen needs about four. */
const MAX_CHUNKS = 24
/** Frames a chunk may stay unused before it is dropped. */
const CHUNK_TTL = 600

interface GroundChunk {
  canvas: HTMLCanvasElement
  lastUsed: number
}

export class RanchGround {
  private readonly map: RanchMap
  private readonly chunks = new Map<string, GroundChunk>()
  private readonly colors = new Map<string, number>()
  private frame = 0
  /** Set while baking, so the pixel sink knows which chunk it is writing to. */
  private target: Uint32Array | null = null
  private originX = 0
  private originY = 0
  private readonly sink: PixelSink
  private readonly water: HTMLCanvasElement[] = []
  private pattern: CanvasPattern | null = null
  private patternFrame = -1

  constructor(map: RanchMap) {
    this.map = map
    this.sink = (x, y, color) => {
      const px = Math.round(x) - this.originX
      const py = Math.round(y) - this.originY
      if (!this.target || px < 0 || py < 0 || px >= CHUNK_PX || py >= CHUNK_PX) return
      let packed = this.colors.get(color)
      if (packed === undefined) {
        packed = packColor(color)
        this.colors.set(color, packed)
      }
      this.target[py * CHUNK_PX + px] = packed
    }
  }

  chunkAt(cx: number, cy: number): HTMLCanvasElement {
    const key = `${cx},${cy}`
    let chunk = this.chunks.get(key)
    if (!chunk) {
      chunk = { canvas: this.bake(cx, cy), lastUsed: this.frame }
      this.chunks.set(key, chunk)
    }
    chunk.lastUsed = this.frame
    return chunk.canvas
  }

  private bake(cx: number, cy: number): HTMLCanvasElement {
    const { pixels } = buildChunkPixels(this.map, cx, cy)
    this.target = pixels
    this.originX = cx * CHUNK_PX
    this.originY = cy * CHUNK_PX
    const tx0 = cx * CHUNK_TILES
    const ty0 = cy * CHUNK_TILES
    const tx1 = tx0 + CHUNK_TILES
    const ty1 = ty0 + CHUNK_TILES
    for (const decal of this.map.decals) {
      if (decal.at.x1 < tx0 || decal.at.x0 >= tx1 || decal.at.y1 < ty0 || decal.at.y0 >= ty1) continue
      paintDecal(this.sink, decal)
    }
    for (const lily of this.map.lilies) {
      if (lily.tx < tx0 || lily.tx >= tx1 || lily.ty < ty0 || lily.ty >= ty1) continue
      paintLily(this.sink, lily.tx, lily.ty, lily.seed)
    }
    this.target = null
    return pixelsToCanvas(CHUNK_PX, CHUNK_PX, pixels)
  }

  /**
   * Paints the animated water first — chunks leave water transparent, exactly
   * as WildLands' baker does — and then every chunk touching the view.
   */
  draw(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, frame: number): void {
    if (!this.water.length) {
      for (let i = 0; i < WATER_FRAMES; i++) {
        this.water.push(pixelsToCanvas(WATER_TEX, WATER_TEX, waterFramePixels(i, WATER_FRAMES)))
      }
    }
    const index = ((frame % WATER_FRAMES) + WATER_FRAMES) % WATER_FRAMES
    if (index !== this.patternFrame || !this.pattern) {
      this.pattern = ctx.createPattern(this.water[index], 'repeat')
      this.patternFrame = index
    }
    if (this.pattern) {
      // The pattern lives in world space, so it tiles seamlessly as the view moves.
      ctx.fillStyle = this.pattern
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
    }
    const cx0 = Math.floor(x0 / CHUNK_PX)
    const cy0 = Math.floor(y0 / CHUNK_PX)
    const cx1 = Math.floor(x1 / CHUNK_PX)
    const cy1 = Math.floor(y1 / CHUNK_PX)
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        ctx.drawImage(this.chunkAt(cx, cy), cx * CHUNK_PX, cy * CHUNK_PX)
      }
    }
  }

  /** Advances the usage clock and drops chunks that have been off screen. */
  tick(): void {
    this.frame++
    if (this.chunks.size <= MAX_CHUNKS) return
    for (const [key, chunk] of this.chunks) {
      if (this.frame - chunk.lastUsed > CHUNK_TTL) this.chunks.delete(key)
    }
  }

  get size(): number {
    return this.chunks.size
  }
}
