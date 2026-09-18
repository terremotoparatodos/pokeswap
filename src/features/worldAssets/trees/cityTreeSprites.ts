// City tree family — sprites.
//
// Loads each asset through the engine's own `loadImageSprite` with the same
// options TownArea passes for a forest tree (no flat top, default shadow), so
// a placed tree and a forest tree share one cached `Sprite` object: same
// pixels, same silhouette shadow, same anchor.

import { loadImageSprite, type Sprite } from '../../wildlands/engine/sprite'
import { cityTree, type CityTreeId } from './cityTrees'

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
