// Emote bubbles — Rancho
//
// The little speech bubbles over a Pokémon's head: a heart when Guti or Sky
// comes by, a note when content, "Zz" when dozing, "!" when called.

import { Painter } from '../../wildlands/engine/painter'
import type { Sprite } from '../../wildlands/engine/sprite'

export type Emote = 'heart' | 'note' | 'sleep' | 'alert' | 'dots'
export const EMOTES: readonly Emote[] = ['heart', 'note', 'sleep', 'alert', 'dots']

const ICONS: Record<Emote, { color: string; rows: string[] }> = {
  heart: { color: '#e8487a', rows: ['.#.#.', '#####', '#####', '.###.', '..#..'] },
  note: { color: '#3a6ad8', rows: ['..##.', '..#.#', '..#..', '###..', '##...'] },
  sleep: { color: '#6a7a9a', rows: ['###..', '..#..', '.#.##', '###.#', '...##'] },
  alert: { color: '#d83a3a', rows: ['..#..', '..#..', '..#..', '.....', '..#..'] },
  dots: { color: '#4a4a58', rows: ['.....', '.....', '#.#.#', '.....', '.....'] },
}

function bubble(emote: Emote): Sprite {
  // One transparent pixel of margin all round, so the outline has room.
  const p = new Painter(15, 15)
  p.rect(2, 2, 11, 8, '#ffffff')
  p.hline(3, 1, 9, '#ffffff')
  p.hline(3, 10, 9, '#ffffff')
  p.rect(6, 11, 3, 1, '#ffffff')
  p.set(7, 12, '#ffffff')
  const icon = ICONS[emote]
  icon.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '#') p.set(5 + x, 3 + y, icon.color)
  })
  p.outline('#2c2c34')
  return p.toSprite({ ax: 7, ay: 14 })
}

export function buildEmotes(): Record<Emote, Sprite> {
  return Object.fromEntries(EMOTES.map(e => [e, bubble(e)])) as Record<Emote, Sprite>
}
