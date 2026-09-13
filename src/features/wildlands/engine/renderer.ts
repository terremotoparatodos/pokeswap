// Scene renderer — WildLands prototype
//
// Frame order:
//   1. compose a flat "ground buffer" around the camera from the active area
//      (animated water + baked chunks, or a town image), then the tile grid,
//      portal pads and tap route (drawn flat so they get projected too);
//   2. project that buffer row by row onto the tilted plane;
//   3. draw projected shadows, then upright sprites sorted by depth;
//   4. lighting (multiply tint + additive glows), weather, vignette, fade.

import { actorPosition, isMoving, walkFrame, type Actor } from './actors'
import type { Area } from './area'
import { Precipitation, type Lighting, type WeatherKind } from './atmosphere'
import { buildTrainer, NPC_PALETTES, PLAYER_PALETTE, type TrainerSprites } from './characters'
import type { Tile } from './pathfinding'
import { pixelsToCanvas } from './pixels'
import { createProjector, type CameraLens, type Projector } from './projection'
import { buildPropSprites } from './props'
import type { Sprite } from './sprite'
import { WATER_TEX, waterFramePixels } from './terrainArt'
import { TILE, type DecorKind } from './world'

export interface Scene {
  area: Area
  /** 0 = fully visible, 1 = black (area transitions). */
  fade: number
  camX: number
  camY: number
  lens: CameraLens
  seconds: number
  light: Lighting
  weather: { kind: WeatherKind; intensity: number }
  player: Actor
  actors: readonly Actor[]
  showGrid: boolean
  route: RouteMarker
}

/** Tap-to-move feedback drawn on the ground. */
export interface RouteMarker {
  /** Remaining tiles of the current path, in walking order. */
  tiles: readonly Tile[]
  target: Tile | null
  /** Unreachable tap, shown briefly as a red cross; `age` in seconds. */
  rejected: (Tile & { age: number }) | null
}

/** What lies under a screen point: the ground tile and, if any, an actor sprite. */
export interface Pick {
  tile: Tile | null
  actor: Actor | null
}

const WATER_FRAMES = 8
const MAX_DEPTH = 1500
const FRONT_SPRITE_SCALE = 0.5
const SKY_TOP = '#8fc4f0'
const SKY_HAZE = '#d8ecfb'

interface Drawable {
  depth: number
  x: number
  y: number
  scale: number
  sprite: Sprite
  lift: number
  submerged: boolean
  glow: boolean
  light: boolean
  actor?: Actor
}

interface FrameInfo {
  proj: Projector
  dpr: number
  camX: number
  camY: number
  /** Screen rects of actor sprites, back to front. */
  hits: { actor: Actor; x0: number; y0: number; x1: number; y1: number }[]
  /** Screen positions of light sources (street lamp globes) drawn this frame. */
  lights: { x: number; y: number; scale: number }[]
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D
  private readonly ground = document.createElement('canvas')
  private readonly gctx: CanvasRenderingContext2D
  private readonly waterFrames: HTMLCanvasElement[]
  private readonly props: Record<DecorKind, Sprite>
  readonly playerSprites: TrainerSprites
  readonly npcSprites: TrainerSprites[]
  private readonly rain = new Precipitation()
  private frame: FrameInfo | null = null

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!
    this.gctx = this.ground.getContext('2d')!
    this.waterFrames = Array.from({ length: WATER_FRAMES }, (_, i) =>
      pixelsToCanvas(WATER_TEX, WATER_TEX, waterFramePixels(i, WATER_FRAMES)))
    this.props = buildPropSprites()
    this.playerSprites = buildTrainer(PLAYER_PALETTE)
    this.npcSprites = NPC_PALETTES.map(buildTrainer)
  }

  render(scene: Scene, dt: number): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const W = Math.max(1, Math.round(this.canvas.clientWidth * dpr))
    const H = Math.max(1, Math.round(this.canvas.clientHeight * dpr))
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W
      this.canvas.height = H
    }
    const ctx = this.ctx
    ctx.imageSmoothingEnabled = false
    // Small screens zoom out so a phone still shows a useful slice of the world.
    const fit = Math.min(1, Math.max(0.55, Math.min(this.canvas.clientWidth, this.canvas.clientHeight) / 640))
    const lens = { ...scene.lens, zoom: scene.lens.zoom * dpr * fit }
    const proj = createProjector(lens, { width: W, height: H, focusY: H * 0.56 })
    this.frame = { proj, dpr, camX: scene.camX, camY: scene.camY, hits: [], lights: [] }

    const farY = proj.project(0, lens.distance - MAX_DEPTH)?.y ?? 0
    const top = Math.max(0, Math.min(H - 1, Math.ceil(farY)))
    this.drawSky(top, W)

    const rowTop = proj.row(top + 0.5)
    const rowBottom = proj.row(H - 0.5)
    if (rowTop && rowBottom) {
      const bounds = this.composeGround(scene, rowTop.scale, rowTop.wy, rowBottom.wy, W, dpr)
      this.projectGround(scene, proj, top, W, H, bounds)
      if (top > 0) {
        const fog = ctx.createLinearGradient(0, top, 0, top + H * 0.18)
        fog.addColorStop(0, SKY_HAZE)
        fog.addColorStop(1, 'rgba(216,236,251,0)')
        ctx.fillStyle = fog
        ctx.fillRect(0, top, W, H * 0.18)
      }
      this.drawSprites(scene, proj, bounds, W, H)
    }
    this.drawAtmosphere(scene, proj, W, H, dt)
  }

  private drawSky(top: number, W: number): void {
    if (top <= 0) return
    const sky = this.ctx.createLinearGradient(0, 0, 0, top)
    sky.addColorStop(0, SKY_TOP)
    sky.addColorStop(1, SKY_HAZE)
    this.ctx.fillStyle = sky
    this.ctx.fillRect(0, 0, W, top)
  }

  private composeGround(scene: Scene, farScale: number, farWy: number, nearWy: number, W: number, dpr: number) {
    const halfW = W / 2 / farScale
    const x0 = Math.floor(scene.camX - halfW) - 2
    const x1 = Math.ceil(scene.camX + halfW) + 2
    const y0 = Math.floor(scene.camY + farWy) - 2
    const y1 = Math.ceil(scene.camY + nearWy) + 2
    const bw = x1 - x0
    const bh = y1 - y0
    if (this.ground.width < bw || this.ground.height < bh) {
      this.ground.width = Math.max(this.ground.width, bw)
      this.ground.height = Math.max(this.ground.height, bh)
    }
    const g = this.gctx
    g.imageSmoothingEnabled = false

    if (scene.area.kind === 'wild') {
      // Worlds leave water transparent in their chunks; paint it animated underneath.
      const frame = this.waterFrames[Math.floor(scene.seconds * 5) % WATER_FRAMES]
      const pattern = g.createPattern(frame, 'repeat')!
      pattern.setTransform(new DOMMatrix().translate(-x0, -y0))
      g.fillStyle = pattern
      g.fillRect(0, 0, bw, bh)
    }
    scene.area.drawGround(g, x0, y0, x1, y1)

    if (scene.showGrid) this.drawGrid(scene.player, x0, y0, dpr)
    this.drawPads(scene, x0, y0)
    this.drawRoute(scene, x0, y0)
    return { x0, y0, x1, y1 }
  }

  /** Glowing warp pads for portals that are not part of the art. */
  private drawPads(scene: Scene, x0: number, y0: number): void {
    const g = this.gctx
    const pulse = (Math.sin(scene.seconds * 3) + 1) / 2
    for (const portal of scene.area.portals) {
      if (!portal.pad) continue
      for (const { tx, ty } of portal.tiles) {
        const cx = tx * TILE + TILE / 2 - x0
        const cy = ty * TILE + TILE / 2 - y0
        const glow = g.createRadialGradient(cx, cy, 1, cx, cy, TILE * 0.9)
        glow.addColorStop(0, `rgba(255, 255, 255, ${0.75 + pulse * 0.25})`)
        glow.addColorStop(0.45, `rgba(120, 200, 255, ${0.55 + pulse * 0.2})`)
        glow.addColorStop(1, 'rgba(120, 200, 255, 0)')
        g.fillStyle = glow
        g.fillRect(cx - TILE, cy - TILE, TILE * 2, TILE * 2)
        g.strokeStyle = 'rgba(255, 255, 255, 0.9)'
        g.lineWidth = 1
        g.beginPath()
        g.arc(cx, cy, 5 + pulse * 1.5, 0, Math.PI * 2)
        g.stroke()
      }
    }
  }

  /** Path dots, a pulsing destination square, or a red cross for unreachable taps. */
  private drawRoute(scene: Scene, x0: number, y0: number): void {
    const { tiles, target, rejected } = scene.route
    const g = this.gctx
    g.save()
    g.translate(-x0, -y0)
    g.fillStyle = 'rgba(255, 255, 255, 0.75)'
    tiles.forEach(({ tx, ty }, i) => {
      if (i === tiles.length - 1 && target) return
      g.fillRect(tx * TILE + 7, ty * TILE + 7, 2, 2)
    })
    if (target) {
      const pulse = 1 + Math.sin(scene.seconds * 8) * 0.12
      const size = (TILE - 2) * pulse
      const cx = target.tx * TILE + TILE / 2
      const cy = target.ty * TILE + TILE / 2
      g.lineWidth = 1.5
      g.strokeStyle = 'rgba(20, 20, 30, 0.45)'
      g.strokeRect(cx - size / 2 + 1, cy - size / 2 + 1, size, size)
      g.strokeStyle = '#ffffff'
      g.strokeRect(cx - size / 2, cy - size / 2, size, size)
    }
    if (rejected && rejected.age < 0.6) {
      const cx = rejected.tx * TILE + TILE / 2
      const cy = rejected.ty * TILE + TILE / 2
      g.globalAlpha = 1 - rejected.age / 0.6
      g.strokeStyle = '#e03c3c'
      g.lineWidth = 2
      g.beginPath()
      g.moveTo(cx - 5, cy - 5); g.lineTo(cx + 5, cy + 5)
      g.moveTo(cx + 5, cy - 5); g.lineTo(cx - 5, cy + 5)
      g.stroke()
    }
    g.restore()
  }

  /** Resolves a CSS-pixel point on the canvas against the last rendered frame. */
  pick(cssX: number, cssY: number): Pick {
    const frame = this.frame
    if (!frame) return { tile: null, actor: null }
    const sx = cssX * frame.dpr
    const sy = cssY * frame.dpr
    for (let i = frame.hits.length - 1; i >= 0; i--) {
      const hit = frame.hits[i]
      if (sx >= hit.x0 && sx <= hit.x1 && sy >= hit.y0 && sy <= hit.y1) {
        return { tile: { tx: hit.actor.tx, ty: hit.actor.ty }, actor: hit.actor }
      }
    }
    const ground = frame.proj.unproject(sx, sy)
    if (!ground) return { tile: null, actor: null }
    return {
      tile: { tx: Math.floor((frame.camX + ground.wx) / TILE), ty: Math.floor((frame.camY + ground.wy) / TILE) },
      actor: null,
    }
  }

  /** Tile grid, range circle and current-tile marker, drawn flat on the ground. */
  private drawGrid(player: Actor, x0: number, y0: number, dpr: number): void {
    const g = this.gctx
    const { x, y } = actorPosition(player)
    const ptx = Math.round(player.tx)
    const pty = Math.round(player.ty)
    const radius = 7
    g.save()
    g.translate(-x0, -y0)
    g.lineWidth = 1 / Math.max(1, dpr * 0.75)
    g.strokeStyle = 'rgba(40, 30, 20, 0.16)'
    g.beginPath()
    for (let i = -radius; i <= radius + 1; i++) {
      g.moveTo((ptx + i) * TILE, (pty - radius) * TILE)
      g.lineTo((ptx + i) * TILE, (pty + radius + 1) * TILE)
      g.moveTo((ptx - radius) * TILE, (pty + i) * TILE)
      g.lineTo((ptx + radius + 1) * TILE, (pty + i) * TILE)
    }
    g.stroke()
    g.strokeStyle = 'rgba(58, 104, 214, 0.9)'
    g.lineWidth = 1
    g.beginPath()
    g.arc(x, y - TILE / 2 + 2, (radius + 0.5) * TILE, 0, Math.PI * 2)
    g.stroke()
    g.strokeStyle = 'rgba(255, 255, 255, 0.85)'
    g.strokeRect(Math.round(x - TILE / 2) + 0.5, Math.round(y - TILE + 2) + 0.5, TILE - 1, TILE - 1)
    g.restore()
  }

  private projectGround(scene: Scene, proj: Projector, top: number, W: number, H: number, b: { x0: number; y0: number }): void {
    const ctx = this.ctx
    for (let sy = top; sy < H; sy++) {
      const row = proj.row(sy + 0.5)
      if (!row) continue
      const srcW = W / row.scale
      const srcX = scene.camX - srcW / 2 - b.x0
      const srcY = Math.floor(scene.camY + row.wy - b.y0)
      ctx.drawImage(this.ground, srcX, srcY, srcW, 1, 0, sy, W, 1)
    }
  }

  private collect(scene: Scene, proj: Projector, b: { x0: number; y0: number; x1: number; y1: number }, W: number, H: number): Drawable[] {
    const list: Drawable[] = []
    const push = (wx: number, wy: number, sprite: Sprite, extra: Partial<Drawable> = {}) => {
      const p = proj.project(wx - scene.camX, wy - scene.camY)
      if (!p) return
      const s = p.scale * (extra.scale ?? 1)
      if (p.x + sprite.w * s < -32 || p.x - sprite.w * s > W + 32) return
      if (p.y - sprite.h * s > H + 32 || p.y < -32) return
      list.push({ depth: wy, x: p.x, y: p.y, sprite, lift: 0, submerged: false, glow: false, light: false, ...extra, scale: s })
    }

    for (const d of scene.area.decorIn(b.x0, b.y0, b.x1, b.y1)) {
      const sprite = d.sprite ?? (d.kind ? this.props[d.kind] : null)
      if (!sprite) continue
      push(d.x, d.y, sprite, {
        submerged: d.kind === 'searock',
        glow: d.kind === 'crystal',
        light: d.light ?? false,
      })
    }

    const area = scene.area
    for (const actor of [scene.player, ...scene.actors]) {
      const pos = actorPosition(actor)
      const inWater = area.isWater(actor.tx, actor.ty) && area.isWater(actor.fromTx, actor.fromTy)
      if (actor.pokemon) {
        const frames = actor.pokemon.frames[actor.dir]
        // Overworld sprites keep stepping while idle, like handheld followers.
        // `& 7` keeps the per-actor phase offset non-negative for negative coordinates.
        const beat = isMoving(actor) ? actor.walkClock * 2 : scene.seconds * 1.6 + (actor.homeTx & 7) * 0.37
        push(pos.x, pos.y, frames[Math.floor(beat) % frames.length], {
          // Front-sprite fallbacks are ~2× the overworld scale.
          scale: frames.length > 1 ? 1 : FRONT_SPRITE_SCALE,
          lift: actor.hop,
          submerged: inWater,
          glow: actor.pokemon.shiny,
          actor,
        })
      } else if (actor.trainer) {
        const set = actor.running && actor.trainerRun && isMoving(actor) && !inWater ? actor.trainerRun : actor.trainer
        push(pos.x, pos.y, set[actor.dir][walkFrame(actor)], {
          submerged: inWater,
          actor: actor === scene.player ? undefined : actor,
        })
      }
    }
    return list.sort((a, c) => a.depth - c.depth || a.x - c.x)
  }

  private drawSprites(scene: Scene, proj: Projector, b: { x0: number; y0: number; x1: number; y1: number }, W: number, H: number): void {
    const ctx = this.ctx
    const drawables = this.collect(scene, proj, b, W, H)
    const { dx, dy, alpha } = scene.light.shadow
    const squash = scene.lens.squash
    const vx = dx
    const vy = dy * squash

    // Shadows: silhouettes flipped and sheared onto the ground, away from the sun.
    // A sprite pixel at height (ay - y) lands at feet + height·(vx, vy).
    ctx.globalAlpha = alpha * (1 - scene.weather.intensity * 0.6)
    for (const d of drawables) {
      if (d.submerged || d.sprite.castShadow === false) continue
      const s = d.scale
      const { ax, ay } = d.sprite
      ctx.setTransform(s, 0, -s * vx, -s * vy, d.x - ax * s + ay * s * vx, d.y + ay * s * vy)
      ctx.drawImage(d.sprite.shadow, 0, 0)
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1

    const t = scene.seconds
    for (const d of drawables) {
      const { sprite, scale: s } = d
      const x = Math.round(d.x - sprite.ax * s)
      const y = Math.round(d.y - (sprite.ay + d.lift) * s)
      if (d.actor && this.frame) {
        // Visible art plus a finger-sized margin.
        const pad = 8 * this.frame.dpr
        this.frame.hits.push({
          actor: d.actor,
          x0: x - pad, x1: x + sprite.w * s + pad,
          y0: y + (sprite.top ?? 0) * s - pad, y1: d.y + pad,
        })
      }
      if (d.submerged) {
        // Hide the lower third of the visible art, not of the (possibly padded) cell.
        const top = sprite.top ?? 0
        const cut = Math.max(top + 4, Math.round(top + (sprite.ay - top) * 0.66))
        ctx.drawImage(sprite.canvas, 0, 0, sprite.w, cut, x, y + Math.round(Math.sin(t * 3) * s * 0.5), Math.round(sprite.w * s), Math.round(cut * s))
        const wave = (t * 1.4) % 1
        ctx.strokeStyle = `rgba(255,255,255,${0.75 - wave * 0.5})`
        ctx.lineWidth = Math.max(1, s * 0.6)
        ctx.beginPath()
        ctx.ellipse(d.x, y + cut * s, sprite.w * s * (0.45 + wave * 0.2), sprite.w * s * 0.14 * squash + 1, 0, 0, Math.PI * 2)
        ctx.stroke()
        continue
      }
      const flat = sprite.flatTop ?? 0
      if (flat > 0) {
        // Upright façade, then the roof squashed by the camera tilt like the ground.
        const faceH = sprite.h - flat
        const faceY = Math.round(d.y - (sprite.ay - flat) * s)
        const roofH = Math.round(flat * s * squash)
        if (faceH > 0) ctx.drawImage(sprite.canvas, 0, flat, sprite.w, faceH, x, faceY, Math.round(sprite.w * s), Math.round(faceH * s))
        ctx.drawImage(sprite.canvas, 0, 0, sprite.w, flat, x, faceY - roofH, Math.round(sprite.w * s), roofH)
      } else {
        ctx.drawImage(sprite.canvas, x, y, Math.round(sprite.w * s), Math.round(sprite.h * s))
      }
      if (d.light && this.frame) this.frame.lights.push({ x: d.x, y: y + 5 * s, scale: s })
      if (d.glow && Math.sin(t * 2.2 + d.x * 0.05) > 0.7) this.sparkle(d.x + s * 2, y + s * 3, s)
    }
  }

  private sparkle(x: number, y: number, s: number): void {
    const ctx = this.ctx
    ctx.fillStyle = '#ffffff'
    const u = Math.max(1, Math.round(s))
    ctx.fillRect(x - u / 2, y - u * 2.5, u, u * 5)
    ctx.fillRect(x - u * 2.5, y - u / 2, u * 5, u)
  }

  private drawAtmosphere(scene: Scene, proj: Projector, W: number, H: number, dt: number): void {
    const ctx = this.ctx
    const { tint, darkness } = scene.light
    const wet = scene.weather.intensity
    const r = tint[0] * (1 - wet * 0.22)
    const g = tint[1] * (1 - wet * 0.2)
    const b = tint[2] * (1 - wet * 0.12)
    ctx.globalCompositeOperation = 'multiply'
    ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`
    ctx.fillRect(0, 0, W, H)

    if (darkness > 0.15) {
      ctx.globalCompositeOperation = 'lighter'
      const p = actorPosition(scene.player)
      const sp = proj.project(p.x - scene.camX, p.y - scene.camY)
      if (sp) {
        const radius = 70 * sp.scale
        const glow = ctx.createRadialGradient(sp.x, sp.y - 8 * sp.scale, 0, sp.x, sp.y - 8 * sp.scale, radius)
        glow.addColorStop(0, `rgba(255, 200, 120, ${0.32 * darkness})`)
        glow.addColorStop(1, 'rgba(255, 200, 120, 0)')
        ctx.fillStyle = glow
        ctx.fillRect(sp.x - radius, sp.y - radius - 8 * sp.scale, radius * 2, radius * 2)
      }
      // Street lamps: a warm pool around each globe.
      for (const l of this.frame?.lights ?? []) {
        const radius = 46 * l.scale
        const pool = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, radius)
        pool.addColorStop(0, `rgba(255, 236, 180, ${0.55 * darkness})`)
        pool.addColorStop(0.25, `rgba(255, 210, 130, ${0.25 * darkness})`)
        pool.addColorStop(1, 'rgba(255, 200, 120, 0)')
        ctx.fillStyle = pool
        ctx.fillRect(l.x - radius, l.y - radius, radius * 2, radius * 2)
      }
    }
    ctx.globalCompositeOperation = 'source-over'

    this.rain.update(dt, W, H, scene.weather.kind, scene.weather.intensity)
    this.rain.draw(ctx, scene.weather.kind)

    const vignette = ctx.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.35, W / 2, H * 0.55, Math.max(W, H) * 0.75)
    vignette.addColorStop(0, 'rgba(10, 14, 30, 0)')
    vignette.addColorStop(1, `rgba(10, 14, 30, ${0.28 + darkness * 0.25})`)
    ctx.fillStyle = vignette
    ctx.fillRect(0, 0, W, H)

    if (scene.fade > 0) {
      ctx.fillStyle = `rgba(6, 8, 18, ${Math.min(1, scene.fade)})`
      ctx.fillRect(0, 0, W, H)
    }
  }
}
