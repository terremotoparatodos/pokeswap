// 16×16 icons for fishing resources and rods, plus the in-world cast frames.
// Same shading recipe as the mining kit (and as WildLands props).

import { TRANSPARENT } from '../../wildlands/engine/pixels'
import { capsules, ellipses, layer, shade, type ShadeFn } from '../../wildlands/engine/sprite'
import {
  FISH_TONES, OIL_TONES, PEARL_OUTLINE, PEARL_TONES, ROD_TONES, SCALE_OUTLINE, SCALE_TONES,
  SEAWEED_OUTLINE, SEAWEED_TONES, type FishTones, type RodTier,
} from './fishingPalette'
import { WOOD_OUTLINE, WOOD_TONES } from './miningPalette'
import { color, desaturate, mirror, pixelArt, type PixelArt } from './pixelArt'

const S = 16
const cache = new Map<string, PixelArt>()
const memo = (key: string, build: () => PixelArt): PixelArt => {
  let art = cache.get(key)
  if (!art) cache.set(key, (art = build()))
  return art
}

// ── Resources ───────────────────────────────────────────────────────────────

/** Side-on fish: shaded body, triangular tail, one dark eye. */
function fishIcon(tones: FishTones, big: boolean): PixelArt {
  const rx = big ? 5.4 : 4.6
  const body = shade(S, S, ellipses([[9, 8, rx, big ? 3.6 : 3]]), { tones: [tones.fin, ...tones.body], outline: '#16323f', dither: 0.4 })
  const tail: ShadeFn = (x, y) => {
    const dx = x + 0.5 - 3.2
    const dy = y + 0.5 - 8
    if (dx < -1.6 || dx > 1.8) return null
    return Math.abs(dy) <= 1.2 + (1.8 - dx) * 1.1 ? 0.45 : null
  }
  const pixels = layer(body, shade(S, S, tail, { tones: [tones.fin, tones.body[1]], outline: '#16323f', dither: 0 }))
  // Belly highlight and eye.
  for (let x = 7; x <= 11; x++) if (pixels[10 * S + x] !== TRANSPARENT) pixels[10 * S + x] = color(tones.belly)
  pixels[7 * S + 11] = color('#0d1c24')
  pixels[7 * S + 12] = color('#ffffff')
  return pixelArt(S, S, pixels)
}

function seaweedIcon(): PixelArt {
  const pixels = shade(S, S, capsules([[6, 14, 5, 4, 1.5], [10, 14, 11, 5, 1.4], [8, 14, 8, 7, 1.2]]),
    { tones: SEAWEED_TONES, outline: SEAWEED_OUTLINE, dither: 0.4 })
  return pixelArt(S, S, pixels)
}

function pearlIcon(): PixelArt {
  const pixels = shade(S, S, ellipses([[8, 9, 4.6, 4.6]]), { tones: PEARL_TONES, outline: PEARL_OUTLINE, dither: 0.25 })
  pixels[6 * S + 6] = color('#ffffff')
  pixels[6 * S + 7] = color('#ffffff')
  return pixelArt(S, S, pixels)
}

/** Heart Scale: a scalloped heart, flatter and more "scale" than a symbol. */
function heartScaleIcon(): PixelArt {
  const fn: ShadeFn = (x, y) => {
    const dx = (x + 0.5 - 8) / 5.2
    const dy = (y + 0.5 - 9) / 5
    const heart = (dx * dx + dy * dy - 1) ** 3 - dx * dx * dy * dy * dy
    return heart <= 0 ? 0.35 + (0.5 - dy) * 0.55 : null
  }
  const pixels = shade(S, S, fn, { tones: SCALE_TONES, outline: SCALE_OUTLINE, dither: 0.3 })
  pixels[6 * S + 6] = color('#ffffff')
  return pixelArt(S, S, pixels)
}

function oilIcon(): PixelArt {
  const glass = shade(S, S, capsules([[8, 9, 8, 12, 3.4]]), { tones: ['#4f8fb0', '#7fc3dc', '#c8eef7'], outline: '#264a5c', dither: 0 })
  const oil: ShadeFn = (x, y) => (y >= 8 && y <= 12 && x >= 5 && x <= 11 ? 0.5 + (11 - y) * 0.12 : null)
  const cork = shade(S, S, capsules([[8, 4, 8, 5.5, 1.6]]), { tones: WOOD_TONES, outline: WOOD_OUTLINE, dither: 0 })
  return pixelArt(S, S, layer(layer(glass, shade(S, S, oil, { tones: OIL_TONES, outline: '#5b430f', dither: 0.3 })), cork))
}

const RESOURCE_BUILDERS: Readonly<Record<string, () => PixelArt>> = {
  fish: () => fishIcon(FISH_TONES.common, false),
  quality_fish: () => fishIcon(FISH_TONES.quality, true),
  seaweed: seaweedIcon,
  pearl: pearlIcon,
  heart_scale: heartScaleIcon,
  fish_oil: oilIcon,
}

export const FISHING_RESOURCE_ICON_IDS: readonly string[] = Object.keys(RESOURCE_BUILDERS)

export function fishingResourceIconArt(itemId: string): PixelArt | null {
  const build = RESOURCE_BUILDERS[itemId]
  return build ? memo(`res|${itemId}`, build) : null
}

// ── Rods ────────────────────────────────────────────────────────────────────

export type { RodTier } from './fishingPalette'

export type RodArtCondition = 'ok' | 'broken' | 'retired'

export const ROD_ITEMS: Readonly<Record<RodTier, string>> = { 1: 'basic_rod', 2: 'reinforced_rod', 3: 'master_rod' }

/**
 * Rod around a pivot (the hand) at `angle` radians (0 = pointing right,
 * negative = up): a tapering pole, a grip band and, when broken, a snapped tip.
 */
function rodPixels(size: number, pivotX: number, pivotY: number, angle: number, length: number, tier: RodTier, broken: boolean): Uint32Array {
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  const at = (t: number) => [pivotX + dx * length * t, pivotY + dy * length * t] as const
  const style = ROD_TONES[tier]
  const segments: [number, number, number, number, number][] = broken
    ? [[...at(0), ...at(0.5), 1.3], [...at(0.72), ...at(0.92), 0.8]]
    : [[...at(0), ...at(0.55), 1.3], [...at(0.55), ...at(1), 0.8]]
  const pixels = shade(size, size, capsules(segments), { tones: style.tones, outline: style.outline, dither: 0.3 })
  if (style.band) {
    const [bx, by] = at(0.3)
    const x = Math.round(bx)
    const y = Math.round(by)
    if (x >= 0 && y >= 0 && x < size && y < size && pixels[y * size + x] !== TRANSPARENT) {
      pixels[y * size + x] = color(style.band)
      if (pixels[y * size + x + 1] !== TRANSPARENT) pixels[y * size + x + 1] = color(style.band)
    }
  }
  return pixels
}

export function rodIconArt(tier: RodTier, condition: RodArtCondition = 'ok'): PixelArt {
  return memo(`rod|${tier}|${condition}`, () => {
    const art = pixelArt(S, S, rodPixels(S, 3, 13, -Math.PI / 3.4, 14, tier, condition !== 'ok'))
    return condition === 'retired' ? desaturate(art, 0.85, 0.25) : art
  })
}

/** Cast frames in world scale: 0 back, 1 forward whip, 2 held out while waiting. */
export const CAST_ANGLES = [-2.25, -0.75, -0.35] as const
export const CAST_SIZE = 18

export function rodCastArt(tier: RodTier, frame: 0 | 1 | 2, facingLeft: boolean): PixelArt {
  return memo(`cast|${tier}|${frame}|${facingLeft}`, () => {
    const pivot = 8
    const art = pixelArt(CAST_SIZE, CAST_SIZE, rodPixels(CAST_SIZE, pivot, pivot + 2, CAST_ANGLES[frame], 9, tier, false), pivot, pivot + 2)
    return facingLeft ? mirror(art) : art
  })
}

/** Where the line leaves the rod for a given cast frame, in art pixels from the anchor. */
export function rodTipOffset(frame: 0 | 1 | 2, facingLeft: boolean): { dx: number; dy: number } {
  const angle = CAST_ANGLES[frame]
  const dx = Math.cos(angle) * 9
  const dy = Math.sin(angle) * 9
  return { dx: facingLeft ? -dx : dx, dy }
}
