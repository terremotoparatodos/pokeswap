// City Mapping Lab — the working copy as a real WildLands area (DEV only).
//
// This *is* `TownArea`: collision, ground baking, hand-drawn sprites, doors,
// gates, signs and populace all come from the production class, fed with the
// lab's `TownDef`. The only addition is the world props the palette can place
// (trees, rocks, crystals…) that `TownDef` has no slot for yet: they are drawn
// as the renderer's own procedural props (`kind` set, no sprite) and are solid
// by the world's own rule (`isSolidDecor`), exactly as in a procedural world.
//
// Nothing here touches the DOM until the renderer asks for ground or decor,
// so validation and tests can build one freely.

import { TownArea } from '../../wildlands/areas/townArea'
import type { TownDef } from '../../wildlands/areas/townArea'
import type { DecorInstance } from '../../wildlands/engine/chunks'
import { isSolidDecor, TILE } from '../../wildlands/engine/world'
import { labDecor, toTownDef, type LabCity } from '../domain/labCity'

/** Same feet offset a procedural world gives its props (chunks.ts), minus the per-seed jitter. */
export function decorInstanceAt(kind: DecorInstance['kind'], tx: number, ty: number): DecorInstance {
  return { kind, tx, ty, x: tx * TILE + 8, y: ty * TILE + 13, seed: 0 }
}

export class LabTownArea extends TownArea {
  readonly extraDecor: readonly DecorInstance[]
  private readonly extraSolid: ReadonlySet<string>

  constructor(def: TownDef, extra: readonly DecorInstance[] = []) {
    super(def)
    this.extraDecor = extra
    this.extraSolid = new Set(extra.filter(d => isSolidDecor(d.kind)).map(d => `${d.tx},${d.ty}`))
  }

  override isSolid(tx: number, ty: number): boolean {
    return super.isSolid(tx, ty) || this.extraSolid.has(`${tx},${ty}`)
  }

  override decorIn(x0: number, y0: number, x1: number, y1: number): readonly DecorInstance[] {
    const base = super.decorIn(x0, y0, x1, y1)
    if (!this.extraDecor.length) return base
    return base.concat(this.extraDecor.filter(d => d.x > x0 - 96 && d.x < x1 + 96 && d.y > y0 && d.y < y1 + 180))
  }
}

/** Builds the real area for a working copy. */
export function labArea(city: LabCity, base: TownDef): LabTownArea {
  return new LabTownArea(toTownDef(city, base), labDecor(city).map(p => decorInstanceAt(p.kind, p.tx, p.ty)))
}
