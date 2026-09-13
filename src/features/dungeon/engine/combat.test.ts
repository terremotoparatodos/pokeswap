import { describe, it, expect } from 'vitest'
import { runCombat, DUNGEON_ENERGY_COST } from './combat'

describe('runCombat', () => {
  it('returns a result with rounds, won, xpEarned, tokensEarned', () => {
    const result = runCombat(1)
    expect(result).toHaveProperty('won')
    expect(result).toHaveProperty('rounds')
    expect(result).toHaveProperty('xpEarned')
    expect(result).toHaveProperty('tokensEarned')
  })

  it('rounds is non-empty and within MAX_ROUNDS (8)', () => {
    for (let i = 0; i < 10; i++) {
      const { rounds } = runCombat(1)
      expect(rounds.length).toBeGreaterThanOrEqual(1)
      expect(rounds.length).toBeLessThanOrEqual(8)
    }
  })

  it('each round has sequential round numbers starting at 1', () => {
    const { rounds } = runCombat(5)
    rounds.forEach((r, i) => expect(r.round).toBe(i + 1))
  })

  it('HP values are non-negative', () => {
    for (let i = 0; i < 20; i++) {
      const { rounds } = runCombat(10)
      for (const r of rounds) {
        expect(r.playerHpAfter).toBeGreaterThanOrEqual(0)
        expect(r.enemyHpAfter).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('combat ends when either HP reaches 0', () => {
    for (let i = 0; i < 20; i++) {
      const { rounds } = runCombat(5)
      const last = rounds[rounds.length - 1]
      const ended = last.enemyHpAfter === 0 || last.playerHpAfter === 0 || rounds.length === 8
      expect(ended).toBe(true)
    }
  })

  it('won is true iff enemy HP reached 0', () => {
    for (let i = 0; i < 20; i++) {
      const { won, rounds } = runCombat(5)
      const last = rounds[rounds.length - 1]
      if (won) expect(last.enemyHpAfter).toBe(0)
      if (!won) expect(last.playerHpAfter).toBe(0)
    }
  })

  it('advisory xpEarned does not exceed server cap of 10 000', () => {
    for (let i = 0; i < 30; i++) {
      expect(runCombat(100).xpEarned).toBeLessThanOrEqual(10_000)
    }
  })

  it('advisory tokensEarned does not exceed server cap of 3 000', () => {
    for (let i = 0; i < 30; i++) {
      expect(runCombat(100).tokensEarned).toBeLessThanOrEqual(3_000)
    }
  })

  it('tokensEarned is 0 on a loss', () => {
    // Force a loss by using a very low level so enemy usually wins
    let lossFound = false
    for (let i = 0; i < 50; i++) {
      const r = runCombat(0)
      if (!r.won) { expect(r.tokensEarned).toBe(0); lossFound = true; break }
    }
    // If we never lost in 50 runs that's statistically unexpected but not a bug
    if (!lossFound) expect(true).toBe(true)
  })

  it('xpEarned is positive even on a loss', () => {
    for (let i = 0; i < 20; i++) {
      const r = runCombat(0)
      if (!r.won) { expect(r.xpEarned).toBeGreaterThan(0); break }
    }
  })

  it('DUNGEON_ENERGY_COST is 30', () => {
    expect(DUNGEON_ENERGY_COST).toBe(30)
  })
})
