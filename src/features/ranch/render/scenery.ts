// Standing scenery — Rancho
//
// Everything that stands on the ground and has to sort against the Pokémon by
// depth: the designed props, the paddock fences (autotiled from their
// neighbours) and the trees, pines, bushes and rocks the map scattered.
//
// The list is built once and kept sorted by the y of the sprite's feet, so a
// frame only binary-searches the band it can see instead of walking the map.

import type { Sprite } from '../../wildlands/engine/sprite'
import { FENCE_BASE_Y, FENCE_E, FENCE_N, FENCE_S, FENCE_W } from '../art/fenceArt'
import type { RanchMap } from '../world/ranchMap'
import type { RanchArt } from './ranchArt'

export interface SceneryItem {
  /** Feet of the sprite, in world pixels. */
  x: number
  y: number
  frames: Sprite[]
  /** Index into `frames`, or the frame count to cycle through when animated. */
  variant: number
  animated: boolean
  /** Half width used for culling, in world pixels. */
  half: number
}

/** How far outside the map trees keep going, so the edge is never a bare line. */
const OUTER_TILES = 4

function push(out: SceneryItem[], frames: Sprite[], x: number, y: number, variant: number, animated: boolean): void {
  if (!frames.length) return
  out.push({ x, y, frames, variant, animated, half: frames[0].w / 2 + 2 })
}

export function buildScenery(map: RanchMap, art: RanchArt): SceneryItem[] {
  const items: SceneryItem[] = []

  for (const prop of map.props) {
    push(items, art.props[prop.kind], prop.x, prop.y, prop.variant ?? 0, art.animated.has(prop.kind))
  }

  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      if (!map.fence[ty * map.w + tx]) continue
      const mask =
        (map.fence[(ty - 1) * map.w + tx] ? FENCE_N : 0) |
        (tx + 1 < map.w && map.fence[ty * map.w + tx + 1] ? FENCE_E : 0) |
        (ty + 1 < map.h && map.fence[(ty + 1) * map.w + tx] ? FENCE_S : 0) |
        (tx > 0 && map.fence[ty * map.w + tx - 1] ? FENCE_W : 0)
      push(items, art.fence, tx * 16 + 8, ty * 16 + FENCE_BASE_Y, mask, false)
    }
  }

  // Decor, including a band beyond the map so the forest does not stop dead.
  for (let ty = -OUTER_TILES; ty < map.h + OUTER_TILES; ty++) {
    for (let tx = -OUTER_TILES; tx < map.w + OUTER_TILES; tx++) {
      const kind = map.decorAt(tx, ty)
      if (!kind) continue
      const sprite = art.decor[kind]
      if (!sprite) continue
      // Same jitter the WildLands baker uses, so a tree never sits dead centre.
      const seed = ((tx * 73856093) ^ (ty * 19349663)) >>> 0
      const nudge = ((seed % 5) - 2) | 0
      push(items, [sprite], tx * 16 + 8 + nudge, ty * 16 + 13, 0, false)
    }
  }

  items.sort((a, b) => a.y - b.y || a.x - b.x)
  return items
}

/** First index whose feet are at or below `y`; the list is sorted by y. */
export function lowerBound(items: readonly SceneryItem[], y: number): number {
  let lo = 0
  let hi = items.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (items[mid].y < y) lo = mid + 1
    else hi = mid
  }
  return lo
}
