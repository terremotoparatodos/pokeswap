// Fishing effects (R31-C2): ripples, splash, droplets and the bite mark.
// Everything is a handful of pixels so a busy coast stays cheap on a phone.

import { color, pixelArt, type PixelArt } from './pixelArt'
import { BOBBER, LINE_TONE, SPLASH_TONE } from './fishingPalette'
import { UI_GOLD, UI_NAVY } from './miningPalette'

const cache = new Map<string, PixelArt>()
const memo = (key: string, build: () => PixelArt): PixelArt => {
  let art = cache.get(key)
  if (!art) cache.set(key, (art = build()))
  return art
}

function grid(rows: readonly string[], palette: Readonly<Record<string, number>>, ax?: number, ay?: number): PixelArt {
  const w = Math.max(...rows.map(row => row.length))
  const h = rows.length
  const pixels = new Uint32Array(w * h)
  rows.forEach((row, y) => [...row].forEach((ch, x) => { if (palette[ch] !== undefined) pixels[y * w + x] = palette[ch] }))
  return pixelArt(w, h, pixels, ax ?? Math.floor(w / 2), ay ?? h - 1)
}

export const RIPPLE_FRAMES = 3

/** Flat ring on the water; it widens and fades with each frame. */
export function rippleArt(frame: number, foam: string): PixelArt {
  const safe = Math.max(0, Math.min(RIPPLE_FRAMES - 1, Math.floor(frame)))
  return memo(`ripple|${safe}|${foam}`, () => {
    const rows = [
      ['.aaa.', 'a...a', '.aaa.'],
      ['..aaa..', '.a...a.', 'a.....a', '.a...a.', '..aaa..'],
      ['...aaa...', '.aa...aa.', 'a.......a', '.aa...aa.', '...aaa...'],
    ][safe]
    const alpha = [210, 150, 95][safe]
    const art = grid(rows, { a: color(foam, alpha) })
    return pixelArt(art.w, art.h, art.pixels, Math.floor(art.w / 2), Math.floor(art.h / 2))
  })
}

/** Water thrown up when the line lands or a catch comes out. */
export function splashArt(frame: 0 | 1): PixelArt {
  return memo(`splash|${frame}`, () => (frame === 0
    ? grid(['.a.a.', 'a.b.a', '.bbb.'], { a: color(SPLASH_TONE, 200), b: color(SPLASH_TONE, 130) }, 2, 2)
    : grid(['a...a', '.a.a.', '..b..'], { a: color(SPLASH_TONE, 150), b: color(SPLASH_TONE, 90) }, 2, 2)))
}

export function dropletArt(): PixelArt {
  return memo('droplet', () => grid(['a', 'b'], { a: color(SPLASH_TONE, 220), b: color(SPLASH_TONE, 140) }, 0, 1))
}

/** Small bubbles that mark a live spot under the surface. */
export function bubblesArt(frame: 0 | 1): PixelArt {
  return memo(`bubbles|${frame}`, () => (frame === 0
    ? grid(['..a.', 'a..a', '.a..'], { a: color(SPLASH_TONE, 120) }, 2, 1)
    : grid(['.a..', '..a.', 'a..a'], { a: color(SPLASH_TONE, 150) }, 2, 1)))
}

/** The bobber floating (0) and yanked under (1). */
export function bobberArt(sunk: boolean): PixelArt {
  return memo(`bobber|${sunk}`, () => (sunk
    ? grid(['.oo.', 'orro', '.oo.'], { o: color(BOBBER.outline), r: color(BOBBER.red) }, 1, 2)
    : grid(['.oo.', 'orro', 'owwo', '.oo.'], { o: color(BOBBER.outline), r: color(BOBBER.red), w: color(BOBBER.white) }, 1, 3)))
}

/** One pixel of line; the overlay strings several between rod tip and bobber. */
export function lineDotArt(): PixelArt {
  return memo('line', () => grid(['a'], { a: color(LINE_TONE, 225) }, 0, 0))
}

/** "!" over the spot the instant the fish bites: the one loud, readable cue. */
export function biteMarkArt(): PixelArt {
  return memo('bite', () => grid([
    '.ooo.',
    'ogggo',
    'ogggo',
    'ogggo',
    '.ooo.',
    'ogggo',
    '.ooo.',
  ], { o: color(UI_NAVY), g: color(UI_GOLD) }, 2, 6))
}
