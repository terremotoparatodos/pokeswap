// useSwap.test.ts — R19
//
// Verifies: cooldown state management, canSwap / secondsRemaining derivations,
// executeSwap updates cooldown from server result, skipCooldown clears it,
// and loadHistory populates the history ref.
// Does NOT test the swapApi functions themselves — those are server contracts
// tested in swapApi.test.ts (to be added in a later R if needed).

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../api/swapApi', () => ({
  swap:         vi.fn(),
  skipCooldown: vi.fn(),
  getHistory:   vi.fn(),
}))

import { useSwap, _resetSwapState } from './useSwap'
import { swap as apiSwap, skipCooldown as apiSkipCooldown, getHistory } from '../api/swapApi'

const mockSwap         = apiSwap         as ReturnType<typeof vi.fn>
const mockSkipCooldown = apiSkipCooldown as ReturnType<typeof vi.fn>
const mockGetHistory   = getHistory      as ReturnType<typeof vi.fn>

function futureIso(ms: number): string {
  return new Date(Date.now() + ms).toISOString()
}

function pastIso(ms: number): string {
  return new Date(Date.now() - ms).toISOString()
}

beforeEach(() => {
  vi.clearAllMocks()
  _resetSwapState()
})

// ── syncCooldown ──────────────────────────────────────────────────────────────

describe('syncCooldown', () => {
  it('sets canSwap true when cooldown is null', () => {
    const { syncCooldown, canSwap } = useSwap()
    syncCooldown(null)
    expect(canSwap.value).toBe(true)
  })

  it('sets canSwap false when cooldown is in the future', () => {
    const { syncCooldown, canSwap } = useSwap()
    syncCooldown(futureIso(8 * 60 * 60 * 1000))
    expect(canSwap.value).toBe(false)
  })

  it('sets canSwap true when cooldown is in the past', () => {
    const { syncCooldown, canSwap } = useSwap()
    syncCooldown(pastIso(1000))
    expect(canSwap.value).toBe(true)
  })

  it('is shared across useSwap() calls (singleton)', () => {
    const a = useSwap()
    const b = useSwap()
    a.syncCooldown(futureIso(3600_000))
    expect(b.canSwap.value).toBe(false)
  })
})

// ── secondsRemaining ─────────────────────────────────────────────────────────

describe('secondsRemaining', () => {
  it('is 0 when no cooldown', () => {
    const { secondsRemaining } = useSwap()
    expect(secondsRemaining.value).toBe(0)
  })

  it('is 0 when cooldown is in the past', () => {
    const { syncCooldown, secondsRemaining } = useSwap()
    syncCooldown(pastIso(5000))
    expect(secondsRemaining.value).toBe(0)
  })

  it('is positive when cooldown is in the future', () => {
    const { syncCooldown, secondsRemaining } = useSwap()
    syncCooldown(futureIso(30_000))
    expect(secondsRemaining.value).toBeGreaterThan(0)
    expect(secondsRemaining.value).toBeLessThanOrEqual(30)
  })
})

// ── executeSwap ───────────────────────────────────────────────────────────────

describe('executeSwap', () => {
  const fakeResult = {
    pokemon_given_id:    1,
    pokemon_received_id: 25,
    was_shiny:           false,
    rarity:              'common',
    swap_cooldown_until: futureIso(8 * 60 * 60 * 1000),
  }

  it('calls apiSwap with no pokemon_given_id when omitted', async () => {
    mockSwap.mockResolvedValueOnce(fakeResult)
    const { executeSwap } = useSwap()
    await executeSwap()
    expect(mockSwap).toHaveBeenCalledWith(undefined)
  })

  it('passes pokemon_given_id through to apiSwap', async () => {
    mockSwap.mockResolvedValueOnce(fakeResult)
    const { executeSwap } = useSwap()
    await executeSwap(42)
    expect(mockSwap).toHaveBeenCalledWith(42)
  })

  it('updates cooldownUntil from server result', async () => {
    mockSwap.mockResolvedValueOnce(fakeResult)
    const { executeSwap, canSwap } = useSwap()
    expect(canSwap.value).toBe(true)
    await executeSwap()
    expect(canSwap.value).toBe(false)
  })

  it('returns the full SwapResult', async () => {
    mockSwap.mockResolvedValueOnce(fakeResult)
    const { executeSwap } = useSwap()
    const result = await executeSwap()
    expect(result).toEqual(fakeResult)
  })

  it('clears isSwapping after success', async () => {
    mockSwap.mockResolvedValueOnce(fakeResult)
    const { executeSwap, isSwapping } = useSwap()
    await executeSwap()
    expect(isSwapping.value).toBe(false)
  })

  it('clears isSwapping after failure', async () => {
    mockSwap.mockRejectedValueOnce(new Error('network error'))
    const { executeSwap, isSwapping } = useSwap()
    await expect(executeSwap()).rejects.toThrow('network error')
    expect(isSwapping.value).toBe(false)
  })

  it('does not mutate cooldownUntil on failure', async () => {
    mockSwap.mockRejectedValueOnce(new Error('server error'))
    const { syncCooldown, executeSwap, cooldownUntil } = useSwap()
    syncCooldown(null)
    await expect(executeSwap()).rejects.toThrow()
    expect(cooldownUntil.value).toBeNull()
  })
})

// ── skipCooldown ──────────────────────────────────────────────────────────────

describe('skipCooldown', () => {
  it('calls apiSkipCooldown', async () => {
    mockSkipCooldown.mockResolvedValueOnce({ new_balance: 4000 })
    const { skipCooldown } = useSwap()
    await skipCooldown()
    expect(mockSkipCooldown).toHaveBeenCalledOnce()
  })

  it('clears cooldownUntil on success', async () => {
    mockSkipCooldown.mockResolvedValueOnce({ new_balance: 4000 })
    const { syncCooldown, skipCooldown, canSwap } = useSwap()
    syncCooldown(futureIso(3_600_000))
    expect(canSwap.value).toBe(false)
    await skipCooldown()
    expect(canSwap.value).toBe(true)
  })

  it('returns new_balance from the RPC', async () => {
    mockSkipCooldown.mockResolvedValueOnce({ new_balance: 3500 })
    const { skipCooldown } = useSwap()
    const result = await skipCooldown()
    expect(result).toEqual({ new_balance: 3500 })
  })
})

// ── loadHistory ───────────────────────────────────────────────────────────────

describe('loadHistory', () => {
  const fakeHistory = [
    {
      id: 'abc',
      user_id: 'u1',
      pokemon_given_id: 1,
      pokemon_received_id: 2,
      was_shiny: false,
      rarity: 'common',
      created_at: '2026-01-01T00:00:00Z',
    },
  ]

  it('populates history ref', async () => {
    mockGetHistory.mockResolvedValueOnce(fakeHistory)
    const { loadHistory, history } = useSwap()
    expect(history.value).toHaveLength(0)
    await loadHistory()
    expect(history.value).toHaveLength(1)
    expect(history.value[0].id).toBe('abc')
  })

  it('clears historyLoading after success', async () => {
    mockGetHistory.mockResolvedValueOnce(fakeHistory)
    const { loadHistory, historyLoading } = useSwap()
    await loadHistory()
    expect(historyLoading.value).toBe(false)
  })

  it('clears historyLoading after failure', async () => {
    mockGetHistory.mockRejectedValueOnce(new Error('fetch error'))
    const { loadHistory, historyLoading } = useSwap()
    await expect(loadHistory()).rejects.toThrow()
    expect(historyLoading.value).toBe(false)
  })
})
