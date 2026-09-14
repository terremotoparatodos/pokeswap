import { describe, expect, it } from 'vitest'
import type { Slot } from '../../../shared/types/database'
import {
  activityFromRow, activityLabel, diffIds, mergeSlotPatch, slotPatchFromRow, topPricedIds, visibleOwnedIds,
} from './ownedSlots'

function slot(id: number, price: number, owner: string | null = 'someone'): Slot {
  return {
    pokemon_id: id, owner_id: owner, owner_username: owner ? `@${owner}` : null, current_price: price,
    claim_count: null, is_locked: false, last_claimed_at: null, aura: null, aura_updated_at: null,
    owned_since: null, first_owner_id: null, first_owner_username: null, energy: null,
    energy_updated_at: null, link_url: null, link_text: null, created_at: null, updated_at: null,
  }
}

function index(list: Slot[]): Record<number, Slot> {
  return Object.fromEntries(list.map(s => [s.pokemon_id, s]))
}

describe('topPricedIds', () => {
  it('returns the 10 most expensive owned Pokémon, highest first', () => {
    const slots = index(Array.from({ length: 15 }, (_, i) => slot(i + 1, (i + 1) * 100)))
    expect(topPricedIds(slots)).toEqual([15, 14, 13, 12, 11, 10, 9, 8, 7, 6])
  })

  it('ignores unowned slots however expensive', () => {
    const slots = index([slot(1, 9999, null), slot(2, 10)])
    expect(topPricedIds(slots)).toEqual([2])
  })

  it('breaks price ties by the lower id', () => {
    const slots = index([slot(7, 50), slot(3, 50), slot(5, 50)])
    expect(topPricedIds(slots, 2)).toEqual([3, 5])
  })

  it('handles an empty slot map', () => {
    expect(topPricedIds({})).toEqual([])
  })
})

describe('visibleOwnedIds', () => {
  const many = index([
    ...Array.from({ length: 12 }, (_, i) => slot(i + 1, 1000 - i)),
    slot(50, 1, 'me'),
    slot(51, 2, 'me'),
  ])

  it('shows only the top 10 for a top-only view', () => {
    expect([...visibleOwnedIds(many, null)].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('adds the viewer’s own Pokémon outside the top 10', () => {
    const visible = visibleOwnedIds(many, 'me')
    expect(visible.has(50)).toBe(true)
    expect(visible.has(51)).toBe(true)
    expect(visible.has(11)).toBe(false)
    expect(visible.size).toBe(12)
  })
})

describe('mergeSlotPatch', () => {
  const patch = { pokemon_id: 1, owner_id: 'b', owner_username: 'bee', current_price: 700, is_locked: false, aura: null }

  it('changes owner and price without mutating the input', () => {
    const before = index([slot(1, 100, 'a')])
    const after = mergeSlotPatch(before, patch)
    expect(after[1].owner_id).toBe('b')
    expect(after[1].current_price).toBe(700)
    expect(before[1].owner_id).toBe('a')
    expect(after[1].claim_count).toBeNull()
  })

  it('creates a slot it did not know yet', () => {
    const after = mergeSlotPatch({}, { ...patch, pokemon_id: 9 })
    expect(after[9].pokemon_id).toBe(9)
    expect(after[9].owner_username).toBe('bee')
  })

  it('moves a Pokémon into the top when its price rises', () => {
    const slots = index(Array.from({ length: 11 }, (_, i) => slot(i + 1, 100 + i)))
    expect(topPricedIds(slots)).not.toContain(1)
    const after = mergeSlotPatch(slots, { ...patch, current_price: 5000 })
    expect(topPricedIds(after)[0]).toBe(1)
    expect(topPricedIds(after)).not.toContain(2)
  })
})

describe('slotPatchFromRow', () => {
  it('reads a well-formed row', () => {
    expect(slotPatchFromRow({ pokemon_id: 4, owner_id: 'u', owner_username: 'ash', current_price: 12, is_locked: true, aura: 3 }))
      .toEqual({ pokemon_id: 4, owner_id: 'u', owner_username: 'ash', current_price: 12, is_locked: true, aura: 3 })
  })

  it('treats a row without owner as unowned', () => {
    expect(slotPatchFromRow({ pokemon_id: 4 })).toMatchObject({ owner_id: null, owner_username: null, current_price: 0 })
  })

  it.each([null, undefined, 'x', {}, { pokemon_id: '4' }, { pokemon_id: 0 }, { pokemon_id: 1.5 }])('rejects %j', row => {
    expect(slotPatchFromRow(row)).toBeNull()
  })

  it('drops fields of the wrong type', () => {
    expect(slotPatchFromRow({ pokemon_id: 4, owner_id: 7, owner_username: {}, current_price: 'NaN', aura: Infinity }))
      .toMatchObject({ owner_id: null, owner_username: null, current_price: 0, aura: null })
  })
})

describe('activityFromRow', () => {
  it('reads a row and rejects malformed ones', () => {
    expect(activityFromRow({ id: 'a', type: 'claim', user_id: 'u', pokemon_id: 25, created_at: '2026-01-01' }))
      .toEqual({ id: 'a', type: 'claim', user_id: 'u', pokemon_id: 25, created_at: '2026-01-01' })
    expect(activityFromRow({ id: 'a' })).toBeNull()
    expect(activityFromRow(null)).toBeNull()
    expect(activityFromRow({ id: 1, type: 'claim', pokemon_id: 'x' })).toMatchObject({ id: '1', pokemon_id: null })
  })
})

describe('diffIds', () => {
  it('splits entered, left and kept ids', () => {
    expect(diffIds(new Set([1, 2, 3]), new Set([2, 3, 4]))).toEqual({ entered: [4], left: [1], kept: [2, 3] })
  })
})

describe('activityLabel', () => {
  it('labels known types and passes unknown ones through', () => {
    expect(activityLabel('claim')).toBe('Captura')
    expect(activityLabel('free_claim')).toBe('Gratis')
    expect(activityLabel('otro')).toBe('otro')
  })
})
