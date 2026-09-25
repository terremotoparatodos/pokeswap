// 16×16 icons for Agricultura's harvests: three berries and two herbs.
//
// Extracted from the retired alchemy kit (R31-C4) — same shapes and tones,
// so a player who saw an Aranja before still recognises it. Only what the
// farming harvest needs came along.

import { capsules, ellipses, layer, shade, type ShadeFn } from '../../../wildlands/engine/sprite'
import { color, pixelArt, type PixelArt } from './pixelArt'

const S = 16

const BERRY_TONES = {
  oran: { tones: ['#1e4f8f', '#2f7ad1', '#6fb2f2'], outline: '#0d2b4f' },
  leppa: { tones: ['#8f2410', '#d14a1e', '#f2895a'], outline: '#4a1207' },
  sitrus: { tones: ['#8a7a10', '#d1c02a', '#f2e87a'], outline: '#4a3f07' },
} as const
const LEAF_TONES = ['#1d5a2e', '#2c7a37', '#44a043', '#6cc255'] as const
const LEAF_OUTLINE = '#133d20'
const HERB_TONES = ['#2c6a3a', '#4a9a52', '#84c67a'] as const
const REVIVAL_TONES = ['#6a2c74', '#a854c0', '#e2a8f0'] as const
const SPARKLE = '#ffe07a'
const TIE = '#8a5c31'

const cache = new Map<string, PixelArt>()

/** A berry: round body, a stem and one leaf, in the berry's own colour. */
function berryIcon(kind: keyof typeof BERRY_TONES): PixelArt {
  const berry = BERRY_TONES[kind]
  const pixels = shade(S, S, ellipses([[8, 10, 5, 4.6]]), { tones: berry.tones, outline: berry.outline, dither: 0.3 })
  // Stem and leaf, so a berry never reads as a stone.
  for (let y = 2; y <= 5; y++) pixels[y * S + 8] = color(HERB_TONES[0])
  const leaf: ShadeFn = (x, y) => {
    const dx = (x + 0.5 - 11) / 3
    const dy = (y + 0.5 - 4) / 1.6
    return dx * dx + dy * dy <= 1 ? 0.85 : null
  }
  const out = layer(pixels, shade(S, S, leaf, { tones: LEAF_TONES, outline: LEAF_OUTLINE, dither: 0.25 }))
  out[9 * S + 6] = color('#ffffff')
  return pixelArt(S, S, out)
}

/** A small bundle of leaves tied at the stem; the revival herb flowers. */
function herbIcon(tones: readonly string[], outline: string, flower: string | null): PixelArt {
  const stems: ShadeFn = (x, y) => (y >= 9 && y <= 13 && Math.abs(x + 0.5 - 8) <= 1 ? 0.7 : null)
  const blades = capsules([[8, 11, 4, 4, 1.4], [8, 11, 12, 4, 1.4], [8, 12, 8, 2, 1.5]])
  const pixels = layer(
    shade(S, S, stems, { tones: [tones[0]], outline, dither: 0 }),
    shade(S, S, blades, { tones, outline, dither: 0.3 }),
  )
  if (flower) {
    pixels[2 * S + 8] = color(flower)
    pixels[3 * S + 7] = color(flower)
    pixels[3 * S + 9] = color(flower)
  }
  for (let x = 6; x <= 10; x++) pixels[13 * S + x] = color(TIE)
  return pixelArt(S, S, pixels)
}

const BUILDERS: Readonly<Record<string, () => PixelArt>> = {
  oran_berry: () => berryIcon('oran'),
  leppa_berry: () => berryIcon('leppa'),
  sitrus_berry: () => berryIcon('sitrus'),
  medicinal_herb: () => herbIcon(HERB_TONES, '#12381c', null),
  revival_herb: () => herbIcon(REVIVAL_TONES, '#2c123a', SPARKLE),
}

export function cropIconArt(itemId: string): PixelArt | null {
  const build = BUILDERS[itemId]
  if (!build) return null
  let art = cache.get(itemId)
  if (!art) cache.set(itemId, (art = build()))
  return art
}
