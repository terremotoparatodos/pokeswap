// Frame drawing — Rancho
//
// Layers, bottom to top: baked ground (terrain plus the flat decals), then
// everything that stands up — scenery and inhabitants merged into a single
// pass ordered by the y of their feet, which is what makes a Pokémon walk
// behind a tree and in front of the next one — then the highlight and, last,
// the nameplates in screen space so text size does not follow the zoom.
//
// Nothing here allocates per frame: the visible lists are reused buffers and
// the two sorted inputs are merged rather than concatenated and re-sorted.

import { isMoving, walkFrame, type Actor } from '../../wildlands/engine/actors'
import type { Sprite } from '../../wildlands/engine/sprite'
import type { Platform } from '../domain/membership'
import type { RanchCamera } from './camera'
import type { NameplateCache } from './nameplates'
import type { RanchGround } from './ranchGround'
import { lowerBound, type SceneryItem } from './scenery'

/** Below this zoom the map reads as a whole and names would be noise. */
export const NAMEPLATE_ZOOM = 1.5
/** Never paint more labels than this in one frame. */
const MAX_NAMEPLATES = 200
/** Breathing room kept between two labels, in CSS pixels. */
const PLATE_GAP = 2
/** World pixels of slack around the viewport, so sprites do not pop at the edge. */
const CULL_PAD = 64
/** Under this zoom a contact shadow is a smudge nobody sees, so it is skipped. */
const SHADOW_ZOOM = 1

export interface DrawableActor {
  actor: Actor
  /** Feet in world pixels, resolved once per frame by the scene. */
  x: number
  y: number
  /** Label shown under it; caretakers have none. */
  name: string | null
  platform: Platform | null
  key: string
  highlighted: boolean
}

/** A zone name painted over the map when it is seen as a whole. */
export interface MapLabel {
  text: string
  x: number
  y: number
}

export interface FrameInput {
  camera: RanchCamera
  ground: RanchGround
  scenery: readonly SceneryItem[]
  nameplates: NameplateCache
  /** Reused buffer of what is on screen, sorted by feet y. */
  actors: readonly DrawableActor[]
  /** How many entries of `actors` are live this frame. */
  actorCount: number
  /** Zone names, shown instead of nameplates when zoomed out. */
  labels: readonly MapLabel[]
  /** Frame counter for animated scenery (the campfire). */
  animationFrame: number
}

const view = { x0: 0, y0: 0, x1: 0, y1: 0 }
let shadows = true

export function drawFrame(ctx: CanvasRenderingContext2D, input: FrameInput): void {
  const { camera, ground, scenery, actors, actorCount } = input
  const canvas = ctx.canvas
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  camera.visible(CULL_PAD, view)
  shadows = camera.zoom >= SHADOW_ZOOM
  camera.applyTo(ctx)
  ground.draw(ctx, view.x0, view.y0, view.x1, view.y1, input.animationFrame)

  // Merge the two depth-sorted lists in one walk.
  let s = lowerBound(scenery, view.y0)
  let a = 0
  while (s < scenery.length || a < actorCount) {
    const item = s < scenery.length && scenery[s].y <= view.y1 ? scenery[s] : null
    const drawable = a < actorCount ? actors[a] : null
    if (item && (!drawable || item.y <= drawable.y)) {
      drawScenery(ctx, item, input.animationFrame)
      s++
      continue
    }
    if (!drawable) break
    drawActor(ctx, drawable)
    a++
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  if (camera.zoom >= NAMEPLATE_ZOOM) {
    drawNameplates(ctx, input)
  } else {
    drawMapLabels(ctx, input)
    drawHighlightedNameplate(ctx, input)
  }
}

function drawScenery(ctx: CanvasRenderingContext2D, item: SceneryItem, frame: number): void {
  if (item.x + item.half < view.x0 || item.x - item.half > view.x1) return
  const sprite = item.frames[item.animated ? frame % item.frames.length : item.variant % item.frames.length]
  ctx.drawImage(sprite.canvas, Math.round(item.x - sprite.ax), Math.round(item.y - sprite.ay))
}

function spriteFor(actor: Actor): Sprite | null {
  const frame = walkFrame(actor)
  if (actor.pokemon) {
    const frames = actor.pokemon.frames[actor.dir]
    return frames[isMoving(actor) ? frame % frames.length : 0] ?? null
  }
  const art = actor.running && actor.trainerRun ? actor.trainerRun : actor.trainer
  if (!art) return null
  const frames = art[actor.dir]
  return frames[frame % frames.length] ?? null
}

function drawActor(ctx: CanvasRenderingContext2D, drawable: DrawableActor): void {
  const { actor, x, y } = drawable
  const sprite = spriteFor(actor)
  if (!sprite) return
  if (x + sprite.w < view.x0 || x - sprite.w > view.x1) return

  // A soft ellipse keeps everyone planted without a projected silhouette.
  if (shadows) {
    ctx.globalAlpha = 0.22
    ctx.fillStyle = '#000000'
    ctx.beginPath()
    ctx.ellipse(x, y - 1, Math.max(4, sprite.w * 0.28), Math.max(2, sprite.w * 0.13), 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
  }

  if (drawable.highlighted) drawHighlightRing(ctx, x, y)
  ctx.drawImage(sprite.canvas, Math.round(x - sprite.ax), Math.round(y - sprite.ay - actor.hop))
}

function drawHighlightRing(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.save()
  ctx.strokeStyle = '#ffd65c'
  ctx.lineWidth = 2
  ctx.globalAlpha = 0.95
  ctx.beginPath()
  ctx.ellipse(x, y - 1, 13, 7, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.globalAlpha = 0.25
  ctx.fillStyle = '#ffd65c'
  ctx.fill()
  ctx.restore()
}

/** Rectangles already taken this frame, so two labels never sit on top of each other. */
const taken: number[] = []
let takenCount = 0

function overlaps(x: number, y: number, w: number, h: number): boolean {
  for (let i = 0; i < takenCount; i += 4) {
    if (x < taken[i + 2] + PLATE_GAP && x + w + PLATE_GAP > taken[i] &&
      y < taken[i + 3] + PLATE_GAP && y + h + PLATE_GAP > taken[i + 1]) return true
  }
  return false
}

/** Draws one nameplate; `crowd` skips it when something is already there. */
function plate(ctx: CanvasRenderingContext2D, input: FrameInput, drawable: DrawableActor, crowd: boolean): boolean {
  if (!drawable.name || !drawable.platform) return false
  const { camera, nameplates } = input
  const sprite = spriteFor(drawable.actor)
  const lift = sprite ? sprite.ay + 4 : 20
  const screen = camera.worldToScreen(drawable.x, drawable.y - lift)
  const label = nameplates.get(drawable.key, drawable.name, drawable.platform, drawable.highlighted)
  let left = screen.x - label.w / 2
  const top = screen.y - label.h
  if (left + label.w < 0 || top + label.h < 0 || left > camera.viewW || top > camera.viewH) return false
  // Keep the whole label on screen: a clipped name is unreadable on a phone.
  left = Math.max(2, Math.min(camera.viewW - label.w - 2, left))
  if (crowd) {
    if (overlaps(left, top, label.w, label.h)) return false
    taken[takenCount] = left
    taken[takenCount + 1] = top
    taken[takenCount + 2] = left + label.w
    taken[takenCount + 3] = top + label.h
    takenCount += 4
  }
  const dpr = camera.dpr
  ctx.drawImage(label.canvas, Math.round(left * dpr), Math.round(top * dpr),
    Math.round(label.w * dpr), Math.round(label.h * dpr))
  return true
}

function drawNameplates(ctx: CanvasRenderingContext2D, input: FrameInput): void {
  takenCount = 0
  let drawn = 0
  // Nearest first: whoever is in front keeps their label when space runs out.
  for (let i = input.actorCount - 1; i >= 0 && drawn < MAX_NAMEPLATES; i--) {
    const drawable = input.actors[i]
    if (!drawable.name) continue
    if (plate(ctx, input, drawable, true)) drawn++
  }
}

function drawMapLabels(ctx: CanvasRenderingContext2D, input: FrameInput): void {
  const { camera } = input
  const dpr = camera.dpr
  ctx.save()
  ctx.scale(dpr, dpr)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = '600 13px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
  ctx.lineJoin = 'round'
  ctx.lineWidth = 3.5
  ctx.strokeStyle = 'rgba(18, 26, 16, 0.75)'
  ctx.fillStyle = '#f4f7ee'
  for (const label of input.labels) {
    const at = camera.worldToScreen(label.x, label.y)
    if (at.x < -80 || at.y < -20 || at.x > camera.viewW + 80 || at.y > camera.viewH + 20) continue
    ctx.strokeText(label.text, at.x, at.y)
    ctx.fillText(label.text, at.x, at.y)
  }
  ctx.restore()
}

function drawHighlightedNameplate(ctx: CanvasRenderingContext2D, input: FrameInput): void {
  for (let i = 0; i < input.actorCount; i++) {
    const drawable = input.actors[i]
    if (drawable.highlighted) plate(ctx, input, drawable, false)
  }
}
