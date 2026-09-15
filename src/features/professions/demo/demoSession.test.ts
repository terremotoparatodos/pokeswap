import { describe, expect, it } from 'vitest'
import { NODE_BY_ID } from '../domain/catalog/nodes'
import {
  craftDemo, createDemoState, demoLevel, demoNodeStatus, demoTool, depleteDemoNode, equipDemoTool, gatherDemo, inspectDemoNode,
  itemCount, repairDemoTool, setDemoDurability, setDemoEnergy, setDemoInventory, setDemoLevel, setDemoWorker, syncDemoClock,
  type DemoNodeTarget,
} from './demoSession'

const T0 = Date.UTC(2026, 8, 15, 12)
const iron: DemoNodeTarget = { nodeId: 'pradera:10:4:iron_vein', node: NODE_BY_ID.get('iron_vein')!, biome: 'desert' }
const crystal: DemoNodeTarget = { nodeId: 'pradera:3:3:crystal_cluster', node: NODE_BY_ID.get('crystal_cluster')!, biome: 'desert' }

describe('demo gathering', () => {
  it('applies energy, XP, wear and items from the real resolver', () => {
    const state = createDemoState(T0)
    const outcome = gatherDemo(state, iron)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const { result, state: next } = outcome
    expect(next.energy.current).toBeCloseTo(state.energy.current - result.energySpent)
    expect(next.xp.mining).toBe(state.xp.mining + result.xp)
    expect(demoTool(next, 'mining')!.instance.durability).toBe(demoTool(state, 'mining')!.instance.durability - result.durabilityLoss)
    expect(next.inventory.iron_ore).toBeGreaterThan(state.inventory.iron_ore)
    expect(inspectDemoNode(next, iron).remainingCharges).toBe(iron.node.personalCharges - 1)
  })

  it('is deterministic for the same state', () => {
    const state = createDemoState(T0)
    expect(gatherDemo(state, iron)).toEqual(gatherDemo(state, iron))
  })

  it('depletes a node per player and recovers after respawn', () => {
    const depleted = depleteDemoNode(createDemoState(T0), iron)
    expect(demoNodeStatus(depleted, iron)).toBe('depleted')
    expect(inspectDemoNode(depleted, iron).respawnInSeconds).toBe(iron.node.respawnSeconds)
    expect(demoNodeStatus(syncDemoClock(depleted, T0 + iron.node.respawnSeconds * 1000), iron)).toBe('available')
  })

  it.each([
    ['locked_level', (s: ReturnType<typeof createDemoState>) => setDemoLevel(s, 'mining', 10), iron],
    ['no_energy', (s: ReturnType<typeof createDemoState>) => setDemoEnergy(s, 5), iron],
    ['tool_broken', (s: ReturnType<typeof createDemoState>) => setDemoDurability(s, 'pickaxe', 0), iron],
    ['no_tool', (s: ReturnType<typeof createDemoState>) => equipDemoTool(s, 'pickaxe', null), iron],
    ['inventory_full', (s: ReturnType<typeof createDemoState>) => setDemoInventory(s, { stone: s.capacity }), iron],
    ['locked_access', (s: ReturnType<typeof createDemoState>) => setDemoWorker(setDemoLevel(s, 'mining', 25), 'mining', 81), crystal],
  ] as const)('blocks with %s without changing state', (status, prepare, target) => {
    const state = prepare(createDemoState(T0))
    expect(gatherDemo(state, target)).toEqual({ ok: false, state, status })
  })

  it('opens access through the Pokémon, not a hardcoded unlock', () => {
    const state = setDemoWorker(setDemoLevel(createDemoState(T0), 'mining', 25), 'mining', 68)
    expect(demoNodeStatus(state, crystal)).toBe('available')
  })
})

describe('demo crafting and repair', () => {
  it('crafts a potion with real recipe inputs', () => {
    const state = createDemoState(T0)
    const outcome = craftDemo(state, 'brew_potion', 2)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.state.inventory).toMatchObject({ oran_berry: state.inventory.oran_berry - 4, vial: 0, potion: 2 })
    expect(outcome.state.xp.alchemy).toBeGreaterThan(state.xp.alchemy)
  })

  it('rejects missing inputs, locked recipes and unknown ids', () => {
    const state = createDemoState(T0)
    expect(craftDemo(state, 'brew_potion', 3)).toMatchObject({ ok: false, reason: 'missing_inputs' })
    expect(craftDemo(state, 'brew_hyper_potion', 1)).toMatchObject({ ok: false, reason: 'level_too_low' })
    expect(craftDemo(state, 'nope', 1)).toMatchObject({ ok: false, reason: 'unknown_recipe' })
  })

  it('repairs with local materials or explains what is missing', () => {
    const state = createDemoState(T0)
    expect(repairDemoTool(state, 'mining')).toMatchObject({ ok: false, reason: 'missing_materials' })
    const stocked = setDemoInventory(state, { ...state.inventory, iron_ingot: 5, coal: 5 })
    const repaired = repairDemoTool(stocked, 'mining')
    expect(repaired.ok).toBe(true)
    if (!repaired.ok) return
    const tool = demoTool(repaired.state, 'mining')!.instance
    expect(tool.durability).toBe(tool.maxDurability)
    expect(itemCount(repaired.state.inventory)).toBeLessThan(itemCount(stocked.inventory))
    expect(repairDemoTool(repaired.state, 'mining')).toMatchObject({ ok: false, reason: 'not_damaged' })
  })

  it('keeps level controls on the real XP curve', () => {
    expect(demoLevel(setDemoLevel(createDemoState(T0), 'fishing', 33), 'fishing')).toBe(33)
  })
})
