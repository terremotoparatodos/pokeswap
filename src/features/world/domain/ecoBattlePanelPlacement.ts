// ECO-BATTLE-PANEL-1: where the battle panel stands on screen. Presentation only.
//
// The panel is anchored to the battle: beside the on-screen box that holds both combatants and
// their bars, on ONE side chosen when the battle is first placed (the side with room; the right one
// when both have it). It never flips on its own afterwards. It follows the camera with the scene,
// and is moved only as much as it must to stay on screen; if that pushes it onto the combatants it
// steps below the scene (or above it), never over it. Its top edge is the anchor, so the panel
// growing (Info, a warning) extends it downwards instead of making it jump.

export interface ScreenRect { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
export interface ScreenSize { readonly width: number; readonly height: number }
export interface ScreenPoint { readonly x: number; readonly y: number }
export type PanelSide = 'left' | 'right'
/** A world point (world px) on screen: CSS px on the canvas plus CSS px per world px. */
export type ProjectWorld = (wx: number, wy: number) => { x: number; y: number; scale: number } | null

/** Between the scene and the panel, and between the panel and the screen's edge (CSS px). */
export const PANEL_GAP = 12
export const SCREEN_EDGE = 8
/** How far a combatant and its bar reach above and beside its feet (world px). */
const SCENE_RISE = 48
const SCENE_HALF_WIDTH = 20

/**
 * The on-screen box around the combatants and their bars, from their feet (world px). Null when
 * none of them is in front of the camera (nothing drawn yet).
 */
export function sceneRect(feet: readonly { x: number; y: number }[], project: ProjectWorld): ScreenRect | null {
  let rect: { left: number; top: number; right: number; bottom: number } | null = null
  for (const point of feet) {
    const p = project(point.x, point.y)
    if (!p) continue
    const left = p.x - SCENE_HALF_WIDTH * p.scale
    const right = p.x + SCENE_HALF_WIDTH * p.scale
    const top = p.y - SCENE_RISE * p.scale
    rect = rect
      ? { left: Math.min(rect.left, left), top: Math.min(rect.top, top), right: Math.max(rect.right, right), bottom: Math.max(rect.bottom, p.y) }
      : { left, top, right, bottom: p.y }
  }
  return rect
}

/** The side for the whole battle: where the panel fits beside the scene, the right one first. */
export function panelSide(scene: ScreenRect, panel: ScreenSize, viewport: ScreenSize): PanelSide {
  const fitsRight = scene.right + PANEL_GAP + panel.width + SCREEN_EDGE <= viewport.width
  const fitsLeft = scene.left - PANEL_GAP - panel.width >= SCREEN_EDGE
  return fitsRight || !fitsLeft ? 'right' : 'left'
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(value, high))
const overlaps = (at: ScreenPoint, panel: ScreenSize, scene: ScreenRect) =>
  at.x < scene.right && at.x + panel.width > scene.left && at.y < scene.bottom && at.y + panel.height > scene.top

/** The panel's top-left corner (CSS px on the canvas) beside the scene, on its fixed side. */
export function placePanel(scene: ScreenRect, panel: ScreenSize, viewport: ScreenSize, side: PanelSide): ScreenPoint {
  const maxX = Math.max(SCREEN_EDGE, viewport.width - panel.width - SCREEN_EDGE)
  const maxY = Math.max(SCREEN_EDGE, viewport.height - panel.height - SCREEN_EDGE)
  const x = clamp(side === 'right' ? scene.right + PANEL_GAP : scene.left - PANEL_GAP - panel.width, SCREEN_EDGE, maxX)
  let y = clamp(scene.top, SCREEN_EDGE, maxY)
  if (overlaps({ x, y }, panel, scene)) {
    // The screen's edge pushed it onto the combatants: below the scene if it fits, else above it.
    const below = scene.bottom + PANEL_GAP
    const above = scene.top - PANEL_GAP - panel.height
    if (below <= maxY) y = below
    else if (above >= SCREEN_EDGE) y = above
  }
  return { x, y }
}
