import { describe, expect, it } from 'vitest'
import type { Slot } from '../../../shared/types/database'
import { availableWildPool } from './wildPool'

const slot = (id: number, owner: string | null): Slot => ({ pokemon_id: id, owner_id: owner, owner_username: null, current_price: 0, claim_count: null, is_locked: false, last_claimed_at: null, aura: null, aura_updated_at: null, owned_since: null, first_owner_id: null, first_owner_username: null, energy: null, energy_updated_at: null, link_url: null, link_text: null, created_at: null, updated_at: null })

// The pool rule (weights, fallback, uniqueness) moved to the realtime service
// with WORLD-1D and is tested there (services/realtime/src/world/wildPopulation.test.js).
describe('availableWildPool', () => {
  it('immediately hides acquired pool members', () => {
    const slots = { 2: slot(2, 'owner') }
    expect(availableWildPool([1, 2, 3], slots)).toEqual([1, 3])
  })
})
