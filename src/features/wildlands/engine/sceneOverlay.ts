// Scene overlay port — optional per-frame hooks for effects that live outside
// the engine (R31-C1 mining prototype). The engine knows nothing about what
// the overlay represents: it only asks for replacement decor sprites, flat
// ground marks, extra depth-sorted sprites and short canvas labels.

import type { Area } from './area'
import type { DecorInstance } from './chunks'
import type { Sprite } from './sprite'

/** Replaces or nudges one decor prop for the current frame. */
export interface DecorStyle {
  sprite?: Sprite
  /** World-pixel offset (e.g. a hit shake). */
  dx?: number
  dy?: number
}

/** An upright sprite placed at world feet coordinates and sorted with the scene. */
export interface OverlaySprite {
  wx: number
  wy: number
  sprite: Sprite
  /** Height above the ground, in world pixels. */
  lift?: number
  alpha?: number
  /** Multiplies the projected size, anchored at the feet (e.g. a quick pop-in). */
  scale?: number
  /** Added to the depth key: positive draws in front of props at the same row. */
  depthBias?: number
}

/** Short text drawn with canvas text only (never markup). */
export interface OverlayLabel {
  wx: number
  wy: number
  lift: number
  text: string
  color: string
  alpha?: number
}

export interface SceneOverlay {
  decor?(decor: DecorInstance, area: Area, seconds: number): DecorStyle | null
  /** Painted into the ground buffer (origin at world x0, y0), so marks tilt with the terrain. */
  ground?(g: CanvasRenderingContext2D, area: Area, x0: number, y0: number, seconds: number): void
  sprites?(area: Area, seconds: number): readonly OverlaySprite[]
  labels?(area: Area, seconds: number): readonly OverlayLabel[]
}
