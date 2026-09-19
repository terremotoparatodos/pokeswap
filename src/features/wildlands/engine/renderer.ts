// Scene renderer — WildLands prototype
//
// Frame order:
//   1. compose a flat "ground buffer" around the camera from the active area
//      (animated water + baked chunks, or a town image), then the tile grid,
//      portal pads and tap route (drawn flat so they get projected too);
//   2. project that buffer row by row onto the tilted plane;
//   3. draw projected shadows, then upright sprites sorted by depth;
//   4. lighting (multiply tint + additive glows), weather, vignette, fade.
//
// Ground markers live in groundMarks.ts and the step-4 effects in lighting.ts.

import { actorPosition, isMoving, walkFrame, type Actor } from './actors'
import type { Area } from './area'
import type { Lighting, WeatherKind } from './atmosphere'
import { buildTrainer, NPC_PALETTES, PLAYER_PALETTE, type TrainerSprites } from './characters'
import { drawGrid, drawPads, drawRoute } from './groundMarks'
import { drawSparkle, SceneLighting, type LightSource } from './lighting'
import { drawOwnerMarker } from './ownerMarker'
import { resolvePick, spriteRect, type ActorHit, type PlacedHit, type PropHit } from './picking'
import type { PlacedObject } from './placedObjects'
import type { Tile } from './pathfinding'
import { pixelsToCanvas } from './pixels'
import { drawPlayerNameplate } from './playerNameplate'
import { createProjector, type CameraLens, type Projector } from './projection'
import { buildPropSprites } from './props'
import type { OverlayLabel, SceneOverlay } from './sceneOverlay'
import type { Sprite } from './sprite'
import { silhouetteInsets, volumeGeometry, wallColour } from './buildingVolume'
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
  /** Cosmetic follower; excluded from picking and collision by the game. */
  companion: Actor | null
  /** Untrusted profile text, rendered only through fillText. */
  username: string | null
  /** Guests keep a camera anchor but do not render a local playable avatar. */
  showPlayer: boolean
  actors: readonly Actor[]
  showGrid: boolean
  route: RouteMarker
  /** Optional prototype effects (see sceneOverlay.ts). */
  overlay?: SceneOverlay | null
  /** Objects placed in this area (F-1); only their declared art answers taps. */
  placed?: readonly PlacedObject[]
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
  alpha?: number
  /** The viewer's own Pokémon: drawn with the owner marker. */
  mine?: boolean
  /** Wild prop: the tile a tap on its art answers with (R30 · F-2). */
  prop?: { tx: number; ty: number }
  username?: string
  actor?: Actor
  /** Buildings: world position of the feet and footprint depth, to draw them as a box. */
  volume?: { wx: number; wy: number; depth: number }
}

interface FrameInfo {
  proj: Projector
  dpr: number
  camX: number
  camY: number
  /** Screen rects of actor sprites, back to front. */
  hits: ActorHit<Actor>[]
  /** Screen rects of wild props, back to front (R30 · F-2). */
  propHits: PropHit[]
  /** Screen rects of the art placed objects declared (F-1). */
  placedHits: PlacedHit[]
  /** Screen positions of light sources (street lamp globes) drawn this frame. */
  lights: LightSource[]
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D
  private readonly ground = document.createElement('canvas')
  private readonly gctx: CanvasRenderingContext2D
  private readonly waterFrames: HTMLCanvasElement[]
  private readonly props: Record<DecorKind, Sprite>
  readonly playerSprites: TrainerSprites
  readonly npcSprites: TrainerSprites[]
  private readonly lighting = new SceneLighting()
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
    this.frame = { proj, dpr, camX: scene.camX, camY: scene.camY, hits: [], propHits: [], placedHits: [], lights: [] }
    this.collectPlacedHits(scene, proj)

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
    this.lighting.draw(ctx, scene, proj, this.frame.lights, W, H, dt)
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

    if (scene.showGrid) drawGrid(g, scene.player, x0, y0, dpr)
    drawPads(g, scene, x0, y0)
    drawRoute(g, scene, x0, y0)
    scene.overlay?.ground?.(g, scene.area, x0, y0, scene.seconds)
    return { x0, y0, x1, y1 }
  }

  /** Resolves a CSS-pixel point on the canvas against the last rendered frame. */
  pick(cssX: number, cssY: number): Pick {
    const frame = this.frame
    if (!frame) return { tile: null, actor: null }
    return resolvePick(frame.hits, frame.propHits, cssX * frame.dpr, cssY * frame.dpr, (sx, sy) => {
      const ground = frame.proj.unproject(sx, sy)
      if (!ground) return null
      return {
        tx: Math.floor((frame.camX + ground.wx) / TILE),
        ty: Math.floor((frame.camY + ground.wy) / TILE),
      }
    }, frame.placedHits)
  }

  /**
   * Screen rects for the art placed objects declared (F-1). Projected with the
   * frame's own camera, so they live in the same space as everything drawn.
   * An object without a hitbox contributes nothing and only its tiles speak.
   */
  private collectPlacedHits(scene: Scene, proj: Projector): void {
    const frame = this.frame
    if (!frame) return
    for (const object of scene.placed ?? []) {
      const box = object.hitbox
      if (!box) continue
      const feetX = object.anchor.tx * TILE + TILE / 2
      const feetY = object.anchor.ty * TILE + TILE - 2
      const p = proj.project(feetX - scene.camX, feetY - scene.camY)
      if (!p) continue
      const left = p.x - (box.width / 2 - (box.offsetX ?? 0)) * p.scale
      frame.placedHits.push({
        ...spriteRect(left, p.y - box.height * p.scale, p.y, box.width, 0, p.scale),
        tx: object.anchor.tx, ty: object.anchor.ty,
      })
    }
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

    const overlay = scene.overlay ?? null
    for (const d of scene.area.decorIn(b.x0, b.y0, b.x1, b.y1)) {
      const style = overlay?.decor?.(d, scene.area, scene.seconds) ?? null
      const sprite = style?.sprite ?? d.sprite ?? (d.kind ? this.props[d.kind] : null)
      if (!sprite) continue
      push(d.x + (style?.dx ?? 0), d.y + (style?.dy ?? 0), sprite, {
        submerged: d.kind === 'searock',
        glow: d.kind === 'crystal' && !style?.sprite,
        light: d.light ?? false,
        // Only wild props: town buildings bring their own sprite and already
        // resolve a tap through their footprint (`doorForTap`).
        prop: d.kind ? { tx: d.tx, ty: d.ty } : undefined,
        volume: d.volume ? { wx: d.x, wy: d.y, depth: d.volume } : undefined,
      })
    }

    const area = scene.area
    for (const extra of overlay?.sprites?.(area, scene.seconds) ?? []) {
      const index = list.length
      push(extra.wx, extra.wy, extra.sprite, { lift: extra.lift ?? 0, alpha: extra.alpha, scale: extra.scale })
      if (list.length > index && extra.depthBias) list[index].depth += extra.depthBias
    }
    const visibleActors = !scene.showPlayer ? scene.actors
      : scene.companion ? [scene.player, scene.companion, ...scene.actors] : [scene.player, ...scene.actors]
    for (const actor of visibleActors) {
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
          mine: actor.owned?.mine,
          actor: actor === scene.companion || actor.remote ? undefined : actor,
        })
      } else if (actor.trainer) {
        const set = actor.running && actor.trainerRun && isMoving(actor) && !inWater ? actor.trainerRun : actor.trainer
        push(pos.x, pos.y, set[actor.dir][walkFrame(actor)], {
          submerged: inWater,
          actor: actor.kind === 'npc' ? actor : undefined,
          username: actor === scene.player ? scene.username ?? undefined : actor.remoteUsername,
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
    const nameplates: { username: string; x: number; y: number }[] = []
    for (const d of drawables) {
      const { sprite, scale: s } = d
      const x = Math.round(d.x - sprite.ax * s)
      const y = Math.round(d.y - (sprite.ay + d.lift) * s)
      if (d.actor && this.frame) {
        // Visible art plus a finger-sized margin.
        const pad = 8 * this.frame.dpr
        this.frame.hits.push({
          actor: d.actor, tx: d.actor.tx, ty: d.actor.ty,
          ...spriteRect(x, y, d.y, sprite.w, sprite.top ?? 0, s, pad),
        })
      } else if (d.prop && this.frame) {
        // The art as drawn, with no margin: a tall prop must answer for the
        // ground it hides (F-2), without stealing the taps around it.
        this.frame.propHits.push({
          ...d.prop,
          ...spriteRect(x, y, d.y, sprite.w, sprite.top ?? 0, s),
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
      const faded = d.alpha !== undefined && d.alpha < 1
      if (faded) ctx.globalAlpha = Math.max(0, d.alpha!)
      const flat = sprite.flatTop ?? 0
      if (flat > 0 && d.volume && this.drawVolume(scene, proj, d, W)) {
        // Drawn as a box: side wall, façade and a roof that narrows with depth.
      } else if (flat > 0) {
        // Upright façade, then the roof squashed by the camera tilt like the ground.
        const faceH = sprite.h - flat
        const faceY = Math.round(d.y - (sprite.ay - flat) * s)
        const roofH = Math.round(flat * s * squash)
        if (faceH > 0) ctx.drawImage(sprite.canvas, 0, flat, sprite.w, faceH, x, faceY, Math.round(sprite.w * s), Math.round(faceH * s))
        ctx.drawImage(sprite.canvas, 0, 0, sprite.w, flat, x, faceY - roofH, Math.round(sprite.w * s), roofH)
      } else {
        ctx.drawImage(sprite.canvas, x, y, Math.round(sprite.w * s), Math.round(sprite.h * s))
      }
      if (faded) ctx.globalAlpha = 1
      if (d.light && this.frame) this.frame.lights.push({ x: d.x, y: y + 5 * s, scale: s })
      if (d.glow && Math.sin(t * 2.2 + d.x * 0.05) > 0.7) drawSparkle(ctx, d.x + s * 2, y + s * 3, s)
      if (d.mine) drawOwnerMarker(ctx, d.x, y + (sprite.top ?? 0) * s, s, t)
      if (d.username) nameplates.push({ username: d.username, x: d.x, y: y + (sprite.top ?? 0) * s - 4 * (this.frame?.dpr ?? 1) })
    }
    if (this.frame) for (const nameplate of nameplates) drawPlayerNameplate(ctx, nameplate.username, nameplate.x, nameplate.y, this.frame.dpr)
    const labels = scene.overlay?.labels?.(scene.area, t)
    if (labels?.length && this.frame) for (const label of labels) this.drawLabel(label, scene, proj, this.frame.dpr)
  }

  /**
   * A building as a box (see buildingVolume.ts): the side wall facing the
   * screen centre, the upright façade, then the roof row by row, narrowing
   * toward the back of the footprint like the ground does. False when the
   * back of the footprint cannot be projected (then it is drawn as a card).
   */
  private drawVolume(scene: Scene, proj: Projector, d: Drawable, W: number): boolean {
    const { sprite, scale: s, volume } = d
    if (!volume) return false
    const backP = proj.project(volume.wx - scene.camX, volume.wy - volume.depth - scene.camY)
    const frontP = proj.project(volume.wx - scene.camX, volume.wy - scene.camY)
    if (!backP || !frontP) return false
    const ctx = this.ctx
    const flat = sprite.flatTop ?? 0
    const faceH = sprite.h - flat
    const left = Math.round(d.x - sprite.ax * s)
    const width = Math.round(sprite.w * s)
    const faceTop = Math.round(d.y - (sprite.ay - flat) * s)
    const roofH = Math.round(flat * s * scene.lens.squash)
    const bottom = faceTop + Math.round(faceH * s)
    const geo = volumeGeometry({ left, width, bottom, faceTop, roofH, cx: W / 2, ratio: backP.scale / frontP.scale })
    const wall = geo.wall
    if (wall) {
      // Row by row, from the art's own silhouette edge, so a pointed roof gets a gable, not a slab.
      const inset = silhouetteInsets(sprite)[wall.side]
      const roofTop = faceTop - roofH
      ctx.fillStyle = wallColour(sprite, wall.side)
      for (let y = roofTop; y < bottom; y++) {
        let edge: number
        if (y >= faceTop) {
          const src = Math.min(sprite.h - 1, flat + Math.floor((y - faceTop) / s))
          edge = wall.side === 'left' ? left + inset[src] * s : left + width - inset[src] * s
        } else {
          const i = y - roofTop
          const src = Math.min(flat - 1, Math.floor(((i + 0.5) / roofH) * flat))
          // Beside a roof that does not reach the side (a gable's slope) there is air, not wall.
          if (inset[src] > 3) continue
          const row = geo.roofRow(i)
          const px = row.width / sprite.w
          edge = wall.side === 'left' ? row.x + inset[src] * px : row.x + row.width - inset[src] * px
        }
        const span = geo.wallSpan(y, edge)
        if (span) ctx.fillRect(Math.round(span.x0), y, Math.max(1, Math.round(span.x1 - span.x0)), 1)
      }
    }
    if (faceH > 0) ctx.drawImage(sprite.canvas, 0, flat, sprite.w, faceH, left, faceTop, width, bottom - faceTop)
    for (let i = 0; i < roofH; i++) {
      const row = geo.roofRow(i)
      const src = Math.min(flat - 1, Math.floor(((i + 0.5) / roofH) * flat))
      ctx.drawImage(sprite.canvas, 0, src, sprite.w, 1, row.x, faceTop - roofH + i, row.width, 1)
    }
    return true
  }

  /** Floating feedback text (e.g. "+2"): canvas text with a dark rim, never markup. */
  private drawLabel(label: OverlayLabel, scene: Scene, proj: Projector, dpr: number): void {
    const p = proj.project(label.wx - scene.camX, label.wy - scene.camY)
    if (!p) return
    const ctx = this.ctx
    ctx.save()
    ctx.globalAlpha = Math.max(0, Math.min(1, label.alpha ?? 1))
    ctx.font = `800 ${Math.round(12 * dpr)}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 3 * dpr
    ctx.strokeStyle = 'rgba(16, 26, 54, 0.9)'
    const y = Math.round(p.y - label.lift * p.scale)
    ctx.strokeText(label.text, Math.round(p.x), y)
    ctx.fillStyle = label.color
    ctx.fillText(label.text, Math.round(p.x), y)
    ctx.restore()
  }
}
