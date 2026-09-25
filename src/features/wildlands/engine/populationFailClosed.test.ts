// WORLD-1D fail closed: wild Pokémon come from the server roster or not at all.

import { describe, expect, it } from 'vitest'
import { Population, type PokedexEntry } from './population'
import { World } from './world'
import type { SharedPopulace } from './area'

const pokedex: PokedexEntry[] = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, name_es: `P${i + 1}`, type1: ['normal', 'grass', 'bug'][i % 3], type2: null, sprite_url: null }))

function population(shared: SharedPopulace | null) {
  const p = new Population(new World(208), pokedex, [])
  if (shared) p.share(shared)
  p.setWildPokemonIds(pokedex.map(entry => entry.id))
  for (let tx = -5; tx < 60; tx += 7) p.update(tx, -69)
  return p
}

describe('wild population never falls back to a local roll', () => {
  it('shows no wild Pokémon before the server is heard from', () => {
    expect(population(null).actors.filter(actor => actor.wild)).toHaveLength(0)
  })

  it('shows none when the server has no roster (unavailable), NPC trainers still appear', () => {
    const p = population({ serverNow: () => 1_727_000_000_000, wildRoster: () => null, walkable: () => true })
    expect(p.actors.filter(actor => actor.wild)).toHaveLength(0)
    expect(p.actors.some(actor => actor.kind === 'npc')).toBe(true)
  })
})
