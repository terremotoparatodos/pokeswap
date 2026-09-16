// One scene overlay made of several (R31-C2). The engine holds a single
// overlay, but a world can host more than one profession at a time, so the
// dev WildLands demo composes mining and fishing into one.

import type { Area } from '../../wildlands/engine/area'
import type { DecorInstance } from '../../wildlands/engine/chunks'
import type { DecorStyle, OverlayLabel, OverlaySprite, SceneOverlay } from '../../wildlands/engine/sceneOverlay'

export class CompositeOverlay implements SceneOverlay {
  private readonly parts: readonly SceneOverlay[]

  constructor(...parts: readonly SceneOverlay[]) {
    this.parts = parts
  }

  /** First overlay that claims the prop wins; the rest leave it alone. */
  decor(decor: DecorInstance, area: Area, seconds: number): DecorStyle | null {
    for (const part of this.parts) {
      const style = part.decor?.(decor, area, seconds)
      if (style) return style
    }
    return null
  }

  ground(g: CanvasRenderingContext2D, area: Area, x0: number, y0: number, seconds: number): void {
    for (const part of this.parts) part.ground?.(g, area, x0, y0, seconds)
  }

  sprites(area: Area, seconds: number): readonly OverlaySprite[] {
    return this.parts.flatMap(part => part.sprites?.(area, seconds) ?? [])
  }

  labels(area: Area, seconds: number): readonly OverlayLabel[] {
    return this.parts.flatMap(part => part.labels?.(area, seconds) ?? [])
  }
}
