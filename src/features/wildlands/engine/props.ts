// Prop sprites — WildLands prototype
//
// Each prop is described as a handful of lit shapes plus a palette. Variants
// (tint and size) come from the same recipe, so adding a biome is cheap.

import { hash2 } from './noise'
import { packColor } from './pixels'
import { capsules, ellipses, layer, shade, spriteFromPixels, type ShadeFn, type Sprite } from './sprite'
import type { DecorKind } from './world'

export const LEAVES = ['#1d5a2e', '#2c7a37', '#44a043', '#6cc255', '#a4e27c']
export const LEAF_OUTLINE = '#133d20'
export const TRUNK_TONES = ['#4a2c1a', '#6b4125', '#8c5a33', '#a8743f']
export const TRUNK_OUTLINE = '#2a180e'
/** The palm's stem is paler than the other trunks and always was; named, not changed. */
export const PALM_TRUNK_TONES = ['#5d3b1f', '#86592f', '#a87a45', '#c9a066']
export const PALM_TRUNK_OUTLINE = '#35210f'

function trunk(w: number, h: number, x0: number, x1: number, y0: number, y1: number): Uint32Array {
  const cx = (x0 + x1) / 2
  const r = (x1 - x0) / 2
  return shade(w, h, capsules([[cx, y0, cx, y1, r]]), {
    tones: TRUNK_TONES,
    outline: TRUNK_OUTLINE,
    dither: 0.4,
  })
}

/** Trees prototypes derive variants from, keeping the prop's exact footprint (R31-C3). */
export type TreeKind = 'tree' | 'pine' | 'snowpine' | 'palm'

export interface TreeMetrics {
  readonly w: number
  readonly h: number
  /** Feet anchor inside the sprite. */
  readonly ax: number
  readonly ay: number
  /** Trunk box: x0, x1, top, bottom. */
  readonly trunk: readonly [number, number, number, number]
}

export const TREE_METRICS = {
  tree: { w: 34, h: 42, ax: 17, ay: 39, trunk: [14, 20, 26, 38] },
  pine: { w: 28, h: 44, ax: 14, ay: 43, trunk: [11.5, 16.5, 32, 42] },
  snowpine: { w: 28, h: 44, ax: 14, ay: 43, trunk: [11.5, 16.5, 32, 42] },
  palm: { w: 40, h: 46, ax: 15, ay: 45, trunk: [13, 18, 34, 44] },
} as const satisfies Record<TreeKind, TreeMetrics>

const TREE_CANOPY = [
  [17, 16, 12, 10], [9, 21, 7.5, 6.5], [25, 21, 7.5, 6.5], [17, 22, 10, 7], [12, 9, 6.5, 5.5], [22, 9, 6.5, 5.5],
] as const

/** Bare trunk of a tree kind: what a stump or a sapling is carved from. */
export function treeTrunkPixels(kind: TreeKind): Uint32Array {
  const { w, h, trunk: box } = TREE_METRICS[kind]
  return trunk(w, h, box[0], box[1], box[2], box[3])
}

/** The very pixels the world draws for this prop. */
export function treeKindPixels(kind: TreeKind): Uint32Array {
  if (kind === 'palm') return palmPixels()
  if (kind !== 'tree') return pinePixels(kind === 'snowpine')
  const { w, h } = TREE_METRICS.tree
  const canopy = shade(w, h, ellipses(TREE_CANOPY), { tones: LEAVES, outline: LEAF_OUTLINE })
  return layer(treeTrunkPixels('tree'), canopy)
}

function tree(): Sprite {
  const { w, h, ax, ay } = TREE_METRICS.tree
  return spriteFromPixels(w, h, treeKindPixels('tree'), ax, ay)
}

function pinePixels(snowy: boolean): Uint32Array {
  const { w, h } = TREE_METRICS.pine
  const base = treeTrunkPixels('pine')
  const tiers = [0, 1, 2, 3].map(i => ({ top: 1 + i * 8, bottom: 16 + i * 8, half: 5 + i * 3 }))
  const fn: ShadeFn = (x, y) => {
    const px = x + 0.5 - 14
    const py = y + 0.5
    for (let i = tiers.length - 1; i >= 0; i--) {
      const { top, bottom, half } = tiers[i]
      if (py < top || py > bottom) continue
      const t = (py - top) / (bottom - top)
      // Jagged hem gives the needle silhouette.
      const reach = half * t + (t > 0.8 && (x + i) % 3 === 0 ? 1 : 0)
      if (Math.abs(px) > reach) continue
      let b = 0.72 - (px / (half + 0.01)) * 0.3 - t * 0.35
      if (snowy && t < 0.42 && px < half * 0.4) b = 0.95
      return Math.max(0, Math.min(1, b))
    }
    return null
  }
  const tones = snowy
    ? ['#173f33', '#255a45', '#35775a', '#dfe9f5', '#ffffff']
    : ['#143a29', '#1f5a38', '#2f7c47', '#48a258', '#76c56f']
  const crown = shade(w, h, fn, { tones, outline: '#0e2a1e', dither: 0.6 })
  return layer(base, crown)
}

function pine(snowy: boolean): Sprite {
  const { w, h, ax, ay } = TREE_METRICS.pine
  return spriteFromPixels(w, h, pinePixels(snowy), ax, ay)
}

function palmPixels(): Uint32Array {
  const { w, h } = TREE_METRICS.palm
  const stem = shade(w, h, capsules([
    [15, 44, 16, 34, 2.4], [16, 34, 19, 24, 2.2], [19, 24, 23, 15, 2],
  ]), { tones: PALM_TRUNK_TONES, outline: PALM_TRUNK_OUTLINE, dither: 0.3 })
  const fronds: [number, number, number, number, number][] = []
  const top = [23, 14]
  for (const angle of [-165, -125, -60, -15, 25, 150]) {
    const a = (angle * Math.PI) / 180
    let prev = top
    for (let s = 1; s <= 4; s++) {
      const t = s / 4
      const p = [top[0] + Math.cos(a) * 15 * t, top[1] + Math.sin(a) * 9 * t + 7 * t * t]
      fronds.push([prev[0], prev[1], p[0], p[1], 2.6 * (1 - t) + 0.9])
      prev = p
    }
  }
  const leaves = shade(w, h, capsules(fronds), {
    tones: ['#2b6526', '#3e8a31', '#5eae3d', '#93d35a'], outline: '#183d16', dither: 0.5,
  })
  const nuts = shade(w, h, ellipses([[21, 17, 2, 2], [25, 17, 2, 2]]), {
    tones: ['#4a2c14', '#7a4a22'], outline: '#2a180a', dither: 0,
  })
  return layer(layer(stem, leaves), nuts)
}

function palm(): Sprite {
  const { w, h, ax, ay } = TREE_METRICS.palm
  return spriteFromPixels(w, h, palmPixels(), ax, ay)
}

export type Shape = readonly (readonly [number, number, number, number])[]

export interface BlobRecipe {
  readonly w: number
  readonly h: number
  readonly shape: Shape
  readonly tones: readonly string[]
  readonly outline: string
}

/**
 * Rock recipes shared with prototypes that derive variants from the same
 * volumes (R31-C1 mining nodes), so a node keeps the prop's exact footprint.
 */
export const ROCK_RECIPES = {
  rock: { w: 16, h: 12, shape: [[8, 7, 7, 4.8], [6, 6, 4, 3.5]], tones: ['#5b5d66', '#80838c', '#a6a9b0', '#cfd1d4'], outline: '#34353c' },
  boulder: {
    w: 30, h: 23, shape: [[15, 13, 13, 9], [10, 9, 7.5, 6.5], [20, 10, 7.5, 6.5]],
    tones: ['#4c3b31', '#6d5546', '#8e735f', '#b09580'], outline: '#2c211b',
  },
  icerock: { w: 20, h: 15, shape: [[10, 9, 9, 5.5], [8, 7, 5, 4.5]], tones: ['#5e7ea8', '#86a8cf', '#b9d6f0', '#eef7ff'], outline: '#3a5578' },
} as const satisfies Record<string, BlobRecipe>

export const CRYSTAL_RECIPE = {
  w: 14, h: 18,
  shards: [[7, 9, 3.2, 8], [3.5, 12, 2.2, 5], [10.5, 12.5, 2.2, 4.5]] as readonly (readonly [number, number, number, number])[],
  tones: ['#2a7fa8', '#46b3d6', '#8fe3f5', '#e9fdff'],
  outline: '#1a4d66',
} as const

function blob(w: number, h: number, shape: Shape, tones: readonly string[], outline: string, holes = 0): Sprite {
  const fn = ellipses(shape)
  const holed: ShadeFn = holes > 0
    ? (x, y) => (hash2(x, y, 5) < holes ? null : fn(x, y))
    : fn
  return spriteFromPixels(w, h, shade(w, h, holed, { tones, outline }), w / 2, h - 1)
}

function rockBlob(recipe: BlobRecipe): Sprite {
  return blob(recipe.w, recipe.h, recipe.shape, recipe.tones, recipe.outline)
}

function cactus(): Sprite {
  const w = 20, h = 30
  const body = shade(w, h, capsules([
    [10, 6, 10, 27, 3.6],
    [3.5, 11, 3.5, 17, 2.4], [3.5, 17, 9, 17, 2.4],
    [16.5, 7, 16.5, 13, 2.4], [16.5, 13, 11, 13, 2.4],
  ]), { tones: ['#276332', '#3a8a42', '#56ad4f', '#83cf69'], outline: '#183c20', dither: 0.35 })
  // Spines and a flower on top.
  const spine = packColor('#a4f0c8')
  for (let y = 8; y < 26; y += 3) body[y * w + 9] = spine
  const pink = packColor('#f070b0')
  body[2 * w + 9] = pink
  body[2 * w + 10] = pink
  body[1 * w + 10] = packColor('#ffc880')
  return spriteFromPixels(w, h, body, 10, 29)
}

function coral(): Sprite {
  const w = 18, h = 18
  const px = shade(w, h, capsules([
    [9, 17, 9, 10, 1.6], [9, 12, 5, 7, 1.3], [9, 11, 13, 6, 1.3], [5, 7, 4, 3, 1.1], [13, 6, 14, 2, 1.1], [9, 10, 9, 5, 1.1],
  ]), { tones: ['#7d3f82', '#a860a3', '#cf8fc0', '#f2c4dc'], outline: '#4e2552', dither: 0.4 })
  return spriteFromPixels(w, h, px, 9, 17)
}

function crystal(): Sprite {
  const { w, h, shards } = CRYSTAL_RECIPE
  const fn: ShadeFn = (x, y) => {
    for (const [cx, cy, hw, hh] of shards) {
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      if (Math.abs(dx) / hw + Math.abs(dy) / hh <= 1) return dx < 0 ? (dy < 0 ? 1 : 0.7) : dy < 0 ? 0.5 : 0.2
    }
    return null
  }
  const px = shade(w, h, fn, { tones: CRYSTAL_RECIPE.tones, outline: CRYSTAL_RECIPE.outline, dither: 0 })
  return spriteFromPixels(w, h, px, 7, 17)
}

export function buildPropSprites(): Record<DecorKind, Sprite> {
  return {
    tree: tree(),
    pine: pine(false),
    snowpine: pine(true),
    palm: palm(),
    cactus: cactus(),
    coral: coral(),
    crystal: crystal(),
    bush: blob(24, 17, [[8, 10, 6.5, 5.5], [16, 10, 6.5, 5.5], [12, 7, 6.5, 5.5]], LEAVES.slice(1), LEAF_OUTLINE),
    drybush: blob(22, 15, [[7, 9, 6, 4.5], [15, 9, 6, 4.5], [11, 6, 6, 4.5]],
      ['#6b4a2a', '#8a6436', '#a88148', '#c9a15e'], '#3e2a17', 0.2),
    rock: rockBlob(ROCK_RECIPES.rock),
    boulder: rockBlob(ROCK_RECIPES.boulder),
    icerock: rockBlob(ROCK_RECIPES.icerock),
    searock: blob(24, 16, [[12, 10, 11, 6], [9, 8, 6, 5], [16, 8, 5, 4.5]], ['#3c4a5c', '#5a6b80', '#7e90a6', '#a8b8c9'], '#222b36'),
    shell: blob(10, 8, [[5, 4.5, 4, 3]], ['#d9a08a', '#f0c2ae', '#fde3d6'], '#9b6a58'),
  }
}
