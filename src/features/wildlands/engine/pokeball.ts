// Poké Ball stand-in — WildLands lobby (R26)
//
// Drawn in code for owned Pokémon whose species has neither an overworld sheet
// nor a database sprite, so they still stroll the plaza and can be tapped.

import type { PokemonInfo } from './actors'
import type { PokemonFrames } from './characters'
import type { PokedexEntry } from './population'
import { fromAscii, spriteFromPixels, type Sprite } from './sprite'

const BALL = [
  '...KKKK...',
  '.KKRRRRKK.',
  '.KRWWRRRK.',
  'KRRWRRRRRK',
  'KKKKWWKKKK',
  'KWWKWWKWWK',
  'KWWWKKWWWK',
  '.KWWWWWWK.',
  '.KKWWWWKK.',
  '...KKKK...',
]
const PALETTE = { K: '#1c1c24', R: '#e03c3c', W: '#f4f4f4' }

let frames: PokemonFrames | null = null

function ballFrames(): PokemonFrames {
  if (frames) return frames
  const { w, h, pixels } = fromAscii(BALL, PALETTE)
  const rest: Sprite = spriteFromPixels(w, h, pixels, w / 2, h - 1)
  // A one-pixel hop on the second frame; two frames also keep the overworld scale.
  const hop: Sprite = spriteFromPixels(w, h, pixels, w / 2, h)
  const pair = [rest, hop]
  frames = { down: pair, up: pair, left: pair, right: pair }
  return frames
}

export function pokeballInfo(entry: Pick<PokedexEntry, 'id' | 'name_es'>): PokemonInfo {
  return { id: entry.id, name: entry.name_es, shiny: false, frames: ballFrames() }
}
