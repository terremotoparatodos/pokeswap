// What a depleted node looks like to everyone (WORLD-1).
//
// Carved from the very prop the world draws — the same trunk, the same rock
// palette — so a stump sits exactly where its tree stood. World-owned: the
// SKILLS overlay may draw richer animation on top for its own worker.

import { ROCK_RECIPES, TREE_METRICS, treeTrunkPixels, type TreeKind } from '../../wildlands/engine/props'
import { ellipses, shade, spriteFromPixels, type Sprite } from '../../wildlands/engine/sprite'

const STUMP_ROWS = 5
const sprites = new Map<string, Sprite>()

function stump(kind: TreeKind): Sprite {
  const { w, h, ax, ay, trunk } = TREE_METRICS[kind]
  const pixels = treeTrunkPixels(kind)
  const keepFrom = Math.floor(trunk[3]) - STUMP_ROWS
  pixels.fill(0, 0, Math.max(0, keepFrom) * w)
  return spriteFromPixels(w, h, pixels, ax, ay)
}

function rubble(kind: keyof typeof ROCK_RECIPES): Sprite {
  const recipe = ROCK_RECIPES[kind]
  const shape = recipe.shape.map(([x, y, rx, ry]) => [x, y + ry * 0.5, rx * 0.8, ry * 0.45] as const)
  const pixels = shade(recipe.w, recipe.h, ellipses(shape), { tones: recipe.tones, outline: recipe.outline })
  return spriteFromPixels(recipe.w, recipe.h, pixels, recipe.w / 2, recipe.h - 1)
}

/** The depleted look of a workable prop, or null for a prop that is not one. */
export function depletedSprite(variant: string): Sprite | null {
  let sprite = sprites.get(variant)
  if (sprite) return sprite
  if (variant === 'tree' || variant === 'pine' || variant === 'snowpine' || variant === 'palm') sprite = stump(variant)
  else if (variant === 'rock' || variant === 'boulder' || variant === 'icerock') sprite = rubble(variant)
  else return null
  sprites.set(variant, sprite)
  return sprite
}
