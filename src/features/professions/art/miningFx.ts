// Tiny effect sprites: rock chips, dust, sparks, glints and interaction bubbles.
// All are a few pixels big so dozens can be drawn per frame on a phone.

import { ORE_TONES, SPARK_TONES, SPECIAL_TONE, UI_GOLD, UI_NAVY } from './miningPalette'
import { color, pixelArt, type PixelArt } from './pixelArt'

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

/** A 2×2 chip with a lit corner. */
export function chipArt(light: string, dark: string): PixelArt {
  return memo(`chip|${light}|${dark}`, () => grid(['ab', 'bb'], { a: color(light), b: color(dark) }, 1, 1))
}

export function sparkArt(): PixelArt {
  return memo('spark', () => grid(['.b.', 'bab', '.b.'], { a: color(SPARK_TONES[0]), b: color(SPARK_TONES[1]) }, 1, 1))
}

export function dustArt(frame: 0 | 1): PixelArt {
  return memo(`dust|${frame}`, () => frame === 0
    ? grid(['.aa.', 'abba', '.aa.'], { a: color('#e8dcc8', 110), b: color('#f4ece0', 170) }, 2, 2)
    : grid(['.a..a.', 'a.aa.a', '.a..a.'], { a: color('#e8dcc8', 70) }, 3, 2))
}

/** Rarity glint: white for rare minerals, violet for special finds. */
export function glintArt(special: boolean): PixelArt {
  return memo(`glint|${special}`, () => grid(
    ['..a..', '..b..', 'abcba', '..b..', '..a..'],
    { a: color(special ? SPECIAL_TONE : '#fff4b0', 150), b: color(special ? '#e5d2ff' : '#ffffff'), c: color('#ffffff') },
    2, 2,
  ))
}

export type BubbleKind = 'pick' | 'lock' | 'seal'

/** Pokémon-style thought bubble above an interactable node. */
export function bubbleArt(kind: BubbleKind): PixelArt {
  return memo(`bubble|${kind}`, () => {
    const icon: Record<BubbleKind, readonly string[]> = {
      pick: ['.hhh.', 'h.s.h', '..s..', '..s..', '..s..'],
      lock: ['.ggg.', '.g.g.', 'ggggg', 'gg.gg', 'ggggg'],
      seal: ['..v..', '.vVv.', 'vVwVv', '.vVv.', '..v..'],
    }
    const rows = [
      '.ooooooooo.',
      'owwwwwwwwwo',
      'owwwwwwwwwo',
      'owwwwwwwwwo',
      'owwwwwwwwwo',
      'owwwwwwwwwo',
      'owwwwwwwwwo',
      'owwwwwwwwwo',
      '.ooooowooo.',
      '.....oo....',
    ].map(row => [...row])
    icon[kind].forEach((line, y) => [...line].forEach((ch, x) => { if (ch !== '.') rows[y + 2][x + 3] = ch }))
    return grid(rows.map(row => row.join('')), {
      o: color(UI_NAVY), w: color('#ffffff'),
      h: color('#8b96a1'), s: color('#8c5a33'),
      g: color(UI_GOLD),
      v: color('#5e7ea8'), V: color('#86a8cf'),
    }, 5, 9)
  })
}

export const RARITY_CHIP_TONES = {
  common: ['#a6a9b0', '#5b5d66'],
  uncommon: [ORE_TONES.iron.tones[2], ORE_TONES.iron.tones[0]],
  rare: [ORE_TONES.gold.tones[2], ORE_TONES.gold.tones[0]],
  special: [ORE_TONES.shard.tones[2], ORE_TONES.shard.tones[0]],
} as const
