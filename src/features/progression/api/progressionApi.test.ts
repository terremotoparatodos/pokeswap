// Progression API invariant tests (R10/R12/R18).
// Tests verify that the service layer calls the correct server contracts and
// never touches profiles.tokens directly from the client.
// Dungeon session tests (startDungeon, submitDungeonReward) moved to
// src/features/dungeon/api/dungeonApi.test.ts in R18.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../shared/api/supabase', () => ({
  supabase: {
    from: vi.fn(),
    functions: { invoke: vi.fn() },
    rpc: vi.fn(),
  },
}))

import { supabase } from '../../../shared/api/supabase'
import { collectPassiveTokens, learnMove, grantXp } from './progressionApi'
import { skipCooldown } from '../../swap/api/swapApi'

const mockInvoke = supabase.functions.invoke as ReturnType<typeof vi.fn>
const mockRpc    = supabase.rpc as ReturnType<typeof vi.fn>
const mockFrom   = supabase.from as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
})

// ── collectPassiveTokens ──────────────────────────────────────────────────────

describe('collectPassiveTokens', () => {
  it('calls the collect-passive-tokens Edge Function, never profiles directly', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { delta: 120, new_balance: 620 }, error: null })

    const result = await collectPassiveTokens()

    expect(mockInvoke).toHaveBeenCalledWith('collect-passive-tokens', { body: {} })
    expect(mockFrom).not.toHaveBeenCalled()
    expect(result).toEqual({ delta: 120, new_balance: 620 })
  })

  it('propagates Edge Function errors', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: new Error('too_soon') })

    await expect(collectPassiveTokens()).rejects.toThrow('too_soon')
  })
})

// ── learnMove ─────────────────────────────────────────────────────────────────

describe('learnMove', () => {
  it('calls spend_tokens_learn_move RPC with pokemon id and new move list', async () => {
    mockRpc.mockResolvedValueOnce({ data: { new_balance: 350 }, error: null })

    const moves = ['tackle', 'growl', 'vine-whip', 'razor-leaf']
    const result = await learnMove(1, moves)

    expect(mockRpc).toHaveBeenCalledWith('spend_tokens_learn_move', {
      p_pokemon_id: 1,
      p_new_moves: moves,
    })
    expect(mockFrom).not.toHaveBeenCalled()
    expect(result).toEqual({ new_balance: 350 })
  })

  it('propagates insufficient_tokens error from RPC', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: new Error('insufficient_tokens') })

    await expect(learnMove(1, ['tackle'])).rejects.toThrow('insufficient_tokens')
  })

  it('propagates not_owner error from RPC', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: new Error('not_owner') })

    await expect(learnMove(99, ['tackle'])).rejects.toThrow('not_owner')
  })
})

// ── skipCooldown ──────────────────────────────────────────────────────────────

describe('skipCooldown', () => {
  it('calls skip_swap_cooldown RPC and returns new balance', async () => {
    mockRpc.mockResolvedValueOnce({ data: { new_balance: 500 }, error: null })

    const result = await skipCooldown()

    expect(mockRpc).toHaveBeenCalledWith('skip_swap_cooldown')
    expect(mockFrom).not.toHaveBeenCalled()
    expect(result).toEqual({ new_balance: 500 })
  })

  it('propagates insufficient_tokens_or_no_cooldown error', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: new Error('insufficient_tokens_or_no_cooldown'),
    })

    await expect(skipCooldown()).rejects.toThrow('insufficient_tokens_or_no_cooldown')
  })

  it('propagates no_active_cooldown error', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: new Error('no_active_cooldown') })

    await expect(skipCooldown()).rejects.toThrow('no_active_cooldown')
  })
})

// ── grantXp ───────────────────────────────────────────────────────────────────

describe('grantXp', () => {
  it('calls grant_pokemon_xp RPC with pokemon id, amount, and reason', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { new_xp: 500, new_level: 8, leveled_up: true },
      error: null,
    })

    const result = await grantXp(42, 500, 'dungeon')

    expect(mockRpc).toHaveBeenCalledWith('grant_pokemon_xp', {
      p_pokemon_id: 42,
      p_xp_amount: 500,
      p_reason: 'dungeon',
    })
    expect(mockFrom).not.toHaveBeenCalled()
    expect(result).toEqual({ new_xp: 500, new_level: 8, leveled_up: true })
  })

  it('uses "dungeon" as default reason', async () => {
    mockRpc.mockResolvedValueOnce({ data: { new_xp: 100, new_level: 5, leveled_up: false }, error: null })

    await grantXp(1, 100)

    expect(mockRpc).toHaveBeenCalledWith('grant_pokemon_xp', {
      p_pokemon_id: 1,
      p_xp_amount: 100,
      p_reason: 'dungeon',
    })
  })

  it('propagates not_owner error', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: new Error('not_owner') })

    await expect(grantXp(99, 200)).rejects.toThrow('not_owner')
  })

  it('propagates invalid_xp_amount error', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: new Error('invalid_xp_amount') })

    await expect(grantXp(1, 0)).rejects.toThrow('invalid_xp_amount')
  })
})

// ── Integration scenario reminders (require real DB) ─────────────────────────
//
// TKN-INV-1: Direct client UPDATE profiles SET tokens = x is rejected
//   Action: Authenticated client calls supabase.from('profiles').update({tokens: 9999})
//   Expected: column privilege violation after migration 006 is applied.
//
// TKN-INV-2: collect_passive_tokens called twice within 3 minutes
//   Expected: second call raises 'too_soon'.
//
// TKN-INV-3: spend_tokens_learn_move with insufficient balance
//   Expected: raises 'insufficient_tokens', pokemon_xp.moves unchanged.
//
// TKN-INV-4: skip_swap_cooldown with no active cooldown
//   Expected: raises 'no_active_cooldown', no token debit occurs.
//
// TKN-INV-5: Concurrent collect_passive_tokens calls
//   Expected: one wins; total credit equals exactly one calculation period.
