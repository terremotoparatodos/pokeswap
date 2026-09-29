// A Pokémon cave mouth, in WildLands' own visual language.
//
// Not a glowing sci-fi portal: a rock face with a dark opening, built from the
// same primitives every prop in this world is built from — `shade`, `ellipses`,
// the rock palettes of `ROCK_RECIPES` — so it reads as part of the terrain and
// not as an object pasted on top of it.
//
// Three tiles across and two deep, with the mouth in the middle column, so
// "walk up to it from the front" is the obvious thing to do.

import { packColor, TRANSPARENT } from '../../wildlands/engine/pixels'
import { ROCK_RECIPES } from '../../wildlands/engine/props'
import { ellipses, shade, spriteFromPixels, type ShadeFn, type Sprite } from '../../wildlands/engine/sprite'

/**
 * Built from the engine's own primitives and nothing else. An earlier draft
 * borrowed the professions art kit for `color` and `pixelArt`; that would have
 * made the whole professions feature reachable from a dungeon entrance, which
 * is a dependency a cave has no business creating.
 */
const color = (hex: string): number => packColor(hex)

export interface CavePixels {
  readonly w: number
  readonly h: number
  readonly pixels: Uint32Array
  /** Feet anchor, in art pixels. */
  readonly ax: number
  readonly ay: number
}

/** 3 tiles × 16 px. The footprint is three wide, so the art is too. */
export const CAVE_W = 48
/**
 * Tall enough to be a landmark. The first draft was 46 px and a stand of pines
 * next to it read as taller than the mountain it was supposed to be cut into,
 * so the rock rises well above its two tiles of ground — the same trick the
 * trees themselves use.
 */
export const CAVE_H = 58

const GROUND_Y = CAVE_H - 1

/** Mouth geometry, in art pixels. It stands **on** the ground line, not above it. */
const MOUTH = { cx: 24, cy: 46, rx: 9, ry: 14 } as const

/**
 * Biome tones. Grey rock everywhere except the tundra, which already has its
 * own blue-white rock in `ROCK_RECIPES.icerock`, and the desert, which uses the
 * warm boulder. Same shapes, different palette — the cheapest way to make a
 * cave belong to the place it is standing in.
 */
export type CaveTone = 'stone' | 'ice' | 'sand'

const TONES: Readonly<Record<CaveTone, { tones: readonly string[]; outline: string }>> = {
  stone: { tones: ROCK_RECIPES.rock.tones, outline: ROCK_RECIPES.rock.outline },
  ice: { tones: ROCK_RECIPES.icerock.tones, outline: ROCK_RECIPES.icerock.outline },
  sand: { tones: ROCK_RECIPES.boulder.tones, outline: ROCK_RECIPES.boulder.outline },
}

/** Inside the mountain. Not pure black: pure black reads as a hole in the canvas. */
const DARK = ['#05070c', '#0a0e17', '#121724', '#1d2433'] as const

/**
 * The rock: one wide massif with two shoulders and a crown, so the silhouette
 * is a hill and not a dome. Drawn well past the bottom of the art on purpose —
 * the renderer clips at the feet, and a mound that ends exactly on the ground
 * line gets an unwanted horizontal edge.
 */
const MASSIF = [
  [24, 42, 25, 24],
  [8, 44, 13, 16],
  [40, 44, 13, 16],
  [24, 20, 17, 16],
  [14, 26, 11, 11],
  [34, 26, 11, 11],
  [24, 11, 10, 8],
] as const

/** The opening, darkest at its centre so it reads as depth rather than paint. */
const mouthShade: ShadeFn = (x, y) => {
  const px = (x + 0.5 - MOUTH.cx) / MOUTH.rx
  const py = (y + 0.5 - MOUTH.cy) / MOUTH.ry
  const d = Math.hypot(px, py)
  if (d > 1) return null
  // Squared so the darkness pools in the middle instead of fading linearly.
  return Math.min(1, d * d)
}

const cache = new Map<string, CavePixels>()

export function caveEntranceArt(tone: CaveTone = 'stone'): CavePixels {
  const cached = cache.get(tone)
  if (cached) return cached

  const palette = TONES[tone]
  const rock = shade(CAVE_W, CAVE_H, ellipses(MASSIF), { tones: palette.tones, outline: palette.outline, dither: 0.55 })
  const mouth = shade(CAVE_W, CAVE_H, mouthShade, { tones: DARK, outline: palette.outline, dither: 0.3 })

  const pixels = new Uint32Array(CAVE_W * CAVE_H)
  const rim = color(palette.outline)
  for (let y = 0; y < CAVE_H; y++) {
    for (let x = 0; x < CAVE_W; x++) {
      const i = y * CAVE_W + x
      // The mouth only exists where there is rock to cut it out of; a mouth
      // hanging in the air below the massif would be a floating black hole.
      pixels[i] = mouth[i] !== TRANSPARENT && rock[i] !== TRANSPARENT ? mouth[i] : rock[i]
    }
  }

  // A lintel: one darker row along the top of the opening, which is what makes
  // a hole in a rock look like an entrance and not a stain.
  for (let x = 0; x < CAVE_W; x++) {
    for (let y = 1; y < CAVE_H; y++) {
      const here = pixels[y * CAVE_W + x]
      const above = pixels[(y - 1) * CAVE_W + x]
      const isDark = (DARK as readonly string[]).some(hex => here === color(hex))
      const aboveIsRock = above !== TRANSPARENT && !(DARK as readonly string[]).some(hex => above === color(hex))
      if (isDark && aboveIsRock) pixels[(y - 1) * CAVE_W + x] = rim
    }
  }

  const art: CavePixels = { w: CAVE_W, h: CAVE_H, pixels, ax: Math.floor(CAVE_W / 2), ay: GROUND_Y }
  cache.set(tone, art)
  return art
}

const sprites = new Map<CaveTone, Sprite>()

export function caveEntranceSprite(tone: CaveTone = 'stone'): Sprite {
  let sprite = sprites.get(tone)
  if (!sprite) {
    const art = caveEntranceArt(tone)
    sprite = spriteFromPixels(art.w, art.h, art.pixels, art.ax, art.ay)
    sprites.set(tone, sprite)
  }
  return sprite
}

/** Which palette a world gets, from the biome its arrival point sits in. */
export function toneForBiome(biome: string): CaveTone {
  if (biome === 'tundra' || biome === 'snow' || biome === 'ice') return 'ice'
  if (biome === 'desert' || biome === 'beach' || biome === 'sand') return 'sand'
  return 'stone'
}
