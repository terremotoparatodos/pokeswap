// Swap API invariant tests (R19/R20).
// Verifies that all swap mutations go through the pokeswap-swap Edge Function,
// that getHistory is read-only, and that error codes are propagated correctly.
// useSwap composable tests live in composables/useSwap.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../shared/api/supabase', () => {
  const order = vi.fn().mockResolvedValue({ data: [], error: null })
  const select = vi.fn().mockReturnValue({ order })

  return {
    supabase: {
      from: vi.fn().mockReturnValue({ select }),
      functions: { invoke: vi.fn() },
      rpc: vi.fn(),
    },
  }
})

import { supabase } from '../../../shared/api/supabase'
import { swap, getHistory } from './swapApi'

const mockInvoke = supabase.functions.invoke as ReturnType<typeof vi.fn>
const mockFrom   = supabase.from as ReturnType<typeof vi.fn>
const mockRpc    = supabase.rpc as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
})

// ── swap ──────────────────────────────────────────────────────────────────────

describe('swap', () => {
  const fakeResult = {
    pokemon_given_id: 1,
    pokemon_received_id: 25,
    was_shiny: false,
    rarity: 'common',
    swap_cooldown_until: new Date(Date.now() + 8 * 3600 * 1000).toISOString(),
  }

  it('invokes pokeswap-swap with an empty body when no pokemon_given_id is provided', async () => {
    mockInvoke.mockResolvedValueOnce({ data: fakeResult, error: null })
    await swap()
    expect(mockInvoke).toHaveBeenCalledWith('pokeswap-swap', { body: {} })
  })

  it('invokes pokeswap-swap with pokemon_given_id when supplied', async () => {
    mockInvoke.mockResolvedValueOnce({ data: fakeResult, error: null })
    await swap(42)
    expect(mockInvoke).toHaveBeenCalledWith('pokeswap-swap', { body: { pokemon_given_id: 42 } })
  })

  it('never calls supabase.from directly (trust boundary — no direct ownership write)', async () => {
    mockInvoke.mockResolvedValueOnce({ data: fakeResult, error: null })
    await swap()
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('never calls supabase.rpc directly (ownership transfer is server-only)', async () => {
    mockInvoke.mockResolvedValueOnce({ data: fakeResult, error: null })
    await swap()
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('returns the full SwapResult from the server', async () => {
    mockInvoke.mockResolvedValueOnce({ data: fakeResult, error: null })
    const result = await swap()
    expect(result).toEqual(fakeResult)
  })

  it('propagates cooldown_active error (swap cooldown enforced server-side)', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: new Error('cooldown_active') })
    await expect(swap()).rejects.toThrow('cooldown_active')
  })

  it('propagates not_owner error', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: new Error('not_owner') })
    await expect(swap(99)).rejects.toThrow('not_owner')
  })

  it('propagates pokemon_locked error (pokemon in active market listing)', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: new Error('pokemon_locked') })
    await expect(swap(5)).rejects.toThrow('pokemon_locked')
  })

  it('a second call while on cooldown is safe — server rejects, no client state changed', async () => {
    // First swap succeeds and sets server-side cooldown.
    mockInvoke.mockResolvedValueOnce({ data: fakeResult, error: null })
    const first = await swap()
    expect(first.swap_cooldown_until).toBeDefined()

    // Second call while the server cooldown would still be active.
    mockInvoke.mockResolvedValueOnce({ data: null, error: new Error('cooldown_active') })
    await expect(swap()).rejects.toThrow('cooldown_active')
  })
})

// ── getHistory ────────────────────────────────────────────────────────────────

describe('getHistory', () => {
  const fakeHistory = [
    {
      id: 'abc',
      user_id: 'u1',
      pokemon_given_id: 1,
      pokemon_received_id: 25,
      was_shiny: false,
      rarity: 'common',
      created_at: '2026-01-01T00:00:00Z',
    },
  ]

  it('SELECTs from swap_history ordered by created_at descending', async () => {
    const order  = vi.fn().mockResolvedValue({ data: fakeHistory, error: null })
    const select = vi.fn().mockReturnValue({ order })
    mockFrom.mockReturnValueOnce({ select })

    await getHistory()

    expect(mockFrom).toHaveBeenCalledWith('swap_history')
    expect(select).toHaveBeenCalledWith('*')
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false })
  })

  it('never invokes an Edge Function (read-only path)', async () => {
    const order  = vi.fn().mockResolvedValue({ data: [], error: null })
    const select = vi.fn().mockReturnValue({ order })
    mockFrom.mockReturnValueOnce({ select })

    await getHistory()

    expect(mockInvoke).not.toHaveBeenCalled()
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('returns the history array', async () => {
    const order  = vi.fn().mockResolvedValue({ data: fakeHistory, error: null })
    const select = vi.fn().mockReturnValue({ order })
    mockFrom.mockReturnValueOnce({ select })

    const result = await getHistory()
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('abc')
  })

  it('propagates Supabase errors', async () => {
    const order  = vi.fn().mockResolvedValue({ data: null, error: new Error('network') })
    const select = vi.fn().mockReturnValue({ order })
    mockFrom.mockReturnValueOnce({ select })

    await expect(getHistory()).rejects.toThrow('network')
  })
})

// ── Integration scenario reminders (require real DB) ─────────────────────────
//
// SWP-INV-1: swap() called while swap_cooldown_until is in the future
//   Expected: pokeswap-swap function raises 'cooldown_active', no ownership change.
//
// SWP-INV-2: swap() with a pokemon_given_id not owned by the caller
//   Expected: raises 'not_owner', no ownership transfer occurs.
//
// SWP-INV-3: swap() with a pokemon_given_id that is in an active market listing
//   Expected: raises 'pokemon_locked', both pokemons remain in their original slots.
//
// SWP-INV-4: Two concurrent swap() calls from the same user
//   Expected: exactly one succeeds; the other raises 'cooldown_active'.
//   After: caller owns exactly one new pokemon (no duplication).
//
// SWP-INV-5: Direct client UPDATE on slots (ownership transfer attempt)
//   Action: authenticated client calls supabase.from('slots').update({pokemon_id: x})
//   Expected: column privilege violation — slots.pokemon_id has no direct client grant.
//
// SWP-INV-6: skipCooldown() with no active cooldown
//   Expected: raises 'no_active_cooldown', no token debit occurs.
//   (Also tested in progressionApi.test.ts, which imports from swapApi.)
