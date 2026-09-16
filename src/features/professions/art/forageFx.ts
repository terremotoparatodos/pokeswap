// Foraging effects (R31-C4.1). Vegetal, not mineral: what comes off a plant
// when you pick it is a petal, a seed or a cut blade, never a chip of stone.

import { ellipses, shade } from '../../wildlands/engine/sprite'
import { FROST_CORE, FROST_PETALS, HERB_BLADES, HERB_FLOWERS, SPARKLE_TONES } from './foragePalette'
import { color, pixelArt, type PixelArt } from './pixelArt'

const cache = new Map<string, PixelArt>()
const memo = (key: string, build: () => PixelArt): PixelArt => {
  let art = cache.get(key)
  if (!art) cache.set(key, (art = build()))
  return art
}

/** A petal: wider than tall and lopsided, so it never reads as a bubble. */
export function petalArt(tone: string, open: boolean): PixelArt {
  return memo(`petal|${tone}|${open}`, () => {
    const w = 4
    const h = 3
    const pixels = new Uint32Array(w * h)
    const put = (x: number, y: number, value: string) => { pixels[y * w + x] = color(value) }
    if (open) {
      put(1, 0, tone); put(2, 0, tone)
      put(0, 1, tone); put(1, 1, tone); put(2, 1, tone); put(3, 1, tone)
      put(1, 2, tone)
    } else {
      put(1, 0, tone); put(2, 1, tone); put(1, 1, tone)
    }
    return pixelArt(w, h, pixels)
  })
}

/** A cut blade of grass spinning away from the sickle. */
export function bladeArt(upright: boolean): PixelArt {
  return memo(`blade|${upright}`, () => {
    const w = upright ? 2 : 4
    const h = upright ? 4 : 2
    const pixels = new Uint32Array(w * h)
    for (let i = 0; i < 4; i++) {
      const x = upright ? (i < 2 ? 0 : 1) : i
      const y = upright ? i : i < 2 ? 0 : 1
      pixels[y * w + x] = color(HERB_BLADES[i % 2 === 0 ? 2 : 1])
    }
    return pixelArt(w, h, pixels)
  })
}

/** A seed shaken loose: one dark dot with a lit top. */
export function seedArt(): PixelArt {
  return memo('seed', () => {
    const pixels = new Uint32Array(4)
    pixels[0] = color('#e4d9a8')
    pixels[1] = color('#8a7442')
    pixels[2] = color('#5e4f2c')
    pixels[3] = color('#8a7442')
    return pixelArt(2, 2, pixels)
  })
}

/** Green dust: what a handful of leaves leaves behind. */
export function pollenArt(dense: boolean): PixelArt {
  return memo(`pollen|${dense}`, () => {
    const s = 4
    const pixels = shade(s, s, ellipses([[2, 2, dense ? 2 : 1.3, dense ? 1.8 : 1.1]]), {
      tones: [HERB_BLADES[1], HERB_BLADES[3]], outline: HERB_BLADES[0], dither: 0.6,
    })
    return pixelArt(s, s, pixels)
  })
}

/** Frost mote: the cold counterpart, for the tundra bloom only. */
export function frostMoteArt(bright: boolean): PixelArt {
  return memo(`frost|${bright}`, () => {
    const s = 3
    const pixels = new Uint32Array(s * s)
    const tone = bright ? FROST_CORE[1] : FROST_PETALS[1]
    pixels[1] = color(tone)
    pixels[3] = color(tone)
    pixels[4] = color(bright ? SPARKLE_TONES[2] : FROST_PETALS[2])
    pixels[5] = color(tone)
    pixels[7] = color(tone)
    return pixelArt(s, s, pixels)
  })
}

/** Tones the petal particles cycle through, per node. */
export const PETAL_TONES: Readonly<Record<string, readonly string[]>> = {
  berry_bush: [HERB_BLADES[2], HERB_BLADES[3], '#6fb2f2'],
  herb_patch: [HERB_FLOWERS[0], HERB_FLOWERS[1], HERB_BLADES[3]],
  wild_grove: [HERB_BLADES[2], '#f2e87a', '#f2895a'],
  frost_bloom: [FROST_PETALS[1], FROST_PETALS[2], FROST_CORE[0]],
}
