// CAVES-3: the inside of a cave as a WildLands `Area`.
//
// Static and authored: the floor plan comes from `caveLayouts.js`, the same
// data the presence service uses to refuse a step into a wall, so what the
// browser draws as rock is what the service treats as rock. Nothing here is
// rolled, generated or placed: no props, nodes, plots, wild Pokémon, NPCs or
// chests. The only portal is the exit pad back to the cave's area.
// ECO-GAMEPLAY-1 (experimental, development builds only): the server's ECO encounters of the
// interior are its only wanderers — never procedural trainers or the hourly roster.
//
// The look reuses the cave textures that already exist (`dungeonTerrain.ts`,
// pure art: palettes and pixel sampling), not the Dungeon prototype itself.

import { caveByInterior } from '../../../../services/realtime/src/world/caves.js'
import { caveInterior, isCaveFloor, type CaveInterior } from '../../../../services/realtime/src/world/caveLayouts.js'
import { sampleTexture, textureFor, themePaint, type ThemePaint } from '../../dungeonPrototype/world/dungeonTerrain'
import type { Arrival, Area, AreaId, Populace, PopulaceContext, Portal } from '../../wildlands/engine/area'
import { EcoPopulace } from '../../wildlands/engine/ecoPopulace'
import { ECO_EXPERIMENT } from '../../world/domain/ecoExperiment'
import type { DecorInstance } from '../../wildlands/engine/chunks'
import { packColor } from '../../wildlands/engine/pixels'
import { TILE } from '../../wildlands/engine/world'

const EMPTY_POPULACE: Populace = { actors: [], update: () => {} }
const SIDES: readonly (readonly [number, number])[] = [[0, -1], [0, 1], [-1, 0], [1, 0]]

/** Alpha-blends a packed colour over another (both little-endian RGBA). */
function blend(base: number, over: number): number {
  const a = ((over >>> 24) & 255) / 255
  const mix = (shift: number) => {
    const b = (base >>> shift) & 255
    const o = (over >>> shift) & 255
    return Math.round(b + (o - b) * a)
  }
  return ((255 << 24) | (mix(16) << 16) | (mix(8) << 8) | mix(0)) >>> 0
}

/** Bakes the whole interior once: floor and rock textures, and a dark rim where floor meets rock. */
function bakeInterior(interior: CaveInterior, paint: ThemePaint): HTMLCanvasElement {
  const w = interior.width * TILE
  const h = interior.height * TILE
  const pixels = new Uint32Array(w * h)
  const rimNear = packColor(paint.rim, 150)
  const rimFar = packColor(paint.rim, 70)
  const floor = (tx: number, ty: number) => isCaveFloor(interior.id, tx, ty)
  for (let ty = 0; ty < interior.height; ty++) {
    for (let tx = 0; tx < interior.width; tx++) {
      const walkable = floor(tx, ty)
      const texture = textureFor(paint, walkable ? 'floor' : 'rock')
      const up = !floor(tx, ty - 1), left = !floor(tx - 1, ty), right = !floor(tx + 1, ty), down = !floor(tx, ty + 1)
      for (let py = 0; py < TILE; py++) {
        for (let px = 0; px < TILE; px++) {
          const wx = tx * TILE + px
          const wy = ty * TILE + py
          let colour = texture ? sampleTexture(texture, wx, wy) : 0
          if (colour !== 0 && walkable) {
            const near = (up && py < 2) || (left && px < 2) || (right && px > TILE - 3) || (down && py > TILE - 3)
            const far = (up && py < 4) || (left && px < 4) || (right && px > TILE - 5) || (down && py > TILE - 5)
            if (near) colour = blend(colour, rimNear)
            else if (far) colour = blend(colour, rimFar)
          }
          pixels[wy * w + wx] = colour
        }
      }
    }
  }
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const image = ctx.createImageData(w, h)
    new Uint32Array(image.data.buffer).set(pixels)
    ctx.putImageData(image, 0, 0)
  }
  return canvas
}

export class CaveArea implements Area {
  readonly kind = 'wild' as const
  readonly lens = 'handheld' as const
  readonly id: AreaId
  readonly name: string
  readonly portals: readonly Portal[]
  readonly interior: CaveInterior
  private readonly paint: ThemePaint
  private readonly reach: ReadonlySet<string>
  private canvas: HTMLCanvasElement | null = null

  constructor(areaId: AreaId) {
    const interior = caveInterior(areaId)
    const cave = caveByInterior(areaId)
    if (!interior || !cave) throw new Error(`not a cave interior: ${areaId}`)
    this.interior = interior
    this.id = interior.id
    this.name = interior.name
    this.paint = themePaint('cave')
    this.portals = [{ tiles: [{ tx: interior.exit.tx, ty: interior.exit.ty }], to: cave.areaId, label: 'Salir de la cueva', pad: true }]
    // Bounded area: every floor tile reachable from the arrival (a restored or
    // authoritative position never lands in a sealed pocket).
    const seen = new Set([`${interior.arrival.tx},${interior.arrival.ty}`])
    const queue = [{ tx: interior.arrival.tx, ty: interior.arrival.ty }]
    while (queue.length) {
      const at = queue.shift()!
      for (const [dx, dy] of SIDES) {
        const next = { tx: at.tx + dx, ty: at.ty + dy }
        const key = `${next.tx},${next.ty}`
        if (seen.has(key) || !isCaveFloor(this.id, next.tx, next.ty)) continue
        seen.add(key)
        queue.push(next)
      }
    }
    this.reach = seen
  }

  /** Always the interior's arrival tile: the only way in is the mouth. */
  arrival(): Arrival {
    return { tx: this.interior.arrival.tx, ty: this.interior.arrival.ty, dir: this.interior.arrival.dir }
  }

  isSolid(tx: number, ty: number): boolean {
    return !isCaveFloor(this.id, tx, ty)
  }

  isReachable(tx: number, ty: number): boolean {
    return this.reach.has(`${tx},${ty}`)
  }

  isWater(): boolean {
    return false
  }

  placeName(): string {
    return this.name
  }

  drawGround(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
    this.canvas ??= bakeInterior(this.interior, this.paint)
    // Beyond the interior there is rock, never the water the renderer paints under a wild area.
    g.save()
    g.fillStyle = '#0a0d16'
    g.fillRect(0, 0, x1 - x0, y1 - y0)
    g.restore()
    g.drawImage(this.canvas, -x0, -y0)
  }

  decorIn(): readonly DecorInstance[] {
    return []
  }

  createPopulace(context: PopulaceContext): Populace {
    // Outside the experiment (every production build): empty, exactly as before.
    return ECO_EXPERIMENT ? new EcoPopulace(context.pokedex) : EMPTY_POPULACE
  }

  weather() {
    return { kind: 'clear' as const, intensity: 0 }
  }

  talkAt(): string | null {
    return null
  }

  collect(): boolean {
    return false
  }

  paintMinimap(canvas: HTMLCanvasElement, tx: number, ty: number): void {
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const span = 24
    const cell = Math.max(1, Math.floor(Math.min(canvas.width, canvas.height) / span))
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    for (let y = 0; y < span; y++) {
      for (let x = 0; x < span; x++) {
        const at = { tx: tx - span / 2 + x, ty: ty - span / 2 + y }
        const exit = at.tx === this.interior.exit.tx && at.ty === this.interior.exit.ty
        ctx.fillStyle = exit ? '#d9a441' : isCaveFloor(this.id, at.tx, at.ty) ? '#54607c' : '#141a28'
        ctx.fillRect(x * cell, y * cell, cell, cell)
      }
    }
    ctx.fillStyle = '#ffffff'
    ctx.fillRect((span / 2) * cell, (span / 2) * cell, cell, cell)
  }

  deactivate(): void {
    this.canvas = null
  }

  tick(): void {
    // One baked bitmap, nothing to evict.
  }
}
