// One scene overlay made of several (R31-C2).
//
// The engine holds a single overlay, but a world can host more than one thing
// that wants to draw into it: six professions in the dev demo, and the
// professions plus the dungeon entrances during Community Playtest 0.1.
//
// It lived inside the professions feature while they were the only caller. It
// is engine glue — it knows `SceneOverlay` and nothing else — and leaving it
// there would have made a dungeon entrance pull in that whole feature just to
// compose two overlays, which is the boundary `professionsIsolation.test.ts`
// exists to defend. (That guard scans raw text, so this note spells no import
// path: a comment naming one would read to it as a reference.)

import type { Area } from './area'
import type { DecorInstance } from './chunks'
import type { DecorStyle, OverlayLabel, OverlaySprite, SceneOverlay } from './sceneOverlay'

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
