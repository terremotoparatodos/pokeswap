// Procedural world area — WildLands prototype
//
// Wraps the seeded World and its chunk cache as an Area. Each world has its
// own seed and a preferred starting biome; a glowing pad next to the arrival
// point leads back to the lobby.

import type { Arrival, Area, AreaId, Populace, PopulaceContext, Portal } from '../engine/area'
import { weatherAt } from '../engine/atmosphere'
import { CHUNK_PX, ChunkStore, type DecorInstance } from '../engine/chunks'
import { paintMinimap } from '../engine/minimap'
import { Population } from '../engine/population'
import type { LensName } from '../engine/projection'
import { BIOME_LABEL, TILE, World, type Biome } from '../engine/world'

export interface WorldDef {
  id: AreaId
  name: string
  seed: number
  prefer: readonly Biome[]
  lens?: LensName
}

export class WildArea implements Area {
  readonly kind = 'wild' as const
  readonly id: AreaId
  readonly name: string
  readonly lens: LensName
  readonly portals: readonly Portal[]
  readonly world: World
  private readonly chunks: ChunkStore
  private readonly start: Arrival

  constructor(def: WorldDef, lobby: AreaId) {
    this.id = def.id
    this.name = def.name
    this.lens = def.lens ?? 'handheld'
    this.world = new World(def.seed)
    this.chunks = new ChunkStore(this.world)
    const spawn = this.world.findSpawn(def.prefer)
    this.start = { ...spawn, dir: 'down' }
    this.portals = [{ tiles: [{ tx: spawn.tx, ty: spawn.ty - 1 }], to: lobby, label: 'Volver a Ciudad Corazón', pad: true }]
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
    // Extend downward: tall props below the view can still reach into it.
    for (let cy = Math.floor(y0 / CHUNK_PX); cy <= Math.floor((y1 + TILE * 4) / CHUNK_PX); cy++) {
      for (let cx = Math.floor(x0 / CHUNK_PX); cx <= Math.floor((x1 - 1) / CHUNK_PX); cx++) {
        out.push(...this.chunks.get(cx, cy).decor)
      }
    }
    return out
  }

  createPopulace(context: PopulaceContext): Populace {
    return new Population(this.world, context.pokedex, context.npcSprites)
  }

  weather(tx: number, ty: number, seconds: number) {
    return weatherAt(tx, ty, this.world.biomeAt(tx, ty), seconds, this.world.seed)
  }

  talkAt(): string | null {
    return null
  }

  collect(tx: number, ty: number): boolean {
    if (this.chunks.isRemoved(tx, ty) || this.world.decorAt(tx, ty) !== 'crystal') return false
    this.chunks.removeDecor(tx, ty)
    return true
  }

  paintMinimap(canvas: HTMLCanvasElement, tx: number, ty: number): void {
    paintMinimap(canvas, this.world, tx, ty)
  }

  prefetch(tx: number, ty: number): void {
    this.chunks.prefetchAround(tx, ty)
  }

  warm(tx: number, ty: number): Promise<void> {
    return this.chunks.warmAround(tx, ty)
  }

  chunkMetrics() {
    return this.chunks.metrics
  }

  deactivate(): void {
    this.chunks.releaseCanvases()
  }

  tick(): void {
    this.chunks.tick()
  }
}
