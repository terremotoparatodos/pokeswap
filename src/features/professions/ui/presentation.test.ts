import { describe, expect, it } from 'vitest'
import { NODE_BY_ID } from '../domain/catalog/nodes'
import { ENERGY_CONFIG } from '../domain/catalog/professions'
import { RECIPE_BY_ID } from '../domain/catalog/recipes'
import { TOOL_BY_ID } from '../domain/catalog/tools'
import { createToolInstance, repairTool, wearTool } from '../domain/durability'
import { totalXpForLevel } from '../domain/progression'
import { findDemoWorker, workerAffinity } from '../demo/demoWorkers'
import { compareWorkers, formatTrait, MAX_RATING, rateCapabilities, summarizeWorker } from './capabilities'
import { energyCostBreakdown, energyView, toolHealth } from './gearViews'
import { professionUnlocks, progressionView, recipeTitle } from './progressionView'
import { maxCraftable, recipeView } from './recipeView'

const affinity = (speciesId: number, profession: 'mining' | 'woodcutting' | 'fishing' | 'alchemy', level = 50) =>
  workerAffinity(findDemoWorker(speciesId)!, profession, level)

describe('capability ratings', () => {
  it('rates every capability on a 0–5 scale with readable detail lines', () => {
    for (const rating of rateCapabilities(affinity(68, 'mining'))) {
      expect(rating.rating).toBeGreaterThanOrEqual(0)
      expect(rating.rating).toBeLessThanOrEqual(MAX_RATING)
      for (const line of rating.lines) expect(line.text).toMatch(/%|×/)
    }
    expect(formatTrait('rareFind', 0.28)).toBe('×1,28 rarezas')
    expect(formatTrait('speed', 0.123)).toBe('−12 % de tiempo')
  })

  it('shows each specialist strongest in its own niche', () => {
    expect(summarizeWorker(affinity(68, 'mining')).specialty.id).toBe('extraction')
    expect(summarizeWorker(affinity(81, 'mining')).specialty.id).toBe('prospecting')
    expect(summarizeWorker(affinity(50, 'mining')).specialty.id).toBe('speed')
  })

  it('communicates trade-offs instead of an absolute winner', () => {
    const comparison = compareWorkers(affinity(68, 'mining'), affinity(81, 'mining'))
    expect(comparison.aLeads).toContain('extraction')
    expect(comparison.bLeads).toContain('prospecting')
    expect(() => compareWorkers(affinity(68, 'mining'), affinity(68, 'fishing'))).toThrow()
  })
})

describe('gear views', () => {
  const pickaxe = TOOL_BY_ID.get('iron_pickaxe')!

  it('maps durability to healthy, worn, critical, broken and retired', () => {
    const fresh = createToolInstance(pickaxe, 't')
    expect(toolHealth(fresh, pickaxe)).toMatchObject({ health: 'healthy', ratio: 1, repairsLeft: 6 })
    expect(toolHealth(wearTool(fresh, 80), pickaxe).health).toBe('worn')
    expect(toolHealth(wearTool(fresh, 140), pickaxe).health).toBe('critical')
    expect(toolHealth(wearTool(fresh, 150), pickaxe).health).toBe('broken')
    let tool = fresh
    for (;;) {
      const repaired = repairTool(wearTool(tool, tool.durability), pickaxe)
      if (!repaired.ok) break
      tool = repaired.instance
    }
    expect(toolHealth(wearTool(tool, tool.durability), pickaxe)).toMatchObject({ health: 'retired', repairsLeft: 0 })
  })

  it('explains energy cost and flags the floor', () => {
    const iron = NODE_BY_ID.get('iron_vein')!
    expect(energyCostBreakdown(iron, 0, 15, ENERGY_CONFIG)).toEqual({ base: 20, pokemonSaving: 0, levelSaving: 0, floorApplied: false, final: 20 })
    expect(energyCostBreakdown(iron, 0.5, 60, ENERGY_CONFIG)).toMatchObject({ floorApplied: true, final: 12 })
  })

  it('reports energy ratio and time to refill', () => {
    const state = { current: 300, rested: 12.7, updatedAt: 0, consumableRestoredToday: 0, consumableDay: '2026-09-15' }
    expect(energyView(state, 600, ENERGY_CONFIG)).toEqual({ current: 300, max: 600, ratio: 0.5, rested: 12, minutesToFull: 300 })
  })
})

describe('progression view', () => {
  it('separates defined unlocks from reserved ideas', () => {
    const unlocks = professionUnlocks('mining')
    expect(unlocks.find(entry => entry.id === 'iron_vein')).toMatchObject({ level: 15, status: 'defined' })
    expect(unlocks.find(entry => entry.kind === 'specialization')?.status).toBe('future')
    expect(unlocks.find(entry => entry.name.startsWith('Reservado'))?.status).toBe('future')
    expect(unlocks.map(entry => entry.level)).toEqual([...unlocks.map(entry => entry.level)].sort((a, b) => a - b))
  })

  it('shows progress inside the level and the next unlocks', () => {
    const view = progressionView('mining', totalXpForLevel(16) + 10)
    expect(view).toMatchObject({ level: 16, levelXp: 10 })
    expect(view.progress).toBeGreaterThan(0)
    expect(view.unlocked.some(entry => entry.id === 'iron_vein')).toBe(true)
    expect(view.upcoming[0].level).toBeGreaterThan(16)
    expect(view.upcoming.some(entry => entry.id === 'crystal_cluster')).toBe(true)
    expect(progressionView('mining', Number.MAX_SAFE_INTEGER)).toMatchObject({ level: 60, progress: 1, upcoming: [] })
  })

  it('names recipes by their output', () => {
    expect(recipeTitle(RECIPE_BY_ID.get('make_vial')!)).toBe('2 × Frasco')
  })
})

describe('recipe view', () => {
  const potion = RECIPE_BY_ID.get('brew_potion')!

  it('distinguishes ready, missing and locked recipes', () => {
    expect(recipeView(potion, { oran_berry: 4, vial: 2 }, 1, 2)).toMatchObject({ availability: 'ready', maxCraftable: 2 })
    const missing = recipeView(potion, { oran_berry: 3, vial: 2 }, 1, 2)
    expect(missing.availability).toBe('missing')
    expect(missing.ingredients.find(ingredient => ingredient.itemId === 'oran_berry')).toMatchObject({ need: 4, have: 3, missing: 1 })
    expect(recipeView(RECIPE_BY_ID.get('brew_hyper_potion')!, {}, 10).availability).toBe('locked')
  })

  it('caps batch size and scales public station time', () => {
    expect(maxCraftable(potion, { oran_berry: 1000, vial: 1000 })).toBe(100)
    expect(recipeView(potion, {}, 1, 3).seconds).toBe(22.5)
  })
})
