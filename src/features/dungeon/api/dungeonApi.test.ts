// Dungeon API invariant tests (R14/R15/R18).
// Tests verify that the service layer calls the correct server contracts and
// never touches slots.energy, pokemon_xp, or profiles.tokens directly.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../shared/api/supabase', () => ({
  supabase: {
    from: vi.fn(),
    functions: { invoke: vi.fn() },
    rpc: vi.fn(),
  },
}))

import { supabase } from '../../../shared/api/supabase'
import { startDungeon, submitDungeonReward } from './dungeonApi'

const mockInvoke = supabase.functions.invoke as ReturnType<typeof vi.fn>
const mockFrom   = supabase.from as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
})

// ── startDungeon ──────────────────────────────────────────────────────────────

describe('startDungeon', () => {
  it('invokes dungeon-start with pokemon_id and returns remaining_energy', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { remaining_energy: 70 }, error: null })

    const result = await startDungeon(7)

    expect(mockInvoke).toHaveBeenCalledWith('dungeon-start', { body: { pokemon_id: 7 } })
    expect(mockFrom).not.toHaveBeenCalled()
    expect(result).toEqual({ remaining_energy: 70 })
  })

  it('never calls supabase.from directly (trust boundary — no direct slots.energy write)', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { remaining_energy: 40 }, error: null })

    await startDungeon(1)

    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('propagates not_owner error', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: new Error('not_owner') })

    await expect(startDungeon(99)).rejects.toThrow('not_owner')
  })

  it('propagates pokemon_locked error', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: new Error('pokemon_locked') })

    await expect(startDungeon(5)).rejects.toThrow('pokemon_locked')
  })

  it('propagates insufficient_energy error', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: new Error('insufficient_energy') })

    await expect(startDungeon(3)).rejects.toThrow('insufficient_energy')
  })
})

// ── submitDungeonReward ───────────────────────────────────────────────────────

describe('submitDungeonReward', () => {
  const okResponse = {
    new_xp: 850, new_level: 12, leveled_up: true, tokens_awarded: 300, new_balance: 1500,
  }

  it('invokes dungeon-reward with pokemon_id, xp_earned, tokens_earned', async () => {
    mockInvoke.mockResolvedValueOnce({ data: okResponse, error: null })

    const result = await submitDungeonReward({ pokemon_id: 7, xp_earned: 400, tokens_earned: 300 })

    expect(mockInvoke).toHaveBeenCalledWith('dungeon-reward', {
      body: { pokemon_id: 7, xp_earned: 400, tokens_earned: 300 },
    })
    expect(mockFrom).not.toHaveBeenCalled()
    expect(result).toEqual(okResponse)
  })

  it('never calls supabase.from directly (trust boundary — no direct pokemon_xp write)', async () => {
    mockInvoke.mockResolvedValueOnce({ data: okResponse, error: null })

    await submitDungeonReward({ pokemon_id: 1, xp_earned: 0, tokens_earned: 0 })

    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('propagates not_owner error', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: new Error('not_owner') })

    await expect(submitDungeonReward({ pokemon_id: 99, xp_earned: 100, tokens_earned: 50 }))
      .rejects.toThrow('not_owner')
  })

  it('propagates profile_not_found error', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: new Error('profile_not_found') })

    await expect(submitDungeonReward({ pokemon_id: 1, xp_earned: 100, tokens_earned: 50 }))
      .rejects.toThrow('profile_not_found')
  })

  it('returns tokens_awarded=0 when daily cap is already exhausted', async () => {
    const cappedResponse = { ...okResponse, tokens_awarded: 0, new_balance: 1200 }
    mockInvoke.mockResolvedValueOnce({ data: cappedResponse, error: null })

    const result = await submitDungeonReward({ pokemon_id: 7, xp_earned: 200, tokens_earned: 500 })

    expect(result.tokens_awarded).toBe(0)
  })

  it('returns leveled_up=false when no XP level change occurred', async () => {
    const noLevelUp = { ...okResponse, leveled_up: false }
    mockInvoke.mockResolvedValueOnce({ data: noLevelUp, error: null })

    const result = await submitDungeonReward({ pokemon_id: 7, xp_earned: 10, tokens_earned: 100 })

    expect(result.leveled_up).toBe(false)
  })
})

// ── Integration scenario reminders (require real DB) ─────────────────────────
//
// DGN-INV-1: startDungeon on a pokemon_id not owned by the caller
//   Expected: raises 'not_owner', slots.energy unchanged.
//
// DGN-INV-2: startDungeon on a pokemon with energy < 30
//   Expected: raises 'insufficient_energy', slots.energy unchanged.
//
// DGN-INV-3: startDungeon on a pokemon that is in an active market listing
//   Expected: raises 'pokemon_locked', slots.energy unchanged.
//
// DGN-INV-4: Direct client UPDATE slots SET energy = 100
//   Expected: column privilege violation (slots.energy has no column grant for authenticated role).
//
// DGN-INV-5: startDungeon succeeds — slots.energy decremented by exactly 30,
//   energy_updated_at updated, returned remaining_energy matches stored value.
