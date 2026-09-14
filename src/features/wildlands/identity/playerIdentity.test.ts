import { describe, expect, it } from 'vitest'
import type { SlotWithPokemon } from '../../pokemon/api/pokemonApi'
import { eligibleCompanion } from './playerIdentity'

function item(id: number, ownerId: string | null, locked = false): SlotWithPokemon {
  return {
    slot: { pokemon_id: id, owner_id: ownerId, is_locked: locked } as SlotWithPokemon['slot'],
    pokemon: { id, name_es: `P${id}`, sprite_url: null } as SlotWithPokemon['pokemon'],
  }
}

describe('companion ownership validation', () => {
  it('accepts only an unlocked member of the active user box', () => {
    const items = [item(1, 'u1'), item(2, 'u1', true), item(3, 'u2')]
    expect(eligibleCompanion(1, 'u1', items)?.pokemon.id).toBe(1)
    expect(eligibleCompanion(2, 'u1', items)).toBeNull()
    expect(eligibleCompanion(3, 'u1', items)).toBeNull()
    expect(eligibleCompanion(4, 'u1', items)).toBeNull()
  })
})
