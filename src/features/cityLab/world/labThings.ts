// City Mapping Lab — which entity each drawn sprite belongs to (DEV only).
//
// `TownArea` hands the renderer anonymous decor entries (forest trees, props,
// fountains, buildings). The lab needs to know, for a click or a hitbox, which
// working-copy entity a sprite is. Entries are matched back by the exact feet
// position `TownArea.ensureArt` gives each kind; forest trees and bushes come
// from terrain and belong to no entity.

import type { DecorInstance } from '../../wildlands/engine/chunks'
import type { Sprite } from '../../wildlands/engine/sprite'
import { TILE, type DecorKind } from '../../wildlands/engine/world'
import { isStreetProp, type EntityRef, type LabCity } from '../domain/labCity'

export interface DrawnThing {
  readonly ref: EntityRef | null
  readonly sprite: Sprite
  /** Feet in world pixels (the renderer's depth key is `y`). */
  readonly x: number
  readonly y: number
  /** Buildings and fountains: large art that should lose clicks to ground markers. */
  readonly large: boolean
}

export function drawnThings(
  city: LabCity, decor: readonly DecorInstance[], props: Readonly<Record<DecorKind, Sprite>>,
): DrawnThing[] {
  const street = new Map(city.props.filter(p => isStreetProp(p.kind)).map(p => [`${p.tx},${p.ty}`, p]))
  const world = new Map(city.props.filter(p => !isStreetProp(p.kind)).map(p => [`${p.tx},${p.ty}`, p]))
  const out: DrawnThing[] = []
  for (const d of decor) {
    const sprite = d.sprite ?? (d.kind ? props[d.kind] : null)
    if (!sprite) continue
    const at = `${d.tx},${d.ty}`
    let ref: EntityRef | null = null
    let large = false
    if (d.kind) {
      const p = world.get(at)
      if (p) ref = { type: 'prop', id: p.id }
    } else {
      const b = city.buildings.find(b => b.x === d.tx && b.y + b.d - 1 === d.ty && d.x === (b.x + b.w / 2) * TILE)
      const f = b ? null : city.fountains.find(f => f.x0 === d.tx && f.y0 === d.ty && d.x === ((f.x0 + f.x1 + 1) / 2) * TILE)
      const p = b || f ? null : street.get(at)
      if (b) { ref = { type: 'building', id: b.id }; large = true }
      else if (f) { ref = { type: 'fountain', id: f.id }; large = true }
      else if (p && d.x === p.tx * TILE + TILE / 2 && d.y === p.ty * TILE + 14) ref = { type: 'prop', id: p.id }
    }
    out.push({ ref, sprite, x: d.x, y: d.y, large })
  }
  return out
}
