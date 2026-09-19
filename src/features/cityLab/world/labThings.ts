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
import { isStreetProp, isTreeProp, type EntityRef, type LabCity } from '../domain/labCity'
import { isCityTreeId, treeFeet, treeTapBounds, type CityTreeId, type PixelRect } from '../../worldAssets/trees/cityTrees'

export interface DrawnThing {
  readonly ref: EntityRef | null
  readonly sprite: Sprite
  /** Feet in world pixels (the renderer's depth key is `y`). */
  readonly x: number
  readonly y: number
  /** Buildings and fountains: large art that should lose clicks to ground markers. */
  readonly large: boolean
  /** Where a click selects it, around the feet in world px; absent = the whole sprite. */
  readonly tap?: PixelRect
  /** Forest-generated or placed city tree (QA overlays). */
  readonly tree?: { readonly origin: 'forest' | 'placed'; readonly asset: CityTreeId | null }
}

export function drawnThings(
  city: LabCity, decor: readonly DecorInstance[], props: Readonly<Record<DecorKind, Sprite>>,
): DrawnThing[] {
  const street = new Map(city.props.filter(p => isStreetProp(p.kind)).map(p => [`${p.tx},${p.ty}`, p]))
  const world = new Map(city.props.filter(p => !isStreetProp(p.kind) && !isTreeProp(p.kind)).map(p => [`${p.tx},${p.ty}`, p]))
  const trees = new Map(city.props.filter(p => isTreeProp(p.kind)).map(p => [`${p.tx},${p.ty}`, p]))
  const out: DrawnThing[] = []
  for (const d of decor) {
    const sprite = d.sprite ?? (d.kind ? props[d.kind] : null)
    if (!sprite) continue
    const at = `${d.tx},${d.ty}`
    let ref: EntityRef | null = null
    let large = false
    const placed = (d as { tree?: unknown }).tree
    if (isCityTreeId(placed)) {
      // LabTownArea's placed-tree entries carry their asset id; feet as treeFeet().
      const p = trees.get(at)
      const feet = treeFeet(d.tx, d.ty)
      if (p && feet.x === d.x && feet.y === d.y) {
        out.push({ ref: { type: 'prop', id: p.id }, sprite, x: d.x, y: d.y, large: false, tap: treeTapBounds(placed), tree: { origin: 'placed', asset: placed } })
        continue
      }
    }
    if (d.kind) {
      const p = world.get(at)
      if (p) ref = { type: 'prop', id: p.id }
    } else {
      const b = city.buildings.find(b => b.x === d.tx && b.y + b.d - 1 === d.ty && d.x === (b.x + b.w / 2) * TILE)
      const f = b ? null : city.fountains.find(f => f.x0 === d.tx && f.y0 === d.ty && d.x === ((f.x0 + f.x1 + 1) / 2) * TILE)
      const p = b || f ? null : street.get(at)
      if (b) { ref = { type: 'building', id: b.id }; large = true }
      else if (f) { ref = { type: 'fountain', id: f.id }; large = true }
      // A fence tile's posts stand off the tile centre; they belong to the same fence prop.
      else if (p && (p.kind === 'fenceH' || p.kind === 'fenceV' || (d.x === p.tx * TILE + TILE / 2 && d.y === p.ty * TILE + 14))) ref = { type: 'prop', id: p.id }
    }
    // Anything else without an entity is terrain decor: a forest tree when it is the forest art.
    const forest = !ref && !d.kind && sprite.w > TILE * 2
    out.push({ ref, sprite, x: d.x, y: d.y, large, ...(forest ? { tree: { origin: 'forest' as const, asset: null } } : {}) })
  }
  return out
}
