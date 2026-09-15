import { describe, expect, it } from 'vitest'
import { TOOL_BY_ID } from './catalog/tools'
import { createToolInstance, lifetimeDurability, repairCost, repairTool, toolCondition, wearTool } from './durability'

const pickaxe = TOOL_BY_ID.get('stone_pickaxe')!
const ironPickaxe = TOOL_BY_ID.get('iron_pickaxe')!

describe('tool durability', () => {
  it('breaks at zero instead of disappearing', () => {
    const tool = createToolInstance(pickaxe, 't1')
    expect(toolCondition(tool, pickaxe)).toBe('ok')
    const broken = wearTool(tool, 500)
    expect(broken.durability).toBe(0)
    expect(broken.itemId).toBe('stone_pickaxe')
    expect(toolCondition(broken, pickaxe)).toBe('broken')
  })

  it('charges repairs in proportion to missing durability, at least one unit', () => {
    const tool = createToolInstance(ironPickaxe, 't2')
    expect(repairCost(tool, ironPickaxe)).toEqual([])
    expect(repairCost(wearTool(tool, 150), ironPickaxe)).toEqual([{ itemId: 'iron_ingot', quantity: 2 }, { itemId: 'coal', quantity: 2 }])
    expect(repairCost(wearTool(tool, 1), ironPickaxe)).toEqual([{ itemId: 'iron_ingot', quantity: 1 }, { itemId: 'coal', quantity: 1 }])
    expect(repairCost(wearTool(createToolInstance(pickaxe, 't3'), 30), pickaxe)).toEqual([{ itemId: 'stone', quantity: 2 }])
  })

  it('shrinks max durability on every repair until the tool wears out', () => {
    let tool = createToolInstance(pickaxe, 't4')
    const maxima: number[] = []
    for (;;) {
      const outcome = repairTool(wearTool(tool, tool.durability), pickaxe)
      if (!outcome.ok) {
        expect(outcome.reason).toBe('worn_out')
        break
      }
      tool = outcome.instance
      maxima.push(tool.maxDurability)
    }
    expect(maxima).toEqual([55, 50, 45, 40, 35, 30])
    expect(toolCondition(wearTool(tool, tool.durability), pickaxe)).toBe('retired')
  })

  it('rejects repairing an undamaged tool', () => {
    expect(repairTool(createToolInstance(pickaxe, 't5'), pickaxe)).toEqual({ ok: false, reason: 'not_damaged' })
  })

  it('reports lifetime durability for balancing', () => {
    expect(lifetimeDurability(pickaxe)).toBe(315)
    expect(lifetimeDurability(ironPickaxe)).toBeGreaterThan(ironPickaxe.maxDurability * 5)
  })
})
