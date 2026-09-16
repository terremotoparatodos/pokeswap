// 16×16 icons for wood resources and axes, plus the in-world swing frames.
// Same shading recipe as the mining and fishing kits.

import { TRANSPARENT } from '../../wildlands/engine/pixels'
import { capsules, ellipses, layer, shade, type ShadeFn } from '../../wildlands/engine/sprite'
import {
  APRICORN_OUTLINE, APRICORN_TONES, AXE_TONES, CUT_RING, CUT_TONES, LEAVES, RESIN_OUTLINE, RESIN_TONES,
  WOOD_TIERS, type AxeTier, type WoodTier,
} from './loggingPalette'
import { color, desaturate, mirror, pixelArt, type PixelArt } from './pixelArt'

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

function resinIcon(): PixelArt {
  const drop: ShadeFn = (x, y) => {
    const dx = (x + 0.5 - 8) / 4
    const dy = (y + 0.5 - 9.5) / 4.6
    if (dx * dx + dy * dy > 1) return null
    return 0.8 - dy * 0.3
  }
  const tail: ShadeFn = (x, y) => (y >= 3 && y <= 6 && Math.abs(x + 0.5 - 8) <= (y - 2) * 0.5 ? 0.9 : null)
  const pixels = layer(
    shade(S, S, drop, { tones: RESIN_TONES, outline: RESIN_OUTLINE, dither: 0.3 }),
    shade(S, S, tail, { tones: RESIN_TONES, outline: RESIN_OUTLINE, dither: 0 }),
  )
  pixels[8 * S + 6] = color('#fff2c4')
  return pixelArt(S, S, pixels)
}

/** Bonguri: a round nut with a darker cap, like the berry-sized props of the era. */
function apricornIcon(): PixelArt {
  const pixels = shade(S, S, ellipses([[8, 9.5, 4.8, 4.4]]), { tones: APRICORN_TONES, outline: APRICORN_OUTLINE, dither: 0.3 })
  for (let x = 6; x <= 10; x++) pixels[4 * S + x] = color(APRICORN_OUTLINE)
  for (let x = 6; x <= 10; x++) pixels[5 * S + x] = color(APRICORN_TONES[0])
  pixels[3 * S + 8] = color(APRICORN_TONES[1])
  pixels[7 * S + 6] = color('#e8d6ff')
  return pixelArt(S, S, pixels)
}

/** A sawn plank seen at a slight angle: long face plus a thin edge. */
function plankIcon(tier: WoodTier): PixelArt {
  const bark = WOOD_TIERS[tier]
  const face: ShadeFn = (x, y) => (x >= 2 && x <= 13 && y >= 6 && y <= 10 ? 0.95 - (y - 6) * 0.1 : null)
  const pixels = shade(S, S, face, { tones: CUT_TONES, outline: CUT_RING, dither: 0.2 })
  for (let x = 3; x <= 12; x += 3) pixels[8 * S + x] = color(bark.streak)
  for (let x = 2; x <= 13; x++) pixels[11 * S + x] = color(bark.tones[1])
  return pixelArt(S, S, pixels)
}

function handleIcon(): PixelArt {
  const pixels = shade(S, S, capsules([[5, 12, 11, 4, 1.6]]), { tones: WOOD_TIERS.common.tones, outline: WOOD_TIERS.common.outline, dither: 0.3 })
  pixels[6 * S + 10] = color(CUT_TONES[2])
  return pixelArt(S, S, pixels)
}

const RESOURCE_BUILDERS: Readonly<Record<string, () => PixelArt>> = {
  common_log: () => logIcon('common'),
  hardwood_log: () => logIcon('hardwood'),
  boreal_log: () => logIcon('boreal'),
  resin: resinIcon,
  apricorn: apricornIcon,
  plank: () => plankIcon('common'),
  hardwood_plank: () => plankIcon('hardwood'),
  tool_handle: handleIcon,
}

export const LOGGING_RESOURCE_ICON_IDS: readonly string[] = Object.keys(RESOURCE_BUILDERS)

export function loggingResourceIconArt(itemId: string): PixelArt | null {
  const build = RESOURCE_BUILDERS[itemId]
  return build ? memo(`res|${itemId}`, build) : null
}

// ── Axes ────────────────────────────────────────────────────────────────────

export type AxeArtCondition = 'ok' | 'broken' | 'retired'

export const AXE_ITEMS: Readonly<Record<AxeTier, string>> = { 1: 'stone_axe', 2: 'iron_axe', 3: 'steel_axe' }

/**
 * Axe around a pivot (the hand) at `angle` radians (0 = pointing right): a
 * straight handle and a one-sided wedge head with the edge facing forward.
 */
function axePixels(size: number, pivotX: number, pivotY: number, angle: number, length: number, tier: AxeTier, broken: boolean): Uint32Array {
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  const px = -dy
  const py = dx
  const at = (t: number, side = 0) => [pivotX + dx * length * t + px * side, pivotY + dy * length * t + py * side] as const
  const style = AXE_TONES[tier]
  const handle = shade(size, size, capsules(broken
    ? [[...at(0), ...at(0.42), 0.95], [...at(0.62), ...at(0.78), 0.8]]
    : [[...at(0), ...at(0.95), 0.95]]), { tones: style.handle, outline: style.handleOutline, dither: 0.3 })

  const [hx, hy] = at(broken ? 0.74 : 1)
  const reach = size >= 16 ? 3.6 : 2.8
  const shift = broken ? 1 : 0
  // Wedge: a thick spine at the haft opening into the cutting edge.
  const head = shade(size, size, capsules([
    [hx + shift, hy + shift, hx + px * reach + shift, hy + py * reach + shift, 1.6],
    [hx - dx * 1.2 + shift, hy - dy * 1.2 + shift, hx + px * reach * 0.8 + shift, hy + py * reach * 0.8 + shift, 1.1],
  ]), { tones: style.head, outline: style.outline, dither: 0 })
  const pixels = layer(handle, head)
  if (tier === 3) {
    const cx = Math.round(hx + shift)
    const cy = Math.round(hy + shift)
    if (cx >= 0 && cy >= 0 && cx < size && cy < size && pixels[cy * size + cx] !== TRANSPARENT) pixels[cy * size + cx] = color('#f7d354')
  }
  return pixels
}

export function axeIconArt(tier: AxeTier, condition: AxeArtCondition = 'ok'): PixelArt {
  return memo(`axe|${tier}|${condition}`, () => {
    const art = pixelArt(S, S, axePixels(S, 3, 13, -Math.PI / 3.6, 12, tier, condition !== 'ok'))
    return condition === 'retired' ? desaturate(art, 0.85, 0.25) : art
  })
}

/** Swing frames in world scale: 0 raised, 1 mid, 2 bite. Anchored at the hand. */
export const CHOP_ANGLES = [-2.15, -1.05, 0.35] as const
export const CHOP_SIZE = 18

export function axeSwingArt(tier: AxeTier, frame: 0 | 1 | 2, facingLeft: boolean): PixelArt {
  return memo(`chop|${tier}|${frame}|${facingLeft}`, () => {
    const pivot = 8
    const art = pixelArt(CHOP_SIZE, CHOP_SIZE, axePixels(CHOP_SIZE, pivot, pivot + 2, CHOP_ANGLES[frame], 8, tier, false), pivot, pivot + 2)
    return facingLeft ? mirror(art) : art
  })
}

/** Leaf tones used by the falling-leaf particles, per tree kind. */
export const LEAF_PARTICLE_TONES: readonly string[] = [LEAVES[1], LEAVES[2], LEAVES[3]]
