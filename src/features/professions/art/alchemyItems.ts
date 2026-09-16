// 16×16 icons for the alchemy kit: the berries and herbs Alchemy gathers, and
// the bottled products it makes. Same shading recipe as the other three kits.
//
// Items other professions already draw (vial, seaweed, heart scale, fish oil,
// planks, resin) are NOT redrawn here: `ItemGlyph` keeps using their kit.

import { TRANSPARENT } from '../../wildlands/engine/pixels'
import { capsules, ellipses, layer, shade, type ShadeFn } from '../../wildlands/engine/sprite'
import {
  BERRY_TONES, CORK_TONES, ESSENCE_TONES, GLASS_OUTLINE, GLASS_TONES, HERB_TONES,
  LEAF_OUTLINE_TONE, LEAF_TONES, liquidOf, REVIVAL_TONES, SPARKLE_TONES,
} from './alchemyPalette'
import { color, pixelArt, type PixelArt } from './pixelArt'

const S = 16
const cache = new Map<string, PixelArt>()
const memo = (key: string, build: () => PixelArt): PixelArt => {
  let art = cache.get(key)
  if (!art) cache.set(key, (art = build()))
  return art
}

// ── Ingredients ─────────────────────────────────────────────────────────────

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
  const leafPixels = shade(S, S, leaf, { tones: LEAF_TONES, outline: LEAF_OUTLINE_TONE, dither: 0.25 })
  const out = layer(pixels, leafPixels)
  out[9 * S + 6] = color('#ffffff')
  return pixelArt(S, S, out)
}

/** Medicinal herb: a small bundle of leaves tied at the stem. */
function herbIcon(tones: readonly string[], outline: string, flower: string | null): PixelArt {
  const stems: ShadeFn = (x, y) => (y >= 9 && y <= 13 && Math.abs(x + 0.5 - 8) <= 1 ? 0.7 : null)
  const blades = capsules([
    [8, 11, 4, 4, 1.4], [8, 11, 12, 4, 1.4], [8, 12, 8, 2, 1.5],
  ])
  const pixels = layer(
    shade(S, S, stems, { tones: [tones[0]], outline, dither: 0 }),
    shade(S, S, blades, { tones, outline, dither: 0.3 }),
  )
  if (flower) {
    pixels[2 * S + 8] = color(flower)
    pixels[3 * S + 7] = color(flower)
    pixels[3 * S + 9] = color(flower)
  }
  // The tie: what makes it a gathered bundle and not a bush.
  for (let x = 6; x <= 10; x++) pixels[13 * S + x] = color(CORK_TONES[0])
  return pixelArt(S, S, pixels)
}

/** Wild essence: a floating wisp with a bright core (a PvE drop, not a plant). */
function essenceIcon(): PixelArt {
  const body: ShadeFn = (x, y) => {
    const dx = (x + 0.5 - 8) / 3.6
    const dy = (y + 0.5 - 8.5) / 5
    const d = dx * dx + dy * dy
    return d <= 1 ? 1 - d * 0.5 : null
  }
  const pixels = shade(S, S, body, { tones: ESSENCE_TONES, outline: '#1e1440', dither: 0.45 })
  for (const [x, y] of [[8, 6], [7, 8], [9, 9]] as const) pixels[y * S + x] = color('#ffffff')
  // Two sparks orbiting it.
  pixels[4 * S + 12] = color(ESSENCE_TONES[2])
  pixels[12 * S + 4] = color(ESSENCE_TONES[2])
  return pixelArt(S, S, pixels)
}

/** Herbal extract: a squat corked jar of deep green. */
function extractIcon(): PixelArt {
  return bottleIcon('herbal_extract', 'jar')
}

// ── Products ────────────────────────────────────────────────────────────────

type BottleShape = 'flask' | 'jar' | 'phial'

/**
 * A bottled product: glass body, liquid filling the lower two thirds, cork on
 * top and a single highlight. The shape separates the families (round flask for
 * potions, squat jar for preparations, tall phial for ether and revive) and the
 * liquid colour separates the products.
 */
function bottleIcon(itemId: string, shape: BottleShape): PixelArt {
  const ink = liquidOf(itemId)
  const body: ShadeFn = shape === 'flask'
    ? (x, y) => {
      const dx = (x + 0.5 - 8) / 4.6
      const dy = (y + 0.5 - 10.5) / 4.2
      if (dx * dx + dy * dy <= 1) return 0.9
      return y >= 4 && y <= 7 && Math.abs(x + 0.5 - 8) <= 1.6 ? 0.8 : null
    }
    : shape === 'jar'
      ? (x, y) => (y >= 6 && y <= 13 && Math.abs(x + 0.5 - 8) <= 4 ? 0.9 : y >= 3 && y <= 5 && Math.abs(x + 0.5 - 8) <= 2 ? 0.8 : null)
      : (x, y) => (y >= 4 && y <= 13 && Math.abs(x + 0.5 - 8) <= 2.6 ? 0.9 : null)
  const pixels = shade(S, S, body, { tones: GLASS_TONES, outline: GLASS_OUTLINE, dither: 0.2 })

  // Fill from the bottom: the liquid never touches the outline, so the glass reads.
  const surface = shape === 'flask' ? 8 : shape === 'jar' ? 8 : 7
  for (let y = surface; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x
      if (pixels[i] === TRANSPARENT || pixels[i] === color(GLASS_OUTLINE)) continue
      const depth = (y - surface) / (S - surface)
      pixels[i] = color(y === surface ? ink.tones[2] : depth > 0.55 ? ink.tones[0] : ink.tones[1])
    }
  }
  // Cork and highlight.
  const neck = shape === 'flask' ? 4 : shape === 'jar' ? 3 : 4
  for (let x = 6; x <= 9; x++) {
    pixels[(neck - 1) * S + x] = color(CORK_TONES[1])
    pixels[(neck - 2) * S + x] = color(CORK_TONES[0])
  }
  pixels[(neck + 1) * S + 6] = color(GLASS_TONES[3])
  pixels[(neck + 2) * S + 6] = color(GLASS_TONES[3])
  return pixelArt(S, S, pixels)
}

/** A finished revive carries one sparkle: it is the rare product of the kit. */
function reviveIcon(): PixelArt {
  const art = bottleIcon('revive', 'phial')
  const pixels = Uint32Array.from(art.pixels)
  for (const [x, y, tone] of [[12, 4, SPARKLE_TONES[0]], [13, 3, SPARKLE_TONES[1]], [11, 3, SPARKLE_TONES[2]]] as const) {
    pixels[y * S + x] = color(tone)
  }
  return pixelArt(S, S, pixels)
}

const BUILDERS: Readonly<Record<string, () => PixelArt>> = {
  oran_berry: () => berryIcon('oran'),
  leppa_berry: () => berryIcon('leppa'),
  sitrus_berry: () => berryIcon('sitrus'),
  medicinal_herb: () => herbIcon(HERB_TONES, '#12381c', null),
  revival_herb: () => herbIcon(REVIVAL_TONES, '#2c123a', SPARKLE_TONES[1]),
  wild_essence: essenceIcon,
  herbal_extract: extractIcon,
  potion: () => bottleIcon('potion', 'flask'),
  super_potion: () => bottleIcon('super_potion', 'flask'),
  hyper_potion: () => bottleIcon('hyper_potion', 'flask'),
  ether: () => bottleIcon('ether', 'phial'),
  revive: reviveIcon,
  vigor_tea: () => bottleIcon('vigor_tea', 'jar'),
}

export const ALCHEMY_ICON_IDS: readonly string[] = Object.keys(BUILDERS)

export function alchemyIconArt(itemId: string): PixelArt | null {
  const build = BUILDERS[itemId]
  return build ? memo(`icon|${itemId}`, build) : null
}

/** The liquid a recipe's first output carries, for the flask on the bench. */
export { liquidOf }
