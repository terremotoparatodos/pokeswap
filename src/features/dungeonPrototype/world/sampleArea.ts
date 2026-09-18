// A slice of real WildLands, for the comparison tool (D1.2.1 §16).
//
// This is the overworld's own generator — `engine/world.ts` and its chunk
// baker — wrapped as an `Area` so the DEV comparison can put a stretch of
// Pradera next to a dungeon floor, in the same viewport, with the same player
// and the same camera, and answer one question: do they look like the same game?
//
// It is a development aid. It is not the product's Pradera (that lives in
// `wildlands/areas/`, which the prototype does not touch) — it is the same
// terrain generator asked for a sample.

import type { Arrival, Area, AreaId, Populace, Portal } from '../../wildlands/engine/area'
import { weatherAt } from '../../wildlands/engine/atmosphere'
import { CHUNK_PX, ChunkStore, type DecorInstance } from '../../wildlands/engine/chunks'
import { paintMinimap } from '../../wildlands/engine/minimap'
import { BIOME_LABEL, TILE, World } from '../../wildlands/engine/world'

const EMPTY: Populace = { actors: [], update: () => {} }

export class SampleArea implements Area {
  readonly kind = 'wild' as const
  readonly id: AreaId
  readonly name = 'WildLands · muestra'
  readonly lens = 'handheld' as const
  readonly portals: readonly Portal[] = []
  readonly world: World
  private readonly chunks: ChunkStore
  private readonly start: Arrival

  constructor(seed: number) {
    this.id = `sample-${seed}`
    this.world = new World(seed)
    this.chunks = new ChunkStore(this.world)
    this.start = { ...this.world.findSpawn(['grassland', 'forest']), dir: 'down' }
  }

  arrival(): Arrival {
    return this.start
  }

  isSolid(tx: number, ty: number): boolean {
    return this.world.isSolid(tx, ty)
  }

  isWater(tx: number, ty: number): boolean {
    return this.world.isWater(tx, ty)
  }

  placeName(tx: number, ty: number): string {
    return BIOME_LABEL[this.world.biomeAt(tx + 0.5, ty + 0.5)]
  }

  drawGround(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
    for (let cy = Math.floor(y0 / CHUNK_PX); cy <= Math.floor((y1 - 1) / CHUNK_PX); cy++) {
      for (let cx = Math.floor(x0 / CHUNK_PX); cx <= Math.floor((x1 - 1) / CHUNK_PX); cx++) {
        g.drawImage(this.chunks.get(cx, cy).canvas, cx * CHUNK_PX - x0, cy * CHUNK_PX - y0)
      }
    }
  }

  decorIn(x0: number, y0: number, x1: number, y1: number): readonly DecorInstance[] {
    const out: DecorInstance[] = []
    for (let cy = Math.floor(y0 / CHUNK_PX); cy <= Math.floor((y1 + TILE * 4) / CHUNK_PX); cy++) {
      for (let cx = Math.floor(x0 / CHUNK_PX); cx <= Math.floor((x1 - 1) / CHUNK_PX); cx++) {
        out.push(...this.chunks.get(cx, cy).decor)
      }
    }
    return out
  }

  createPopulace(): Populace {
    return EMPTY
  }

  weather(tx: number, ty: number, seconds: number) {
    return weatherAt(tx, ty, this.world.biomeAt(tx, ty), seconds, this.world.seed)
  }

  talkAt(): string | null {
    return null
  }

  collect(): boolean {
    return false
  }

  paintMinimap(canvas: HTMLCanvasElement, tx: number, ty: number): void {
    paintMinimap(canvas, this.world, tx, ty)
  }

  tick(): void {
    this.chunks.tick()
  }
}
