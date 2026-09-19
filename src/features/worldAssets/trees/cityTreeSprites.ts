// City tree family — sprites.
//
// Loads each asset through the engine's own `loadImageSprite` with the same
// options TownArea passes for a forest tree (no flat top, default projected
// shadow), so a placed tree is anchored and shaded by the renderer exactly like
// a forest tree. Also paints the ground bases (treeGroundBase.ts).

import { pixelsToCanvas } from '../../wildlands/engine/pixels'
import { loadImageSprite, type Sprite } from '../../wildlands/engine/sprite'
import { cityTree, rootLift, treeFeet, type CityTreeId } from './cityTrees'
import { groundBasePixels, rootWidth, type GroundBaseStyle } from './treeGroundBase'

const ready = new Map<CityTreeId, Sprite>()
/** Requested once; a PNG that fails to load is not retried every frame. */
const requested = new Set<CityTreeId>()

export function loadCityTreeSprite(id: CityTreeId): Promise<Sprite> {
  return loadImageSprite(cityTree(id).src, { flatTop: undefined, castShadow: undefined }).then(sprite => {
    ready.set(id, sprite)
    return sprite
  })
}

/** The sprite if it has loaded; otherwise starts loading it and returns null (draw nothing this frame). */
export function cityTreeSprite(id: CityTreeId): Sprite | null {
  const sprite = ready.get(id)
  if (sprite) return sprite
  if (!requested.has(id)) {
    requested.add(id)
    loadCityTreeSprite(id).catch(() => undefined)
  }
  return null
}

const bases = new Map<string, HTMLCanvasElement>()

/** Canvas of a ground base (treeGroundBase.ts), built once per style and root width. */
export function groundBaseCanvas(style: GroundBaseStyle, rootWidth: number): { canvas: HTMLCanvasElement; ox: number; oy: number } {
  const art = groundBasePixels(style, rootWidth)
  const key = `${style}:${rootWidth}`
  let canvas = bases.get(key)
  if (!canvas) bases.set(key, (canvas = pixelsToCanvas(art.width, art.height, art.pixels)))
  return { canvas, ox: art.ox, oy: art.oy }
}

/**
 * Paints a placed tree's ground base into a ground buffer whose origin is the
 * world pixel (x0, y0) — the shape of `Area.drawGround` and `SceneOverlay.ground`.
 */
export function paintTreeGroundBase(g: CanvasRenderingContext2D, x0: number, y0: number, tree: CityTreeId, tx: number, ty: number, style: GroundBaseStyle): void {
  const feet = treeFeet(tx, ty)
  const base = groundBaseCanvas(style, rootWidth(tree))
  const rootsY = feet.y - rootLift(tree)
  g.drawImage(base.canvas, Math.round(feet.x - base.ox - x0), Math.round(rootsY - base.oy - y0))
}
