import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the supabase client before importing the module under test
vi.mock('../../../shared/api/supabase', () => {
  const invoke = vi.fn()
  const select = vi.fn()
  const eq = vi.fn()
  const gt = vi.fn()
  const single = vi.fn()
  const order = vi.fn()

  // Chainable query builder
  const query = { select, eq, gt, single, order }
  select.mockReturnValue(query)
  eq.mockReturnValue(query)
  gt.mockReturnValue(query)
  order.mockReturnValue(query)
  single.mockReturnValue(Promise.resolve({ data: null, error: null }))
  order.mockReturnValue(Promise.resolve({ data: [], error: null }))

  return {
    supabase: {
      functions: { invoke },
      from: vi.fn().mockReturnValue(query),
    },
  }
})

import { supabase } from '../../../shared/api/supabase'
import { publish, cancel, buy, listActiveListings } from './marketApi'

const mockInvoke = supabase.functions.invoke as ReturnType<typeof vi.fn>
const mockFrom = supabase.from as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
})

// ── publish ──────────────────────────────────────────────────────────────────

describe('publish', () => {
  it('invokes market-publish with the correct body', async () => {
    mockInvoke.mockResolvedValueOnce({ error: null })
    await publish(42, 500)
    expect(mockInvoke).toHaveBeenCalledWith('market-publish', {
      body: { pokemon_id: 42, price_tokens: 500 },
    })
  })

  it('throws when the function returns an error', async () => {
    mockInvoke.mockResolvedValueOnce({ error: new Error('not_owner') })
    await expect(publish(1, 100)).rejects.toThrow('not_owner')
  })

  it('never calls supabase.from directly (trust boundary — no direct INSERT)', async () => {
    mockInvoke.mockResolvedValueOnce({ error: null })
    await publish(7, 200)
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

// ── cancel ───────────────────────────────────────────────────────────────────

describe('cancel', () => {
  it('invokes market-cancel with the correct body', async () => {
    mockInvoke.mockResolvedValueOnce({ error: null })
    const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    await cancel(id)
    expect(mockInvoke).toHaveBeenCalledWith('market-cancel', { body: { listing_id: id } })
  })

  it('throws when the function returns an error', async () => {
    mockInvoke.mockResolvedValueOnce({ error: new Error('already_purchased') })
    await expect(cancel('some-id')).rejects.toThrow('already_purchased')
  })

  it('never calls supabase.from directly (trust boundary — no direct DELETE)', async () => {
    mockInvoke.mockResolvedValueOnce({ error: null })
    await cancel('some-id')
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

// ── buy ──────────────────────────────────────────────────────────────────────

describe('buy', () => {
  it('invokes market-buy with the correct body', async () => {
    mockInvoke.mockResolvedValueOnce({ error: null })
    const id = 'listing-uuid-here'
    await buy(id)
    expect(mockInvoke).toHaveBeenCalledWith('market-buy', { body: { listing_id: id } })
  })

  it('throws on insufficient_tokens error', async () => {
    mockInvoke.mockResolvedValueOnce({ error: new Error('insufficient_tokens') })
    await expect(buy('some-id')).rejects.toThrow('insufficient_tokens')
  })

  it('throws on already_purchased error (double-buy race)', async () => {
    mockInvoke.mockResolvedValueOnce({ error: new Error('already_purchased') })
    await expect(buy('some-id')).rejects.toThrow('already_purchased')
  })

  it('throws on listing_expired error', async () => {
    mockInvoke.mockResolvedValueOnce({ error: new Error('listing_expired') })
    await expect(buy('some-id')).rejects.toThrow('listing_expired')
  })
})

// ── listActiveListings ────────────────────────────────────────────────────────

describe('listActiveListings', () => {
  it('queries market_listings with active + unexpired filters', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq:     vi.fn().mockReturnThis(),
      gt:     vi.fn().mockReturnThis(),
      order:  vi.fn().mockResolvedValue({ data: [], error: null }),
    }
    mockFrom.mockReturnValueOnce(chain)

    await listActiveListings()

    expect(mockFrom).toHaveBeenCalledWith('market_listings')
    expect(chain.eq).toHaveBeenCalledWith('is_purchased', false)
    expect(chain.gt).toHaveBeenCalledWith('expires_at', expect.any(String))
  })

  it('throws when the query returns an error', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq:     vi.fn().mockReturnThis(),
      gt:     vi.fn().mockReturnThis(),
      order:  vi.fn().mockResolvedValue({ data: null, error: new Error('db error') }),
    }
    mockFrom.mockReturnValueOnce(chain)
    await expect(listActiveListings()).rejects.toThrow('db error')
  })
})

// ── Concurrency scenarios (require real DB — documented here as reminders) ───
//
// These cannot be meaningfully tested with mocked clients. Run against a local
// Supabase stack (`supabase start`) or a staging project.
//
// MKT-INV-1: Two publish attempts on the same Pokémon
//   Setup: User A owns pokemon_id X, slot unlocked.
//   Action: Call publish_market_listing(X, 100) twice in parallel.
//   Expected: Exactly one succeeds; the other returns 'already_locked'.
//
// MKT-INV-2: Two simultaneous buyers of the same listing
//   Setup: Active listing L for pokemon X.
//   Action: User B and User C both call buy_market_listing(L) concurrently.
//   Expected: Exactly one succeeds; the other returns 'already_purchased'.
//   State after: pokemon_id X has exactly one owner; tokens balanced correctly.
//
// MKT-INV-3: Cancellation racing a purchase
//   Setup: Active listing L.
//   Action: Seller cancels and Buyer buys concurrently.
//   Expected: One wins. If cancel wins: listing deleted, slot unlocked.
//   If buy wins: slot transferred, listing is_purchased = true.
//   Neither outcome leaves is_locked = true with no active listing.
//
// MKT-INV-4: Direct client INSERT into market_listings is rejected
//   Action: Authenticated client calls supabase.from('market_listings').insert({...})
//   Expected: RLS policy violation (403/42501).
//
// MKT-INV-5: Direct client DELETE from market_listings is rejected
//   Action: Authenticated client calls supabase.from('market_listings').delete().eq('id', id)
//   Expected: RLS policy violation (403/42501).
