// Tiny pixel font — Rancho
//
// Just the capitals the ranch paints on its signs, 5 px tall, variable width.

const GLYPHS: Record<string, string[]> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  G: ['.##', '#..', '#.#', '#.#', '.##'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  L: ['#..', '#..', '#..', '#..', '###'],
  N: ['#..#', '##.#', '#.##', '#..#', '#..#'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  ' ': ['..', '..', '..', '..', '..'],
}

export const FONT_HEIGHT = 5

export function textWidth(text: string, scale = 1): number {
  let w = 0
  for (const ch of text) w += ((GLYPHS[ch] ?? GLYPHS[' '])[0].length + 1) * scale
  return Math.max(0, w - scale)
}

/** Calls `dot(x, y)` for every lit pixel of `text` at the given scale. */
export function paintText(text: string, x0: number, y0: number, scale: number, dot: (x: number, y: number) => void): void {
  let x = x0
  for (const ch of text) {
    const glyph = GLYPHS[ch] ?? GLYPHS[' ']
    glyph.forEach((row, gy) => {
      for (let gx = 0; gx < row.length; gx++) {
        if (row[gx] !== '#') continue
        for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) dot(x + gx * scale + sx, y0 + gy * scale + sy)
      }
    })
    x += (glyph[0].length + 1) * scale
  }
}
