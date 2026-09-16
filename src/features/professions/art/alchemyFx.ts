// Alchemy effects (R31-C4). Small, cheap and repeatable: the player will brew
// hundreds of times, so nothing here is bigger than 6×6 or lives long.
//
// The language is deliberately *soft* — rising bubbles and steam — against the
// hard chips of Mining, the splash of Fishing and the splinters of Logging.

import { ellipses, shade } from '../../wildlands/engine/sprite'
import { SPARKLE_TONES, STEAM_TONES, type Liquid } from './alchemyPalette'
import { color, pixelArt, type PixelArt } from './pixelArt'

const cache = new Map<string, PixelArt>()
const memo = (key: string, build: () => PixelArt): PixelArt => {
  let art = cache.get(key)
  if (!art) cache.set(key, (art = build()))
  return art
}

/** A bubble in the product's own colour: full, then a ring just before it pops. */
export function bubbleFxArt(ink: Liquid, popping: boolean): PixelArt {
  return memo(`bubble|${ink.tones[1]}|${popping}`, () => {
    const s = 4
    const pixels = new Uint32Array(s * s)
    if (popping) {
      // A ring: the skin of the bubble, an instant before it is gone.
      for (const [x, y] of [[1, 0], [2, 0], [0, 1], [3, 1], [0, 2], [3, 2], [1, 3], [2, 3]] as const) {
        pixels[y * s + x] = color(ink.tones[2])
      }
    } else {
      for (const [x, y] of [[1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [3, 1], [1, 2], [2, 2], [3, 2], [1, 3], [2, 3]] as const) {
        pixels[y * s + x] = color(ink.tones[1])
      }
      pixels[1 * s + 1] = color(ink.tones[2])
    }
    return pixelArt(s, s, pixels)
  })
}

/** Steam: three frames that grow and thin out as they rise. */
export function steamArt(frame: 0 | 1 | 2): PixelArt {
  return memo(`steam|${frame}`, () => {
    const s = 6
    const radius = 1.4 + frame * 0.7
    const pixels = shade(s, s, ellipses([[3, 3, radius, radius * 0.85]]), {
      tones: [STEAM_TONES[2 - frame], STEAM_TONES[Math.max(0, 1 - frame)]], outline: STEAM_TONES[0], dither: 0.5,
    })
    return pixelArt(s, s, pixels)
  })
}

/** A drop of the product, for the moment the flask is poured into the phial. */
export function dropletArt(ink: Liquid): PixelArt {
  return memo(`drop|${ink.tones[1]}`, () => {
    const s = 3
    const pixels = new Uint32Array(s * s)
    pixels[0 * s + 1] = color(ink.tones[2])
    pixels[1 * s + 1] = color(ink.tones[1])
    pixels[2 * s + 1] = color(ink.tones[0])
    return pixelArt(s, s, pixels)
  })
}

/** The four-point spark that marks a finished batch (and a saved ingredient). */
export function sparkleArt(strong: boolean): PixelArt {
  return memo(`spark|${strong}`, () => {
    const s = 5
    const pixels = new Uint32Array(s * s)
    const tone = color(strong ? SPARKLE_TONES[1] : SPARKLE_TONES[0])
    for (const [x, y] of [[2, 0], [2, 1], [2, 3], [2, 4], [0, 2], [1, 2], [3, 2], [4, 2]] as const) pixels[y * s + x] = tone
    pixels[2 * s + 2] = color(SPARKLE_TONES[2])
    return pixelArt(s, s, pixels)
  })
}
