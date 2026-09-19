// City Mapping Lab — the working copy as a real WildLands area (DEV only).
//
// This *is* `TownArea`: collision, ground baking, hand-drawn sprites, doors,
// gates, signs and populace all come from the production class, fed with the
// lab's `TownDef`. The only additions are what `TownDef` has no slot for yet:
//   - world props (rocks, crystals…), drawn as the renderer's own procedural
//     props and solid by the world's rule (`isSolidDecor`);
//   - placed city trees (worldAssets/trees): their sprite as decor, their
//     trunk row as collision, and their ground base painted onto the ground.
//
// Nothing here touches the DOM until the renderer asks for ground or decor,
// so validation and tests can build one freely.

import { TownArea } from '../../wildlands/areas/townArea'
import type { TownDef } from '../../wildlands/areas/townArea'
import type { DecorInstance } from '../../wildlands/engine/chunks'
import { isSolidDecor, TILE } from '../../wildlands/engine/world'
import { labDecor, labTrees, toTownDef, type LabCity } from '../domain/labCity'
import { treeCollisionTiles, treeFeet, type CityTreeId } from '../../worldAssets/trees/cityTrees'
import { cityTreeSprite, paintTreeGroundBase } from '../../worldAssets/trees/cityTreeSprites'
import { groundBaseStyle, townGround, type GroundBaseStyle } from '../../worldAssets/trees/treeGroundBase'

/** Same feet offset a procedural world gives its props (chunks.ts), minus the per-seed jitter. */
export function decorInstanceAt(kind: DecorInstance['kind'], tx: number, ty: number): DecorInstance {
  return { kind, tx, ty, x: tx * TILE + 8, y: ty * TILE + 13, seed: 0 }
}

/** A city tree placed in the working copy: its cell's top-left tile and its asset. */
export interface PlacedTree {
  readonly id: string
  readonly kind: CityTreeId
  readonly tx: number
  readonly ty: number
}

export class LabTownArea extends TownArea {
  readonly extraDecor: readonly DecorInstance[]
  readonly trees: readonly PlacedTree[]
  private readonly extraSolid: ReadonlySet<string>
  /** One decor entry per tree, anchored exactly like TownArea's forest trees; the sprite arrives when loaded. */
  private readonly treeDecor: readonly (DecorInstance & { tree: CityTreeId })[]

  constructor(def: TownDef, extra: readonly DecorInstance[] = [], trees: readonly PlacedTree[] = []) {
    super(def)
    this.extraDecor = extra
    this.trees = trees
    this.extraSolid = new Set([
      ...extra.filter(d => isSolidDecor(d.kind)).map(d => `${d.tx},${d.ty}`),
      ...trees.flatMap(t => treeCollisionTiles(t.kind, t.tx, t.ty)).map(t => `${t.tx},${t.ty}`),
    ])
    this.treeDecor = trees.map(t => ({ kind: null, tree: t.kind, tx: t.tx, ty: t.ty, ...treeFeet(t.tx, t.ty), seed: 0 }))
  }

  /** The base a placed tree gets: from the terrain under its trunk (the cell's bottom row). */
  groundBaseOf(tree: PlacedTree): GroundBaseStyle {
    return groundBaseStyle(townGround(this.def.terrain[tree.ty + 1]?.[tree.tx]), tree.kind)
  }

  /** The town's baked ground, then each placed tree's ground base on top (under every sprite). */
  override drawGround(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
    super.drawGround(g, x0, y0, x1, y1)
    for (const t of this.trees) {
      const fx = (t.tx + 1) * TILE
      const fy = (t.ty + 2) * TILE
      if (fx < x0 - 48 || fx > x1 + 48 || fy < y0 - 16 || fy > y1 + 16) continue
      paintTreeGroundBase(g, x0, y0, t.kind, t.tx, t.ty, this.groundBaseOf(t))
    }
  }

  override isSolid(tx: number, ty: number): boolean {
    return super.isSolid(tx, ty) || this.extraSolid.has(`${tx},${ty}`)
  }

  override decorIn(x0: number, y0: number, x1: number, y1: number): readonly DecorInstance[] {
    const base = super.decorIn(x0, y0, x1, y1)
    if (!this.extraDecor.length && !this.treeDecor.length) return base
    for (const d of this.treeDecor) d.sprite ??= cityTreeSprite(d.tree) ?? undefined
    const near = (d: DecorInstance) => d.x > x0 - 96 && d.x < x1 + 96 && d.y > y0 && d.y < y1 + 180
    return base.concat(this.extraDecor.filter(near), this.treeDecor.filter(d => d.sprite && near(d)))
  }
}

/** Builds the real area for a working copy. */
export function labArea(city: LabCity, base: TownDef): LabTownArea {
  return new LabTownArea(
    toTownDef(city, base),
    labDecor(city).map(p => decorInstanceAt(p.kind, p.tx, p.ty)),
    labTrees(city).map(p => ({ id: p.id, kind: p.kind, tx: p.tx, ty: p.ty })),
  )
}
