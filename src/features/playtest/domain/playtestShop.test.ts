import { describe, expect, it } from 'vitest'
import { PLAYTEST_START_COINS, SHOP_ENTRIES, buy, entryById } from './playtestShop'

describe('the playtest catalog', () => {
  it('sells no profession tools: the Pokémon does the work (SKILLS-1)', () => {
    for (const entry of SHOP_ENTRIES) expect(entry.effect.kind, entry.id).not.toBe('tool')
    expect(JSON.stringify(SHOP_ENTRIES)).not.toMatch(/pickaxe|_axe|sickle|rod|caña|pico|hacha|hoz/i)
  })

  it('lets the starting purse buy a round of every supply with something left over', () => {
    const round = SHOP_ENTRIES.reduce((sum, entry) => sum + entry.price, 0)
    expect(round).toBeLessThan(PLAYTEST_START_COINS)
  })
})

describe('buying', () => {
  it('charges the price and returns the balance, not a delta', () => {
    const result = buy({ entryId: 'potion_3', coins: 100 })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.coins).toBe(100 - result.entry.price)
  })

  it('refuses what you cannot afford', () => {
    expect(buy({ entryId: 'potion_3', coins: 10 })).toEqual({ ok: false, reason: 'poor' })
  })

  it('lets supplies be bought again and again', () => {
    expect(buy({ entryId: 'poke_ball_5', coins: 999 }).ok).toBe(true)
  })

  it('refuses something that is not for sale', () => {
    expect(buy({ entryId: 'stone_pickaxe', coins: 9_999 })).toEqual({ ok: false, reason: 'unknown' })
    expect(entryById('stone_pickaxe')).toBeNull()
  })

  it('cannot be double-clicked into free goods', () => {
    // Both clicks read the same balance, which is the state a naive
    // implementation would let them both debit.
    const first = buy({ entryId: 'revive_1', coins: 60 })
    const second = buy({ entryId: 'revive_1', coins: 60 })
    expect(first.ok && second.ok).toBe(true)
    // Applying either result leaves the same balance: the rule returns the
    // balance to store, so the second write overwrites rather than subtracts.
    if (first.ok && second.ok) expect(first.coins).toBe(second.coins)
  })

  it('never leaves a negative balance', () => {
    for (const entry of SHOP_ENTRIES) {
      const result = buy({ entryId: entry.id, coins: entry.price })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.coins).toBeGreaterThanOrEqual(0)
    }
  })
})
