// Logging effects (R31-C3): splinters, leaves and sawdust.
//
// Deliberately not recoloured stone chips: splinters are long and pale,
// leaves are wide and drift, sawdust is warm and soft. Wood should not sound
// like rock even in pixels.

import { CUT_TONES, LEAVES, SAWDUST_TONE } from './loggingPalette'
import { color, mirror, pixelArt, type PixelArt } from './pixelArt'

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

/** A splinter: 3×1 of pale wood with a darker tail, so it reads as a shard. */
export function splinterArt(light: boolean): PixelArt {
  return memo(`splinter|${light}`, () => grid(
    ['abc'],
    { a: color(CUT_TONES[light ? 2 : 1]), b: color(CUT_TONES[1]), c: color(CUT_TONES[0]) },
    1, 0,
  ))
}

export const LEAF_FRAMES = 2

/** A leaf: wide, two-toned, and mirrored on the second frame so it tumbles. */
export function leafArt(frame: number, tone: string): PixelArt {
  const safe = Math.max(0, Math.min(LEAF_FRAMES - 1, Math.floor(frame)))
  return memo(`leaf|${safe}|${tone}`, () => {
    const art = grid(['.aa.', 'aabb', '.bb.'], { a: color(tone), b: color(LEAVES[1]) }, 2, 1)
    return safe === 0 ? art : mirror(art)
  })
}

/** Sawdust puff at the cut: warm, soft, short-lived. */
export function sawdustArt(frame: 0 | 1): PixelArt {
  return memo(`sawdust|${frame}`, () => (frame === 0
    ? grid(['.aa.', 'abba', '.aa.'], { a: color(SAWDUST_TONE, 120), b: color('#f2dcb4', 180) }, 2, 2)
    : grid(['a..a', '.aa.', 'a..a'], { a: color(SAWDUST_TONE, 80) }, 2, 2)))
}

/** Bark flakes knocked loose on every bite of the axe. */
export function barkFlakeArt(tone: string): PixelArt {
  return memo(`flake|${tone}`, () => grid(['ab', 'b.'], { a: color(tone), b: color(CUT_TONES[0]) }, 1, 1))
}
