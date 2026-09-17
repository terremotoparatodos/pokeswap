// DungeonFloor → WildLands `Area` (D1.2 §2, §3).
//
// This is the adapter the phase is built around. The engine's renderer only
// ever talks to the `Area` interface: give it a ground painter, a decor list
// and a collision test and it will draw a dungeon floor with the same camera,
// the same projection, the same shadows, the same water and the same lighting
// as the overworld. Nothing in WildLands is modified; the dungeon simply
// speaks its language.
//
// What this class does NOT do: actors, combat, HUD. Those live in the scene
// (dungeonScene.ts) and the overlay (worldOverlay.ts), which are the engine's
// own extension points.

import type { Arrival, Area, AreaId, Populace, Portal } from '../../wildlands/engine/area'
import type { DecorInstance } from '../../wildlands/engine/chunks'
import { hash2 } from '../../wildlands/engine/noise'
import { packColor } from '../../wildlands/engine/pixels'
import { buildPropSprites } from '../../wildlands/engine/props'
import type { Sprite } from '../../wildlands/engine/sprite'
import { TILE, type DecorKind } from '../../wildlands/engine/world'
import { tileAt, WALKABLE, type FloorTiles, type TileKind } from '../domain/floorTiles'
import { planDecor, solidPropTiles, type CaveStyle, type PlannedProp } from '../domain/decorPlan'
import { torchSprite } from './dungeonProps'
import { plankPixels, sampleTexture, textureFor, themePaint, type ThemePaint } from './dungeonTerrain'

/** How dark the ambient gets away from a torch; the renderer's lantern does the rest. */
export const DUNGEON_DARKNESS = 0.62

// Named for what it is: sharing the name `props` with a parameter below made
// the bundler pick the wrong binding.
let propCache: Record<DecorKind, Sprite> | null = null
const propSprites = (): Record<DecorKind, Sprite> => (propCache ??= buildPropSprites())

function rimColour(paint: ThemePaint, alpha: number): number {
  return packColor(paint.rim, alpha)
}

/**
 * Bakes the whole floor into one bitmap, the way a chunk is baked: texture
 * sampled per world pixel, water left transparent for the animated layer, and
 * a dark rim where a walkable tile meets rock so the cave has depth.
 */
function bakeGround(tiles: FloorTiles, paint: ThemePaint, placed: readonly PlannedProp[]): HTMLCanvasElement {
  const w = tiles.width * TILE
  const h = tiles.height * TILE
  const pixels = new Uint32Array(w * h)
  const rimNear = rimColour(paint, 150)
  const rimFar = rimColour(paint, 70)

  for (let ty = 0; ty < tiles.height; ty++) {
    for (let tx = 0; tx < tiles.width; tx++) {
      const kind = tileAt(tiles, tx, ty)
      const texture = textureFor(paint, kind)
      const bridge = kind === 'bridge'
      const solidUp = tileAt(tiles, tx, ty - 1) === 'rock'
      const solidLeft = tileAt(tiles, tx - 1, ty) === 'rock'
      const solidRight = tileAt(tiles, tx + 1, ty) === 'rock'
      const solidDown = tileAt(tiles, tx, ty + 1) === 'rock'
      const walkable = WALKABLE.has(kind)

      for (let py = 0; py < TILE; py++) {
        for (let px = 0; px < TILE; px++) {
          const wx = tx * TILE + px
          const wy = ty * TILE + py
          let colour = bridge ? plankPixels(wx, wy) : texture ? sampleTexture(texture, wx, wy) : 0
          if (colour !== 0 && walkable) {
            // Ambient occlusion against the rock: two pixels dark, two soft.
            const near = (solidUp && py < 2) || (solidLeft && px < 2) || (solidRight && px > TILE - 3) || (solidDown && py > TILE - 3)
            const far = (solidUp && py < 4) || (solidLeft && px < 4) || (solidRight && px > TILE - 5) || (solidDown && py > TILE - 5)
            if (near) colour = blend(colour, rimNear)
            else if (far) colour = blend(colour, rimFar)
          }
          pixels[wy * w + wx] = colour
        }
      }
    }
  }

  // D1.2.3 §4: every solid prop gets a dark footprint painted into the ground.
  // The art of a boulder spills over its neighbours, so without this you cannot
  // tell which tile it actually occupies — and that is what made the collisions
  // feel arbitrary.
  const base = rimColour(paint, 190)
  const soft = rimColour(paint, 90)
  for (const prop of placed) {
    if (!prop.solid || !WALKABLE.has(tileAt(tiles, prop.tx, prop.ty))) continue
    for (let py = 0; py < TILE; py++) {
      for (let px = 0; px < TILE; px++) {
        const dx = (px - TILE / 2 + 0.5) / (TILE / 2)
        const dy = (py - TILE / 2 + 0.5) / (TILE / 2.6)
        const d = dx * dx + dy * dy
        if (d > 1) continue
        const at = (prop.ty * TILE + py) * w + prop.tx * TILE + px
        if (pixels[at] === 0) continue
        pixels[at] = blend(pixels[at], d > 0.55 ? soft : base)
      }
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(w, h)
  new Uint32Array(image.data.buffer).set(pixels)
  ctx.putImageData(image, 0, 0)
  return canvas
}

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

/**
 * Turns the plan (domain/decorPlan.ts) into sprites the renderer can draw.
 *
 * D1.2.2 §5: that plan is also what collision reads, so a boulder on screen and
 * a boulder in `isSolid` are the same decision, made once.
 */
function buildDecor(placed: readonly PlannedProp[], seed: number): DecorInstance[] {
  const sprites = propSprites()
  return placed.map(prop => ({
    kind: prop.kind === 'torch' ? null : prop.kind,
    sprite: prop.kind === 'torch' ? torchSprite(0) : sprites[prop.kind],
    light: prop.light,
    tx: prop.tx,
    ty: prop.ty,
    x: prop.tx * TILE + TILE / 2,
    y: prop.ty * TILE + TILE - 2,
    seed: Math.floor(hash2(prop.tx, prop.ty, seed) * 1e6),
  })).sort((a, b) => a.y - b.y)
}

const EMPTY_POPULACE: Populace = { actors: [], update: () => {} }

export class DungeonArea implements Area {
  readonly kind = 'wild' as const
  readonly id: AreaId
  readonly name: string
  readonly lens = 'handheld' as const
  readonly portals: readonly Portal[] = []
  readonly paint: ThemePaint
  readonly tiles: FloorTiles
  private readonly canvas: HTMLCanvasElement
  private readonly decor: DecorInstance[]
  /** Tiles a solid prop is standing on: rock, boulder, tree, crystal (§5). */
  private readonly blocked: ReadonlySet<string>
  private rockTile: HTMLCanvasElement | null = null

  constructor(tiles: FloorTiles, seed: number, floor: number, style: CaveStyle = 'A') {
    this.tiles = tiles
    this.paint = themePaint(tiles.theme)
    this.id = `dungeon-${seed}-${floor}`
    this.name = `${this.paint.name} · piso ${floor}`
    const props = planDecor(tiles, seed + floor * 97, style)
    this.canvas = bakeGround(tiles, this.paint, props)
    this.blocked = solidPropTiles(props)
    this.decor = buildDecor(props, seed + floor * 97)
  }

  arrival(): Arrival {
    return { tx: this.tiles.entrance.x, ty: this.tiles.entrance.y, dir: 'down' }
  }

  /**
   * D1.2.2 §5: what looks like it blocks, blocks. A tile is solid when the
   * terrain says so **or** when something solid is standing on it.
   */
  isSolid(tx: number, ty: number): boolean {
    if (!WALKABLE.has(tileAt(this.tiles, tx, ty))) return true
    return this.blocked.has(`${tx}:${ty}`)
  }

  isWater(tx: number, ty: number): boolean {
    return tileAt(this.tiles, tx, ty) === 'water'
  }

  kindAt(tx: number, ty: number): TileKind {
    return tileAt(this.tiles, tx, ty)
  }

  placeName(): string {
    return this.name
  }

  drawGround(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
    // Past the edge of the floor there is solid rock, not the open water the
    // renderer paints under every wild area. Only the bands outside the floor
    // are covered, so the water *inside* the cave still animates.
    const right = this.canvas.width - x0
    const bottom = this.canvas.height - y0
    const w = x1 - x0
    const h = y1 - y0
    g.save()
    g.fillStyle = this.edge(g, x0, y0)
    if (-x0 > 0) g.fillRect(0, 0, -x0, h)
    if (right < w) g.fillRect(right, 0, w - right, h)
    if (-y0 > 0) g.fillRect(Math.max(0, -x0), 0, w, -y0)
    if (bottom < h) g.fillRect(Math.max(0, -x0), bottom, w, h - bottom)
    g.restore()
    g.drawImage(this.canvas, -x0, -y0)
  }

  /** A rock pattern for everything beyond the floor, built once. */
  private edge(g: CanvasRenderingContext2D, x0: number, y0: number): CanvasPattern | string {
    if (!this.rockTile) {
      const size = Math.round(Math.sqrt(this.paint.rock.length))
      const tile = document.createElement('canvas')
      tile.width = size
      tile.height = size
      const ctx = tile.getContext('2d')
      if (!ctx) return '#0a0d16'
      const image = ctx.createImageData(size, size)
      new Uint32Array(image.data.buffer).set(this.paint.rock)
      ctx.putImageData(image, 0, 0)
      this.rockTile = tile
    }
    const pattern = g.createPattern(this.rockTile, 'repeat')
    if (!pattern) return '#0a0d16'
    // Anchored to world pixels, like the renderer anchors its water.
    pattern.setTransform(new DOMMatrix().translate(-x0, -y0))
    return pattern
  }

  decorIn(x0: number, y0: number, x1: number, y1: number): readonly DecorInstance[] {
    // Props below the view can still lean into it, so the window extends down.
    return this.decor.filter(d => d.y >= y0 - TILE * 2 && d.y <= y1 + TILE * 4 && d.x >= x0 - TILE * 2 && d.x <= x1 + TILE * 2)
  }

  createPopulace(): Populace {
    // The dungeon owns its own actors (wild Pokémon, allies, the trainer).
    return EMPTY_POPULACE
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
    const { width, height } = canvas
    const span = 24
    ctx.clearRect(0, 0, width, height)
    const cell = Math.max(1, Math.floor(Math.min(width, height) / span))
    for (let y = 0; y < span; y++) {
      for (let x = 0; x < span; x++) {
        const kind = tileAt(this.tiles, tx - span / 2 + x, ty - span / 2 + y)
        ctx.fillStyle = kind === 'rock' ? '#141a28' : kind === 'water' ? '#28527a' : kind === 'stairs' ? '#d9a441' : '#54607c'
        ctx.fillRect(x * cell, y * cell, cell, cell)
      }
    }
    ctx.fillStyle = '#ffffff'
    ctx.fillRect((span / 2) * cell, (span / 2) * cell, cell, cell)
  }

  tick(): void {
    // Nothing to evict: one floor is one baked bitmap.
  }
}

/** World-pixel centre of a tile, the anchor everything in the scene uses. */
export const tileCentre = (x: number, y: number): { x: number; y: number } => ({
  x: x * TILE + TILE / 2,
  y: y * TILE + TILE - 2,
})
