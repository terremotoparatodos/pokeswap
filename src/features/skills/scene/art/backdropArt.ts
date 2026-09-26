// Backdrop props (MAP-2).
//
// In an area with resource zones, a tree, pine or rock outside every zone is
// scenery, not a resource. It must not be an exact copy of the ones that work,
// so it is drawn as backdrop: the world's own prop, desaturated and darker.
// No new art: the same pixels, recoloured.

import type { TreeKind } from '../../../wildlands/engine/props'
import { plainRockArt, type RockAnchor } from './miningNodes'
import { plainTreeArt } from './loggingTrees'
import { desaturate, mapColors, type PixelArt } from './pixelArt'

/**
 * How far a backdrop prop is pulled toward grey and darkened. Rocks are grey
 * already, so they are also blended toward the meadow's green (moss) and
 * darkened further: otherwise they would read as the quarry's.
 */
export const BACKDROP = Object.freeze({ desaturate: 0.6, darken: 0.2, rockMoss: 0.4, rockDarken: 0.3, moss: [70, 104, 58] as const })

const cache = new Map<string, PixelArt>()
const memo = (key: string, build: () => PixelArt): PixelArt => {
  let art = cache.get(key)
  if (!art) cache.set(key, (art = build()))
  return art
}

export function backdropTreeArt(kind: TreeKind): PixelArt {
  return memo(`tree|${kind}`, () => desaturate(plainTreeArt(kind), BACKDROP.desaturate, BACKDROP.darken))
}

export function backdropRockArt(anchor: RockAnchor): PixelArt {
  return memo(`rock|${anchor}`, () => {
    const [mr, mg, mb] = BACKDROP.moss
    const k = BACKDROP.rockMoss
    const mossy = mapColors(plainRockArt(anchor), (r, g, b, a) => [r + (mr - r) * k, g + (mg - g) * k, b + (mb - b) * k, a])
    return desaturate(mossy, 0, BACKDROP.rockDarken)
  })
}
