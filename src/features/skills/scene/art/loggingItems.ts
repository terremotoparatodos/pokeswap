// 16×16 icons for the four woods, plus the falling-leaf tones. SKILLS-1
// removed axes: the Pokémon does the work, so there is no tool to draw.

import { shade, type ShadeFn } from '../../../wildlands/engine/sprite'
import { CUT_RING, CUT_TONES, LEAVES, WOOD_TIERS, type WoodTier } from './loggingPalette'
import { color, pixelArt, type PixelArt } from './pixelArt'

const S = 16
const cache = new Map<string, PixelArt>()
const memo = (key: string, build: () => PixelArt): PixelArt => {
  let art = cache.get(key)
  if (!art) cache.set(key, (art = build()))
  return art
}

// ── Resources ───────────────────────────────────────────────────────────────

/** A log lying down: bark along the body, the pale cut face turned to us. */
function logIcon(tier: WoodTier): PixelArt {
  const bark = WOOD_TIERS[tier]
  const body: ShadeFn = (x, y) => {
    const dy = y + 0.5 - 8.5
    if (x < 2 || x > 13 || Math.abs(dy) > 3.2) return null
    return 0.75 - Math.abs(dy) / 7
  }
  const pixels = shade(S, S, body, { tones: bark.tones, outline: bark.outline, dither: 0.35 })
  // Cut face: an ellipse on the left end with two rings.
  for (let y = 5; y <= 11; y++) {
    for (let x = 2; x <= 5; x++) {
      const dx = (x - 3.5) / 2.2
      const dy = (y - 8.5) / 3.4
      if (dx * dx + dy * dy > 1) continue
      pixels[y * S + x] = color(CUT_TONES[dy < 0 ? 2 : 1])
    }
  }
  pixels[8 * S + 4] = color(CUT_RING)
  pixels[7 * S + 3] = color(CUT_RING)
  // A grain line along the bark.
  for (let x = 7; x <= 12; x += 2) pixels[7 * S + x] = color(bark.streak)
  return pixelArt(S, S, pixels)
}

const RESOURCE_BUILDERS: Readonly<Record<string, () => PixelArt>> = {
  common_log: () => logIcon('common'),
  pine_log: () => logIcon('pine'),
  hardwood_log: () => logIcon('hardwood'),
  boreal_log: () => logIcon('boreal'),
}

export const LOGGING_RESOURCE_ICON_IDS: readonly string[] = Object.keys(RESOURCE_BUILDERS)

export function loggingResourceIconArt(itemId: string): PixelArt | null {
  const build = RESOURCE_BUILDERS[itemId]
  return build ? memo(`res|${itemId}`, build) : null
}

/** Leaf tones used by the falling-leaf particles, per tree kind. */
export const LEAF_PARTICLE_TONES: readonly string[] = [LEAVES[1], LEAVES[2], LEAVES[3]]
