// Tilted ground projection — WildLands prototype
//
// A pinhole camera looks at a flat ground plane (the "Mode 7" trick). The
// ground bitmap is drawn one screen row at a time, each row sampling a
// horizontal strip of the world at the depth that row sees. Sprites are
// placed with the same maths and stay upright, like billboards.
//
//   screenY = horizon + f·h / (D − wy)      screenX = cx + f·wx / (D − wy)
//
// wx, wy are world offsets from the camera focus (wy grows toward the viewer).

export interface CameraLens {
  /** Screen pixels per world pixel at the focus point. */
  zoom: number
  /** Vertical squash at the focus (1 = top-down, lower = more tilted). */
  squash: number
  /** Viewer distance in world pixels; smaller means stronger perspective. */
  distance: number
  /**
   * How tall 3D models stand (1 = full height). This camera keeps upright
   * things at full size; a handheld camera looking steeply down shortens
   * walls. Only 3D models use it: the town's sprites are drawn that way already.
   */
  rise?: number
}

export interface Viewport {
  width: number
  height: number
  /** Screen row where the focus point sits. */
  focusY: number
}

export interface Projector {
  horizon: number
  /** Screen position and scale of a world offset, or null if behind the viewer. */
  project(wx: number, wy: number): { x: number; y: number; scale: number } | null
  /** World depth offset and scale seen by a screen row. */
  row(sy: number): { wy: number; scale: number } | null
  /** World offset under a screen point (inverse of `project`), or null above the horizon. */
  unproject(sx: number, sy: number): { wx: number; wy: number } | null
}

export const LENSES = {
  cenital: { zoom: 3, squash: 0.92, distance: 4200 },
  handheld: { zoom: 3, squash: 0.74, distance: 900 },
  dramatic: { zoom: 3.2, squash: 0.5, distance: 420 },
  /**
   * Towns, closer to the handheld games' steeper camera: ground at 0.85 and
   * 3D walls at 0.62 of their height, the proportions of Platinum's own
   * sprites (a Pokémon Center's façade reads ~60 % tall, its roof ~85–90 %).
   */
  town: { zoom: 3, squash: 0.85, distance: 900, rise: 0.62 },
} satisfies Record<string, CameraLens>

export type LensName = keyof typeof LENSES

/**
 * Converts world pixels to backing-canvas pixels without treating browser
 * zoom-out as a wider camera. `outerWidth` remains tied to the actual window
 * while the CSS viewport grows at 80/50/25% zoom. Using the smaller width also
 * preserves the normal behaviour of embedded or non-maximized canvases.
 */
export function projectionViewportScale(renderWidth: number, cssWidth: number, outerWidth: number): number {
  const referenceWidth = Math.max(1, Math.min(cssWidth, outerWidth || cssWidth))
  return renderWidth / referenceWidth
}

export function lerpLens(a: CameraLens, b: CameraLens, t: number): CameraLens {
  return {
    zoom: a.zoom + (b.zoom - a.zoom) * t,
    squash: a.squash + (b.squash - a.squash) * t,
    distance: a.distance + (b.distance - a.distance) * t,
    rise: (a.rise ?? 1) + ((b.rise ?? 1) - (a.rise ?? 1)) * t,
  }
}

export function createProjector(lens: CameraLens, view: Viewport): Projector {
  const D = lens.distance
  const h = lens.squash * D
  const f = lens.zoom * D
  const cx = view.width / 2
  const horizon = view.focusY - lens.zoom * lens.squash * D

  const row: Projector['row'] = sy => {
    const dy = sy - horizon
    if (dy <= 0) return null
    const depth = (f * h) / dy
    return { wy: D - depth, scale: f / depth }
  }

  return {
    horizon,
    project(wx, wy) {
      const depth = D - wy
      if (depth <= 1) return null
      const scale = f / depth
      return { x: cx + wx * scale, y: horizon + (f * h) / depth, scale }
    },
    row,
    unproject(sx, sy) {
      const r = row(sy)
      return r ? { wx: (sx - cx) / r.scale, wy: r.wy } : null
    },
  }
}
