import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useDungeon, _resetDungeonState } from './useDungeon'

const mockStartDungeon   = vi.fn()
const mockSubmitReward   = vi.fn()

vi.mock('../api/dungeonApi', () => ({
  startDungeon:         (...a: unknown[]) => mockStartDungeon(...a),
  submitDungeonReward:  (...a: unknown[]) => mockSubmitReward(...a),
}))

const SUMMARY = {
  won: true, rounds: [], xpEarned: 300, tokensEarned: 80,
}
const REWARD = {
  new_xp: 1300, new_level: 5, leveled_up: false,
  tokens_awarded: 80, new_balance: 9080,
}

beforeEach(() => {
  _resetDungeonState()
  vi.clearAllMocks()
  mockStartDungeon.mockResolvedValue({ remaining_energy: 70 })
  mockSubmitReward.mockResolvedValue(REWARD)
})

describe('useDungeon', () => {
  it('starts in idle phase', () => {
    const { phase } = useDungeon()
    expect(phase.value).toBe('idle')
  })

  it('enterDungeon transitions idle → starting → combat', async () => {
    const { phase, enterDungeon, remainingEnergy } = useDungeon()
    await enterDungeon(25)
    expect(phase.value).toBe('combat')
    expect(remainingEnergy.value).toBe(70)
    expect(mockStartDungeon).toHaveBeenCalledWith(25)
  })

  it('enterDungeon reverts to idle on error', async () => {
    mockStartDungeon.mockRejectedValue(new Error('Insufficient energy'))
    const { phase, error, enterDungeon } = useDungeon()
    await enterDungeon(25)
    expect(phase.value).toBe('idle')
    expect(error.value).toContain('Insufficient energy')
  })

  it('finishRun transitions combat → submitting → result', async () => {
    const { phase, result, enterDungeon, finishRun } = useDungeon()
    await enterDungeon(25)
    await finishRun(SUMMARY)
    expect(phase.value).toBe('result')
    expect(result.value?.newXp).toBe(1300)
    expect(result.value?.tokensAwarded).toBe(80)
    expect(result.value?.leveledUp).toBe(false)
  })

  it('finishRun sends advisory XP and tokens to server', async () => {
    const { enterDungeon, finishRun } = useDungeon()
    await enterDungeon(25)
    await finishRun(SUMMARY)
    expect(mockSubmitReward).toHaveBeenCalledWith({
      pokemon_id: 25, xp_earned: 300, tokens_earned: 80,
    })
  })

  it('finishRun reverts to combat on submit error', async () => {
    mockSubmitReward.mockRejectedValue(new Error('Server error'))
    const { phase, error, enterDungeon, finishRun } = useDungeon()
    await enterDungeon(25)
    await finishRun(SUMMARY)
    expect(phase.value).toBe('combat')
    expect(error.value).toContain('Server error')
  })

  it('finishRun does nothing when no pokemonId set', async () => {
    const { finishRun } = useDungeon()
    await finishRun(SUMMARY)
    expect(mockSubmitReward).not.toHaveBeenCalled()
  })

  it('reset returns to idle and clears all state', async () => {
    const { phase, result, error, enterDungeon, finishRun, reset } = useDungeon()
    await enterDungeon(25)
    await finishRun(SUMMARY)
    reset()
    expect(phase.value).toBe('idle')
    expect(result.value).toBeNull()
    expect(error.value).toBeNull()
  })
})
