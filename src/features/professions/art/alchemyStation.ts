// The alchemy bench (R31-C4): the one prop of this profession.
//
// Mining, Fishing and Logging all point at something the world already grew.
// Alchemy has no node, so the bench IS the node: a worktop of the same wood as
// the trees, a rack of empty glass, a mortar, and a flask over a burner. The
// flask is where the whole profession is read — empty when idle, full of the
// product's colour while it brews, corked and sparkling when it is done.

import { TRANSPARENT } from '../../wildlands/engine/pixels'
import { capsules, ellipses, layer, shade, type ShadeFn } from '../../wildlands/engine/sprite'
import {
  BENCH_OUTLINE, BENCH_TONES, BRASS_OUTLINE, BRASS_TONES, CORK_TONES, DEFAULT_LIQUID,
  FLAME_TONES, GLASS_OUTLINE, GLASS_TONES, SPARKLE_TONES, type Liquid,
} from './alchemyPalette'
import { brighten, color, pixelArt, type PixelArt } from './pixelArt'

export const STATION_W = 34
export const STATION_H = 30
/** Feet at the front edge of the worktop, like every other world prop. */
export const STATION_AX = 17
export const STATION_AY = 29

/** What the bench is doing; the flask and the burner answer. */
export type StationArtState = 'idle' | 'ready' | 'brewing' | 'done'

const cache = new Map<string, PixelArt>()
const memo = (key: string, build: () => PixelArt): PixelArt => {
  let art = cache.get(key)
  if (!art) cache.set(key, (art = build()))
  return art
}

const W = STATION_W
const H = STATION_H

/** Worktop, legs and the shelf underneath: plain carpentry, no magic. */
function bench(): Uint32Array {
  const top: ShadeFn = (x, y) => (y >= 17 && y <= 20 && x >= 2 && x <= 31 ? 0.95 - (y - 17) * 0.12 : null)
  const legs: ShadeFn = (x, y) => {
    if (y < 21 || y > 28) return null
    return (x >= 4 && x <= 6) || (x >= 27 && x <= 29) ? 0.6 : null
  }
  const shelf: ShadeFn = (x, y) => (y >= 23 && y <= 24 && x >= 6 && x <= 27 ? 0.5 : null)
  return layer(
    layer(
      shade(W, H, top, { tones: BENCH_TONES, outline: BENCH_OUTLINE, dither: 0.35 }),
      shade(W, H, legs, { tones: BENCH_TONES, outline: BENCH_OUTLINE, dither: 0.2 }),
    ),
    shade(W, H, shelf, { tones: BENCH_TONES, outline: BENCH_OUTLINE, dither: 0.2 }),
  )
}

/** A row of empty phials on the shelf: the stock a brewer works through. */
function rack(pixels: Uint32Array): void {
  for (const x of [8, 11, 14]) {
    for (let y = 19; y <= 22; y++) pixels[y * W + x] = color(GLASS_TONES[1])
    pixels[18 * W + x] = color(CORK_TONES[1])
    pixels[19 * W + x] = color(GLASS_TONES[3])
  }
}

/** The mortar: the hand tool that says "preparation" without being a pickaxe. */
function mortar(pixels: Uint32Array): void {
  const bowl = shade(W, H, ellipses([[26, 15, 4, 2.6]]), { tones: [...BENCH_TONES].reverse(), outline: BENCH_OUTLINE, dither: 0.25 })
  const pestle = shade(W, H, capsules([[28, 10, 25, 14, 1]]), { tones: BENCH_TONES, outline: BENCH_OUTLINE, dither: 0 })
  layer(pixels, layer(bowl, pestle))
}

/** Tripod burner under the flask. The flame is painted after the glass. */
function burner(pixels: Uint32Array): void {
  const stand = shade(W, H, capsules([[9, 16, 13, 16, 1], [9, 16, 9, 13, 0.9], [13, 16, 13, 13, 0.9]]),
    { tones: BRASS_TONES, outline: BRASS_OUTLINE, dither: 0 })
  layer(pixels, stand)
}

/** The flame, drawn last so the glass never covers it. */
function flame(pixels: Uint32Array): void {
  for (const [x, y, tone] of [[10, 15, 0], [12, 15, 0], [11, 15, 2], [11, 16, 1]] as const) {
    pixels[y * W + x] = color(FLAME_TONES[tone])
  }
}

/**
 * The flask on the burner. `fill` is 0..1 of liquid, `corked` closes it and
 * `bubble` lifts a couple of bubbles off the surface.
 */
function flask(pixels: Uint32Array, ink: Liquid, fill: number, corked: boolean, bubble: number): void {
  const body: ShadeFn = (x, y) => {
    const dx = (x + 0.5 - 11) / 4.4
    const dy = (y + 0.5 - 10) / 4
    if (dx * dx + dy * dy <= 1) return 0.9
    return y >= 3 && y <= 6 && Math.abs(x + 0.5 - 11) <= 1.5 ? 0.8 : null
  }
  const glass = shade(W, H, body, { tones: GLASS_TONES, outline: GLASS_OUTLINE, dither: 0.2 })
  const outline = color(GLASS_OUTLINE)
  if (fill > 0) {
    const top = Math.round(13 - 6 * Math.min(1, fill))
    for (let y = top; y <= 13; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x
        if (glass[i] === TRANSPARENT || glass[i] === outline) continue
        glass[i] = color(y === top ? ink.tones[2] : y > top + 2 ? ink.tones[0] : ink.tones[1])
      }
    }
    if (bubble > 0) {
      // Two bubbles rising out of the surface, offset so they never pair up.
      const b1 = Math.round(top - 1 - bubble * 2)
      const b2 = Math.round(top - bubble * 3)
      if (b1 > 4) glass[b1 * W + 10] = color(ink.tones[2])
      if (b2 > 4) glass[b2 * W + 13] = color(GLASS_TONES[3])
    }
  }
  if (corked) {
    for (let x = 10; x <= 12; x++) {
      glass[2 * W + x] = color(CORK_TONES[0])
      glass[3 * W + x] = color(CORK_TONES[1])
    }
  }
  glass[8 * W + 8] = color(GLASS_TONES[3])
  glass[9 * W + 8] = color(GLASS_TONES[3])
  layer(pixels, glass)
}

/**
 * Bench art for a state. `productId` picks the liquid, so the same bench reads
 * "brewing a potion" (rose) or "brewing an ether" (azure) at a glance.
 */
export function alchemyStationArt(state: StationArtState, ink: Liquid = DEFAULT_LIQUID, frame = 0): PixelArt {
  const key = `${state}|${ink.tones[1]}|${state === 'brewing' ? frame % 4 : 0}`
  return memo(key, () => {
    const pixels = bench()
    rack(pixels)
    mortar(pixels)
    burner(pixels)
    const fill = state === 'brewing' ? 0.45 + (frame % 4) * 0.12 : state === 'done' ? 0.9 : 0
    flask(pixels, ink, fill, state === 'done', state === 'brewing' ? (frame % 4) / 3 : 0)
    if (state === 'brewing') flame(pixels)
    if (state === 'done') {
      // One sparkle over the corked flask: the product is ready to take.
      pixels[1 * W + 14] = color(SPARKLE_TONES[0])
      pixels[0 * W + 13] = color(SPARKLE_TONES[1])
      pixels[2 * W + 15] = color(SPARKLE_TONES[2])
    }
    const art = pixelArt(W, H, pixels, STATION_AX, STATION_AY)
    // Standing at the bench lifts it a little out of the grass, the way a
    // targeted node brightens; the thought bubble does the rest.
    return state === 'ready' ? { ...brighten(art, 0.14), ax: STATION_AX, ay: STATION_AY } : art
  })
}

/** Frames per second of the brewing loop; slow on purpose, it plays for seconds. */
export const BREW_FRAME_HZ = 6
