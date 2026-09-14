import { describe, expect, it } from 'vitest'
import type { Slot } from '../../../../shared/types/database'
import { activityFromRow, diffIds, mergeSlotPatch, slotPatchFromRow, topPricedIds } from './ownedSlots'

function slot(id: number, price: number, owner: string | null = 'owner'): Slot {
  return { pokemon_id: id, owner_id: owner, owner_username: owner, current_price: price, claim_count: null, is_locked: false, last_claimed_at: null, aura: null, aura_updated_at: null, owned_since: null, first_owner_id: null, first_owner_username: null, energy: null, energy_updated_at: null, link_url: null, link_text: null, created_at: null, updated_at: null }
}

describe('owned slot read model', () => {
  it('keeps the ten highest owned slots with stable price ties', () => {
    const slots = Object.fromEntries([...Array(12)].map((_, i) => [i + 1, slot(i + 1, i < 2 ? 1 : i)]))
    expect(topPricedIds(slots)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3])
  })

  it('folds patches without mutating the server snapshot', () => {
    const before = { 1: slot(1, 10, 'a') }
    const after = mergeSlotPatch(before, { pokemon_id: 1, owner_id: 'b', owner_username: 'b', current_price: 99, is_locked: false, aura: null })
    expect(before[1].owner_id).toBe('a')
    expect(after[1]).toMatchObject({ owner_id: 'b', current_price: 99 })
  })

  it('validates Realtime rows before they reach the plaza', () => {
    expect(slotPatchFromRow({ pokemon_id: 4, owner_id: 'u', current_price: 12 })).toMatchObject({ pokemon_id: 4, owner_id: 'u' })
    expect(slotPatchFromRow({ pokemon_id: '4' })).toBeNull()
    expect(activityFromRow({ id: 'a', type: 'claim', pokemon_id: 25 })).toMatchObject({ id: 'a', pokemon_id: 25 })
    expect(activityFromRow({ id: 'a' })).toBeNull()
  })

  it('reports membership changes deterministically', () => {
    expect(diffIds(new Set([1, 2]), new Set([2, 3]))).toEqual({ entered: [3], left: [1], kept: [2] })
  })
})
