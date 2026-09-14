import { describe, expect, it } from 'vitest'
import type { Pokemon, Slot } from '../../../shared/types/database'
import { availableWildPool, rollWildPool } from './wildPool'

const pokemon = (id: number, legendary = false, aura = 0, type1 = 'normal'): Pokemon => ({
  id, name_es: `P${id}`, name_en: '', name_pt: '', name_fr: '', type1, type2: null, region: '',
  is_legendary: legendary, is_popular: false, base_price: 0, sprite_url: null, locked: false,
  generation: 1, base_aura: aura, created_at: null,
})
const slot = (id: number, owner: string | null): Slot => ({ pokemon_id: id, owner_id: owner, owner_username: null, current_price: 0, claim_count: null, is_locked: false, last_claimed_at: null, aura: null, aura_updated_at: null, owned_since: null, first_owner_id: null, first_owner_username: null, energy: null, energy_updated_at: null, link_url: null, link_text: null, created_at: null, updated_at: null })

describe('rollWildPool', () => {
  it('uses exact weighted boundaries and removes each pick', () => {
    const entries = [pokemon(1, true), pokemon(2, false, 250), pokemon(3), pokemon(4)]
    const values = [0, 0, 0.02, 0, 0.14, 0, 0.14, 0]
    expect(rollWildPool(entries, {}, { size: 4, random: () => values.shift()! })).toEqual([1, 2, 3, 4])
  })

  it('falls back when a weighted category is empty, never duplicates, and caps at availability', () => {
    const entries = [pokemon(1), pokemon(2)]
    expect(rollWildPool(entries, {}, { size: 25, random: () => 0 })).toEqual([1, 2])
  })

  it('excludes server-owned slots and immediately hides acquired pool members', () => {
    const entries = [pokemon(1), pokemon(2), pokemon(3)]
    const slots = { 2: slot(2, 'owner') }
    expect(rollWildPool(entries, slots, { size: 3, random: () => 0.9 })).toEqual([3, 1])
    expect(availableWildPool([1, 2, 3], slots)).toEqual([1, 3])
  })
})
