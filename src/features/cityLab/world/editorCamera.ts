// City Mapping Lab — EDIT camera maths (DEV only).
//
// The camera is only a view: a world-pixel focus (x, y) and a zoom factor on
// top of the edit lens. Nothing here touches the working copy, tiles or the
// patch — zooming or panning never changes what gets exported.
//
// Pure: every function takes numbers and returns numbers.

import type { CameraLens } from '../../wildlands/engine/projection'
import { geometryFor, worldAtDevice, type FrameGeometry } from './labProjection'

/**
 * Safe zoom range on top of the edit lens. Below 0.35 the renderer's
 * MAX_DEPTH clip starts eating the far rows with the tilted lenses; above 2.5
 * a tile is bigger than useful for editing.
 */
export const ZOOM_MIN = 0.35
export const ZOOM_MAX = 2.5
export const ZOOM_STEP = 1.25

export interface EditorCamera {
  x: number
  y: number
  zoom: number
}

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom))
}

/** One notch in or out (buttons and +/- keys), snapping near 100 % to exactly 100 %. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  const next = clampZoom(direction > 0 ? zoom * ZOOM_STEP : zoom / ZOOM_STEP)
  return Math.abs(next - 1) < 0.06 ? 1 : next
}

/** Mouse wheel: smooth, proportional to the delta. */
export function wheelZoom(zoom: number, deltaY: number): number {
  return clampZoom(zoom * Math.pow(1.0015, -deltaY))
}

/**
 * Zooms keeping the world point under the cursor where it is on screen.
 * `view` describes the canvas (device pixels) and `lens` the edit lens at zoom 1.
 */
export function zoomAt(
  camera: EditorCamera, nextZoom: number, cursor: { sx: number; sy: number },
  view: { width: number; height: number; dpr: number; fit: number }, lens: CameraLens,
): EditorCamera {
  const zoom = clampZoom(nextZoom)
  const before = worldAtDevice(geometryFor(view, withZoom(lens, camera.zoom), camera.x, camera.y), cursor.sx, cursor.sy)
  const afterGeo: FrameGeometry = geometryFor(view, withZoom(lens, zoom), camera.x, camera.y)
  const after = worldAtDevice(afterGeo, cursor.sx, cursor.sy)
  if (!before || !after) return { ...camera, zoom }
  return { x: camera.x + before.x - after.x, y: camera.y + before.y - after.y, zoom }
}

export function withZoom(lens: CameraLens, zoom: number): CameraLens {
  return { ...lens, zoom: lens.zoom * zoom }
}

/**
 * Zoom and focus that frame a whole map (world pixels) in the view, as far as
 * the zoom range allows. The tilted lens foreshortens depth, so width decides.
 */
export function fitZoom(mapWidth: number, mapHeight: number, view: { width: number; dpr: number; fit: number }, lens: CameraLens): EditorCamera {
  const pxPerWorld = lens.zoom * view.dpr * view.fit
  return { x: mapWidth / 2, y: mapHeight / 2, zoom: clampZoom((view.width * 0.96) / (mapWidth * pxPerWorld)) }
}
