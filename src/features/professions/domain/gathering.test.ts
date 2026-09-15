import { describe, expect, it } from 'vitest'
import { NODE_BY_ID } from './catalog/nodes'
import { ENERGY_CONFIG } from './catalog/professions'
import { RECIPE_BY_ID } from './catalog/recipes'
import { TOOL_BY_ID } from './catalog/tools'
import { createToolInstance, wearTool } from './durability'
import { previewGathering, resolveGathering } from './gathering'
import { resolveProcessing, type ProcessingContext } from './processing'
import type { EquippedTool, GatheringContext } from './types'

const equip = (itemId: string): EquippedTool => {
  const definition = TOOL_BY_ID.get(itemId)!
  return { definition, instance: createToolInstance(definition, `${itemId}-1`) }
}

/** Yields the given values in order, then `fallback` forever. */
const sequence = (values: number[], fallback = 0.99) => () => values.length ? values.shift()! : fallback

const context = (overrides: Partial<GatheringContext> = {}): GatheringContext => ({
  node: NODE_BY_ID.get('iron_vein')!,
  professionLevel: 20,
  tool: equip('iron_pickaxe'),
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

describe('resolveGathering validation', () => {
  it.each([
    ['level_too_low', { professionLevel: 10 }],
    ['wrong_biome', { biome: 'forest' as const }],
    ['tool_required', { tool: null }],
    ['tool_required', { tool: equip('iron_axe') }],
    ['tool_tier_too_low', { node: NODE_BY_ID.get('gold_vein')!, professionLevel: 40, tool: equip('stone_pickaxe') }],
    ['access_required', { node: NODE_BY_ID.get('crystal_cluster')! }],
    ['insufficient_energy', { availableEnergy: 19 }],
  ])('rejects %s', (reason, overrides) => {
    expect(resolveGathering(context(overrides))).toEqual({ ok: false, reason })
  })

  it('rejects a broken tool', () => {
    const tool = equip('iron_pickaxe')
    expect(resolveGathering(context({ tool: { ...tool, instance: wearTool(tool.instance, 999) } }))).toEqual({ ok: false, reason: 'tool_broken' })
  })
})

describe('resolveGathering results', () => {
  it('produces the base outcome without procs', () => {
    expect(resolveGathering(context())).toEqual({
      ok: true,
      drops: [{ itemId: 'iron_ore', quantity: 1 }],
      rareDrops: [],
      fineUnits: 0,
      critical: false,
      energySpent: 19.5,
      actionSeconds: 14.84,
      xp: 110,
      durabilityLoss: 1,
    })
  })

  it('applies every Pokémon niche when procs succeed', () => {
    const result = resolveGathering(context({
      bonuses: { critical: 0.1, yield: 0.2, quality: 0.3, toolCare: 0.5, rareFind: 1 },
      random: () => 0,
    }))
    expect(result).toMatchObject({
      ok: true,
      critical: true,
      drops: [{ itemId: 'iron_ore', quantity: 4 }, { itemId: 'coal', quantity: 1 }],
      rareDrops: [{ itemId: 'evolution_shard', quantity: 1 }],
      fineUnits: 4,
      durabilityLoss: 0,
    })
  })

  it('caps the extra-unit chance', () => {
    const bonuses = { yield: 5 }
    // Rolls: critical, primary quantity, extra unit.
    expect(resolveGathering(context({ bonuses, random: sequence([0.99, 0, 0.59]) }))).toMatchObject({ drops: [{ itemId: 'iron_ore', quantity: 2 }] })
    expect(resolveGathering(context({ bonuses, random: sequence([0.99, 0, 0.61]) }))).toMatchObject({ drops: [{ itemId: 'iron_ore', quantity: 1 }] })
  })

  it('floors action time and applies the rested XP bonus', () => {
    expect(resolveGathering(context({ bonuses: { speed: 1 }, rested: true }))).toMatchObject({ actionSeconds: 7.2, xp: 165 })
  })

  it('lets new players gather tier-1 nodes bare-handed, slower and without wear', () => {
    expect(resolveGathering(context({
      node: NODE_BY_ID.get('stone_outcrop')!, professionLevel: 1, tool: null, biome: 'grassland',
    }))).toMatchObject({ ok: true, actionSeconds: 18, durabilityLoss: 0, drops: [{ itemId: 'stone', quantity: 1 }] })
  })

  it('doubles wear when the node out-tiers the tool', () => {
    expect(resolveGathering(context({ tool: equip('stone_pickaxe') }))).toMatchObject({ ok: true, durabilityLoss: 2 })
  })

  it('applies biome mastery only in home biomes', () => {
    const bonuses = { biomeMastery: 0.2 }
    const rolls = () => sequence([0.99, 0, 0.1])
    expect(resolveGathering(context({ bonuses, homeBiomes: ['desert'], random: rolls() }))).toMatchObject({ drops: [{ itemId: 'iron_ore', quantity: 2 }] })
    expect(resolveGathering(context({ bonuses, homeBiomes: ['forest'], random: rolls() }))).toMatchObject({ drops: [{ itemId: 'iron_ore', quantity: 1 }] })
  })
})

describe('previewGathering', () => {
  it('exposes the resolver deterministic values and final odds without rolling dice', () => {
    const check = previewGathering(context())
    expect(check.ok).toBe(true)
    if (!check.ok) return
    const result = resolveGathering(context())
    expect(result).toMatchObject({ energySpent: check.preview.energySpent, actionSeconds: check.preview.actionSeconds, xp: check.preview.xp })
    expect(check.preview).toMatchObject({ primaryItemId: 'iron_ore', minUnits: 1, maxUnits: 1, durabilityPoints: 1, bareHands: false })
    // Tool +5 %, level 20 on a level-15 node +2 %.
    expect(check.preview.extraUnitChance).toBeCloseTo(0.07)
    expect(check.preview.secondary.find(odds => odds.rare)?.chance).toBeCloseTo(0.006 * 1.1)
  })

  it('returns the same rejection as the resolver', () => {
    expect(previewGathering(context({ professionLevel: 1 }))).toEqual({ ok: false, reason: 'level_too_low' })
  })
})

describe('resolveProcessing', () => {
  const smelt = (overrides: Partial<ProcessingContext> = {}): ProcessingContext => ({
    recipe: RECIPE_BY_ID.get('smelt_iron')!,
    professionLevel: 12,
    inventory: { iron_ore: 6, coal: 3 },
    quantity: 3,
    processingBonus: 0,
    station: 'public',
    stationSpeedBonus: 0,
    random: () => 0.99,
    ...overrides,
  })

  it.each([
    ['invalid_quantity', { quantity: 0 }],
    ['invalid_quantity', { quantity: 1.5 }],
    ['invalid_quantity', { quantity: 101 }],
    ['level_too_low', { professionLevel: 11 }],
    ['missing_inputs', { inventory: { iron_ore: 6, coal: 2 } }],
  ])('rejects %s', (reason, overrides) => {
    expect(resolveProcessing(smelt(overrides))).toEqual({ ok: false, reason })
  })

  it('consumes inputs and produces outputs at a slower public station', () => {
    expect(resolveProcessing(smelt())).toEqual({
      ok: true,
      consumed: [{ itemId: 'iron_ore', quantity: 6 }, { itemId: 'coal', quantity: 3 }],
      produced: [{ itemId: 'iron_ingot', quantity: 3 }],
      savedInputs: 0,
      seconds: 27,
      xp: 54,
    })
  })

  it('caps the processing trait and rewards owned stations', () => {
    expect(resolveProcessing(smelt({ processingBonus: 0.5, station: 'owned', stationSpeedBonus: 0.15, random: () => 0 }))).toMatchObject({
      consumed: [{ itemId: 'iron_ore', quantity: 3 }, { itemId: 'coal', quantity: 3 }],
      savedInputs: 3,
      seconds: 10.71,
    })
  })
})
