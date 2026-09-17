// Cave tiles, drawn with WildLands' own recipe (D1.1 §2, §3).
//
// The engine's props are not hand-drawn: they are shaded volumes lit from the
// top-left, quantised to a short palette with ordered dithering and finished
// with a 1 px outline (`engine/sprite.ts`). Using that same recipe here is what
// makes the dungeon look like the same game instead of a parallel mock-up.
//
// Reused from production, unmodified: `shade`, `ellipses`, `capsules`, `layer`
// and `spriteFromPixels`. Nothing in WildLands is touched.

import { capsules, ellipses, layer, shade, spriteFromPixels, type Sprite } from '../../wildlands/engine/sprite'
import type { DungeonTheme } from '../domain/tiers'
import type { TileKind } from '../domain/floorTiles'

export const TILE = 24

interface ThemePalette {
  readonly rock: readonly string[]
  readonly floor: readonly string[]
  readonly water: readonly string[]
  readonly accent: readonly string[]
  readonly wood: readonly string[]
}

/** One cave, six biomes. Only the palette changes; the shapes are shared. */
const PALETTES: Readonly<Record<DungeonTheme, ThemePalette>> = {
  cave: {
    rock: ['#0d1220', '#161d33', '#202a47', '#2b375c'],
    floor: ['#4a5878', '#5a6a8f', '#6a7ca4', '#7b8fba'],
    water: ['#1d3a58', '#26496e', '#316084', '#4278a0'],
    accent: ['#5d6b96', '#7b8cba', '#9aabd6', '#b9c8ea'],
    wood: ['#4a3a26', '#5f4a30', '#77603e', '#8d7350'],
  },
  mine: {
    rock: ['#17130d', '#221c14', '#2e261b', '#3b3124'],
    floor: ['#5a4d3c', '#6c5d49', '#7e6d57', '#907e66'],
    water: ['#25303c', '#2f3e4e', '#3b4f63', '#4a6278'],
    accent: ['#8a7a5a', '#a99672', '#c6b28b', '#e0cda6'],
    wood: ['#4a3a26', '#5f4a30', '#77603e', '#8d7350'],
  },
  glacier: {
    rock: ['#141d30', '#1e2a43', '#293857', '#35476c'],
    floor: ['#6d829f', '#8098b5', '#93adca', '#a7c2df'],
    water: ['#2b5570', '#356a8a', '#4384a6', '#57a0c0'],
    accent: ['#a8d4ef', '#c2e4f8', '#dcf1ff', '#f2fbff'],
    wood: ['#4a3a26', '#5f4a30', '#77603e', '#8d7350'],
  },
  forest: {
    rock: ['#0e160b', '#161f11', '#1f2b18', '#293720'],
    floor: ['#4b5c3c', '#5a6d49', '#6a7e56', '#7b9064'],
    water: ['#1f3f39', '#2a534b', '#376a5f', '#478274'],
    accent: ['#4c7a4a', '#63975e', '#7cb374', '#97cf8d'],
    wood: ['#4a3a26', '#5f4a30', '#77603e', '#8d7350'],
  },
  volcano: {
    rock: ['#150c0c', '#1f1312', '#2b1b18', '#38241f'],
    floor: ['#5b423a', '#6d5046', '#7f5f52', '#916e5f'],
    water: ['#5c1f10', '#7a2d16', '#9c4420', '#c4642c'],
    accent: ['#a5462c', '#c65f36', '#e07c44', '#f59a58'],
    wood: ['#4a3a26', '#5f4a30', '#77603e', '#8d7350'],
  },
  ruin: {
    rock: ['#17170f', '#212016', '#2c2b1e', '#383627'],
    floor: ['#5c5845', '#6d6853', '#7e7962', '#908a71'],
    water: ['#25384c', '#2f4860', '#3c5b78', '#4c7192'],
    accent: ['#9c8f72', '#b8a98a', '#d2c3a3', '#e8dbbd'],
    wood: ['#4a3a26', '#5f4a30', '#77603e', '#8d7350'],
  },
  tower: {
    rock: ['#120e22', '#1b1632', '#251e45', '#302759'],
    floor: ['#4d4477', '#5c528b', '#6c619f', '#7d71b3'],
    water: ['#2a2b55', '#35376e', '#434689', '#5459a6'],
    accent: ['#7b6fa8', '#9a8dc8', '#b8ade2', '#d5cef3'],
    wood: ['#4a3a26', '#5f4a30', '#77603e', '#8d7350'],
  },
}

const flat = (value: number) => () => value

/** A plain lit slab: the ground of the cave. */
function slab(palette: readonly string[], light: number): Uint32Array {
  return shade(TILE, TILE, flat(light), { tones: palette, outline: palette[0], dither: 0.35 })
}

/**
 * A wall block. The lighting gradient runs top-left to bottom-right exactly as
 * the engine's props do, so a wall reads as a volume rather than a flat colour.
 */
function block(palette: readonly string[]): Uint32Array {
  return shade(TILE, TILE, (x, y) => 0.85 - (x / TILE) * 0.2 - (y / TILE) * 0.35, {
    tones: palette, outline: palette[0], dither: 0.5,
  })
}

const rubbleSpots = ellipses([
  [6, 17, 4, 2.5], [16, 19, 5, 3], [11, 8, 3, 2],
])

const crystalSpikes = capsules([
  [12, 18, 12, 6, 3], [7, 19, 8, 11, 2], [17, 19, 18, 12, 2],
])

const cache = new Map<string, Sprite>()

/**
 * The sprite for one tile of one biome. Cached: a floor is drawn thousands of
 * times a second and must not be re-shaded.
 */
export function tileSprite(theme: DungeonTheme, kind: TileKind): Sprite {
  const key = `${theme}:${kind}`
  const hit = cache.get(key)
  if (hit) return hit

  const palette = PALETTES[theme] ?? PALETTES.cave
  let pixels: Uint32Array
  switch (kind) {
    case 'rock':
      pixels = block(palette.rock)
      break
    case 'rubble':
      pixels = layer(slab(palette.floor, 0.55), shade(TILE, TILE, rubbleSpots, {
        tones: palette.rock, outline: palette.floor[1], dither: 0.4,
      }))
      break
    case 'water':
      pixels = shade(TILE, TILE, (x, y) => 0.55 + Math.sin((x + y) * 0.4) * 0.12, {
        tones: palette.water, outline: palette.water[0], dither: 0.5,
      })
      break
    case 'bridge':
      pixels = layer(slab(palette.water, 0.5), shade(TILE, TILE, (_x, y) =>
        (y > 3 && y < TILE - 4 ? 0.8 - (y % 6) * 0.05 : null), {
        tones: palette.wood, outline: palette.wood[0], dither: 0.3,
      }))
      break
    case 'ledge':
      // A step down: bright lip on top, shadow under it.
      pixels = layer(slab(palette.floor, 0.5), shade(TILE, TILE, (_x, y) =>
        (y < 5 ? 0.95 : y < 9 ? 0.25 : null), { tones: palette.rock, outline: palette.floor[1], dither: 0.3 }))
      break
    case 'accent':
      pixels = layer(slab(palette.floor, 0.6), shade(TILE, TILE, crystalSpikes, {
        tones: palette.accent, outline: palette.floor[1], dither: 0.25,
      }))
      break
    case 'stairs':
      pixels = layer(slab(palette.floor, 0.5), shade(TILE, TILE, (_x, y) =>
        (y % 6 < 3 ? 0.9 : 0.45), { tones: palette.accent, outline: palette.accent[0], dither: 0.2 }))
      break
    default:
      pixels = slab(palette.floor, 0.68)
  }

  const sprite = spriteFromPixels(TILE, TILE, pixels, 0, 0)
  cache.set(key, sprite)
  return sprite
}

/** The chest, drawn with the same recipe so it sits in the world. */
export function chestSprite(open: boolean): Sprite {
  const key = `chest:${open}`
  const hit = cache.get(key)
  if (hit) return hit
  const body = shade(20, 16, (x, y) => (y < 6 ? (open ? null : 0.9 - x * 0.02) : 0.7 - y * 0.02), {
    tones: ['#4a3a26', '#6b5330', '#8d7038', '#b08f45'], outline: '#191308', dither: 0.3,
  })
  const bands = shade(20, 16, (_x, y) => (y === 6 || y === 7 ? 1 : null), {
    tones: ['#8a8f9c', '#b9c0d0', '#dfe6f2', '#ffffff'], outline: '#191308', dither: 0,
  })
  const sprite = spriteFromPixels(20, 16, layer(body, bands), 10, 15)
  cache.set(key, sprite)
  return sprite
}

/** A Poké Ball, for throws, summons and switches. */
export function pokeballSprite(): Sprite {
  const hit = cache.get('ball')
  if (hit) return hit
  const top = shade(12, 12, (x, y) => (y < 5 ? 0.95 - x * 0.02 : null), {
    tones: ['#7a1d1d', '#a82a2a', '#d43a3a', '#f45a5a'], outline: '#1a0c0c', dither: 0.2,
  })
  const bottom = shade(12, 12, (x, y) => (y > 6 ? 0.9 - x * 0.02 : null), {
    tones: ['#8d939e', '#c2c8d4', '#e8edf6', '#ffffff'], outline: '#1a0c0c', dither: 0.2,
  })
  const band = shade(12, 12, (_x, y) => (y >= 5 && y <= 6 ? 0.2 : null), {
    tones: ['#14100f', '#221c1a', '#2f2724', '#3d332f'], outline: '#14100f', dither: 0,
  })
  const sprite = spriteFromPixels(12, 12, layer(layer(top, bottom), band), 6, 6)
  cache.set('ball', sprite)
  return sprite
}

/** Fallback for a species with no overworld sheet: a coloured blob with an outline. */
export function blobSprite(tint: string): Sprite {
  const key = `blob:${tint}`
  const hit = cache.get(key)
  if (hit) return hit
  const pixels = shade(20, 20, ellipses([[10, 12, 8, 7]]), {
    tones: [tint, tint, tint, '#ffffff'], outline: '#12182a', dither: 0.2,
  })
  const sprite = spriteFromPixels(20, 20, pixels, 10, 19)
  cache.set(key, sprite)
  return sprite
}
