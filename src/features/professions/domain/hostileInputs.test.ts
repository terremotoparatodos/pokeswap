// R31-Z — pure invariants against hostile or corrupt numbers.
//
// The resolvers are meant to run inside a server authority. Whatever feeds
// them there (a decoded intent, a database row, a cached context) can carry
// NaN, negatives, fractions or out-of-range bonuses. Every check must fail
// closed: refuse, or report nothing done, never "succeed" with a corrupt value.
// Authority rules (distance, station presence, ownership, replay, server clock,
// RNG source) are R32-0 and are deliberately not tested here.

import { describe, expect, it } from 'vitest'
import { addStacks, createContainer, removeStacks, transferSlot, type StackRules } from '../inventory/slotInventory'
import { NODE_BY_ID } from './catalog/nodes'
import { ENERGY_CONFIG } from './catalog/professions'
import { RECIPE_BY_ID } from './catalog/recipes'
import { TOOL_BY_ID } from './catalog/tools'
import { createToolInstance, wearTool } from './durability'
import { createEnergyState, spendEnergy } from './energy'
import { previewGathering, resolveGathering } from './gathering'
import { addItems, hasItems, removeItems } from './inventory'
import { resolveProcessing, type ProcessingContext } from './processing'
import type { GatheringContext } from './types'

const HOSTILE = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 0.5]

describe('slot inventory rejects impossible quantities', () => {
  const rules: StackRules = { maxStack: () => 10 }
  const bag = addStacks(createContainer('bag', 'player_inventory', 4), [{ itemId: 'stone', quantity: 5 }], rules).container

  it.each(HOSTILE.concat(0))('removeStacks(%s) refuses instead of reporting success', quantity => {
    expect(removeStacks(bag, [{ itemId: 'stone', quantity }])).toBeNull()
  })

  it.each(HOSTILE.concat(0))('addStacks(%s) throws instead of dropping or inventing units', quantity => {
    expect(() => addStacks(bag, [{ itemId: 'stone', quantity }], rules)).toThrow(RangeError)
  })

  it.each(HOSTILE.concat(0))('transferSlot(%s) moves nothing', quantity => {
    expect(transferSlot(bag, createContainer('chest', 'storage', 2), 0, quantity, rules)).toBeNull()
  })

  it('still accepts ordinary whole quantities', () => {
    expect(removeStacks(bag, [{ itemId: 'stone', quantity: 5 }])?.slots[0]).toBeNull()
    expect(transferSlot(bag, createContainer('chest', 'storage', 2), 0, 2, rules)?.moved).toBe(2)
  })
})

describe('count inventory rejects impossible quantities', () => {
  it.each(HOSTILE.concat(0))('hasItems / removeItems with %s', quantity => {
    expect(hasItems({ stone: 5 }, [{ itemId: 'stone', quantity }])).toBe(false)
    expect(removeItems({ stone: 5 }, [{ itemId: 'stone', quantity }])).toBeNull()
  })

  it.each(HOSTILE.concat(0))('addItems with %s throws', quantity => {
    expect(() => addItems({ stone: 5 }, [{ itemId: 'stone', quantity }])).toThrow(RangeError)
  })
})

describe('gathering fails closed on corrupt context numbers', () => {
  const definition = TOOL_BY_ID.get('iron_pickaxe')!
  const context = (overrides: Partial<GatheringContext> = {}): GatheringContext => ({
    node: NODE_BY_ID.get('iron_vein')!,
    professionLevel: 20,
    tool: { definition, instance: createToolInstance(definition, 'p') },
    bonuses: {},
    access: [],
    homeBiomes: [],
    biome: 'desert',
    availableEnergy: 100,
    rested: false,
    energyConfig: ENERGY_CONFIG,
    random: () => 0.99,
    ...overrides,
  })

  it('treats an unknown level as too low', () => {
    expect(previewGathering(context({ professionLevel: Number.NaN }))).toEqual({ ok: false, reason: 'level_too_low' })
  })

  it('treats unknown energy as insufficient', () => {
    expect(resolveGathering(context({ availableEnergy: Number.NaN }))).toEqual({ ok: false, reason: 'insufficient_energy' })
  })
})

describe('processing never produces impossible time', () => {
  const smelt = (overrides: Partial<ProcessingContext> = {}): ProcessingContext => ({
    recipe: RECIPE_BY_ID.get('smelt_iron')!,
    professionLevel: 12,
    inventory: { iron_ore: 6, coal: 3 },
    quantity: 3,
    processingBonus: 0,
    station: 'owned',
    stationSpeedBonus: 0,
    random: () => 0.99,
    ...overrides,
  })

  it('treats an unknown level as too low', () => {
    expect(resolveProcessing(smelt({ professionLevel: Number.NaN }))).toEqual({ ok: false, reason: 'level_too_low' })
  })

  it.each([3, 1, Number.NaN, Number.POSITIVE_INFINITY, -2])('station bonus %s keeps seconds finite and positive', stationSpeedBonus => {
    const result = resolveProcessing(smelt({ stationSpeedBonus }))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(Number.isFinite(result.seconds)).toBe(true)
      expect(result.seconds).toBeGreaterThan(0)
    }
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])('processing bonus %s keeps every output finite', processingBonus => {
    const result = resolveProcessing(smelt({ processingBonus, random: () => 0 }))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(Number.isFinite(result.seconds)).toBe(true)
      for (const stack of [...result.consumed, ...result.produced]) expect(Number.isInteger(stack.quantity)).toBe(true)
    }
  })
})

describe('energy and durability refuse corrupt amounts', () => {
  it.each([Number.NaN, -5, Number.POSITIVE_INFINITY])('spendEnergy(%s) refuses', amount => {
    expect(spendEnergy(createEnergyState(100, 0), amount)).toBeNull()
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0.5])('wearTool(%s) throws instead of corrupting durability', loss => {
    const tool = createToolInstance(TOOL_BY_ID.get('iron_pickaxe')!, 'p')
    expect(() => wearTool(tool, loss)).toThrow(RangeError)
  })

  it('still wears by whole points and never below zero', () => {
    const tool = createToolInstance(TOOL_BY_ID.get('iron_pickaxe')!, 'p')
    expect(wearTool(tool, 2).durability).toBe(tool.durability - 2)
    expect(wearTool(tool, tool.durability + 10).durability).toBe(0)
    expect(wearTool(tool, -3).durability).toBe(tool.durability)
  })
})
