import { describe, expect, it } from 'vitest'
import { TOOL_BY_ID } from '../../professions/domain/catalog/tools'
import { PLAYTEST_START_COINS, SHOP_ENTRIES, buy, entryById } from './playtestShop'

describe('the playtest catalog', () => {
  it('only sells items that already exist', () => {
    for (const entry of SHOP_ENTRIES) {
      if (entry.effect.kind === 'tool') expect(TOOL_BY_ID.has(entry.effect.itemId), entry.id).toBe(true)
    }
  })

  it('sells the worst tier of every tool, and nothing better', () => {
    const forSale = SHOP_ENTRIES
      .filter(entry => entry.effect.kind === 'tool')
      .map(entry => TOOL_BY_ID.get((entry.effect as { itemId: string }).itemId)!)
    // One per tool kind, all tier 1, all usable from level 1.
    expect(new Set(forSale.map(tool => tool.kind)).size).toBe(forSale.length)
    for (const tool of forSale) {
      expect(tool.tier, tool.itemId).toBe(1)
      expect(tool.requiredLevel, tool.itemId).toBe(1)
    }
  })

  it('covers all four professions, so nobody is locked out of one', () => {
    const kinds = SHOP_ENTRIES
      .filter(entry => entry.effect.kind === 'tool')
      .map(entry => TOOL_BY_ID.get((entry.effect as { itemId: string }).itemId)!.kind)
    expect(new Set(kinds)).toEqual(new Set(['pickaxe', 'axe', 'rod', 'sickle']))
  })

  it('lets the starting purse buy every tool with something left over', () => {
    const toolCost = SHOP_ENTRIES
      .filter(entry => entry.effect.kind === 'tool')
      .reduce((sum, entry) => sum + entry.price, 0)
    expect(toolCost).toBeLessThan(PLAYTEST_START_COINS)
  })
})

describe('buying', () => {
  const owned: string[] = []

  it('charges the price and returns the balance, not a delta', () => {
    const result = buy({ entryId: 'stone_pickaxe', coins: 100, owned })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.coins).toBe(100 - result.entry.price)
  })

  it('refuses what you cannot afford', () => {
    expect(buy({ entryId: 'stone_pickaxe', coins: 10, owned })).toEqual({ ok: false, reason: 'poor' })
  })

  it('refuses a second copy of a tool', () => {
    expect(buy({ entryId: 'stone_pickaxe', coins: 999, owned: ['stone_pickaxe'] })).toEqual({ ok: false, reason: 'owned' })
  })

  it('lets supplies be bought again and again', () => {
    expect(buy({ entryId: 'poke_ball_5', coins: 999, owned: ['poke_ball_5'] }).ok).toBe(true)
  })

  it('refuses something that is not for sale', () => {
    expect(buy({ entryId: 'master_rod', coins: 9_999, owned })).toEqual({ ok: false, reason: 'unknown' })
    expect(entryById('master_rod')).toBeNull()
  })

  it('cannot be double-clicked into free goods', () => {
    // Both clicks read the same balance, which is the state a naive
    // implementation would let them both debit.
    const first = buy({ entryId: 'basic_rod', coins: 70, owned })
    const second = buy({ entryId: 'basic_rod', coins: 70, owned })
    expect(first.ok && second.ok).toBe(true)
    // Applying either result leaves the same balance: the rule returns the
    // balance to store, so the second write overwrites rather than subtracts.
    if (first.ok && second.ok) expect(first.coins).toBe(second.coins)
  })

  it('never leaves a negative balance', () => {
    for (const entry of SHOP_ENTRIES) {
      const result = buy({ entryId: entry.id, coins: entry.price, owned: [] })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.coins).toBeGreaterThanOrEqual(0)
    }
  })
})
