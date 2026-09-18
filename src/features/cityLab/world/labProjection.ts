// City Mapping Lab — the renderer's camera, from the outside (DEV only).
//
// The lab draws hitboxes and resolves clicks against exactly what the
// renderer drew. The renderer keeps its frame private, so this rebuilds the
// same projector with the same inputs — `Renderer.render()` (dpr capped at 2,
// small-screen `fit`, focus at 56 % of the height) and `drawSprites()` (roofs
// squashed by the lens, façades upright). If those formulas change there, the
// overlay drifts visibly off the art, which is the signal to update this file.

import type { Tile } from '../../wildlands/engine/pathfinding'
import type { HitRect } from '../../wildlands/engine/picking'
import { createProjector, LENSES, type CameraLens, type Projector } from '../../wildlands/engine/projection'
import type { Sprite } from '../../wildlands/engine/sprite'
import { TILE } from '../../wildlands/engine/world'

/**
 * EDIT cameras. `plan` is the lab's near top-down view: the engine's own
 * `cenital` lens (distance 4200) sits past the renderer's MAX_DEPTH (1500) and
 * draws no ground at all, so the lab uses a shorter distance with the same
 * squash. The other two are the game's lenses unchanged.
 */
export const EDIT_LENSES = {
  plan: { zoom: 3, squash: 0.92, distance: 1300 },
  handheld: LENSES.handheld,
  dramatic: LENSES.dramatic,
} satisfies Record<string, CameraLens>

export type EditLens = keyof typeof EDIT_LENSES

export interface FrameGeometry {
  readonly proj: Projector
  readonly dpr: number
  readonly camX: number
  readonly camY: number
  readonly squash: number
  /** Device-pixel size of the canvas. */
  readonly width: number
  readonly height: number
}

export function frameGeometry(canvas: HTMLCanvasElement, lens: CameraLens, camX: number, camY: number): FrameGeometry {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const width = Math.max(1, Math.round(canvas.clientWidth * dpr))
  const height = Math.max(1, Math.round(canvas.clientHeight * dpr))
  const fit = Math.min(1, Math.max(0.55, Math.min(canvas.clientWidth, canvas.clientHeight) / 640))
  const proj = createProjector({ ...lens, zoom: lens.zoom * dpr * fit }, { width, height, focusY: height * 0.56 })
  return { proj, dpr, camX, camY, squash: lens.squash, width, height }
}

/** World pixel under a CSS point, or null above the horizon. */
export function worldAt(f: FrameGeometry, cssX: number, cssY: number): { x: number; y: number } | null {
  const ground = f.proj.unproject(cssX * f.dpr, cssY * f.dpr)
  return ground ? { x: f.camX + ground.wx, y: f.camY + ground.wy } : null
}

export function tileAt(f: FrameGeometry, cssX: number, cssY: number): Tile | null {
  const w = worldAt(f, cssX, cssY)
  return w ? { tx: Math.floor(w.x / TILE), ty: Math.floor(w.y / TILE) } : null
}

/** Device-pixel screen point of a world point on the ground. */
export function screenAt(f: FrameGeometry, x: number, y: number): { x: number; y: number; scale: number } | null {
  return f.proj.project(x - f.camX, y - f.camY)
}

/** Device-pixel rect of a sprite drawn with its feet at world (x, y), as `drawSprites` lays it out. */
export function spriteRect(f: FrameGeometry, sprite: Sprite, x: number, y: number): HitRect | null {
  const p = screenAt(f, x, y)
  if (!p) return null
  const s = p.scale
  const left = Math.round(p.x - sprite.ax * s)
  const flat = sprite.flatTop ?? 0
  if (flat > 0) {
    const faceY = Math.round(p.y - (sprite.ay - flat) * s)
    const roofH = Math.round(flat * s * f.squash)
    return { x0: left, x1: left + Math.round(sprite.w * s), y0: faceY - roofH, y1: faceY + Math.round((sprite.h - flat) * s) }
  }
  const top = Math.round(p.y - sprite.ay * s)
  return { x0: left, x1: left + Math.round(sprite.w * s), y0: top + (sprite.top ?? 0) * s, y1: top + Math.round(sprite.h * s) }
}

/** Device-pixel quad of a tile rectangle on the tilted ground (for screen-space outlines). */
export function groundQuad(f: FrameGeometry, tx0: number, ty0: number, tx1: number, ty1: number): { x: number; y: number }[] | null {
  const corners = [
    [tx0 * TILE, ty0 * TILE], [(tx1 + 1) * TILE, ty0 * TILE], [(tx1 + 1) * TILE, (ty1 + 1) * TILE], [tx0 * TILE, (ty1 + 1) * TILE],
  ]
  const out: { x: number; y: number }[] = []
  for (const [x, y] of corners) {
    const p = screenAt(f, x, y)
    if (!p) return null
    out.push({ x: p.x, y: p.y })
  }
  return out
}

export function contains(r: HitRect, x: number, y: number): boolean {
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1
}
