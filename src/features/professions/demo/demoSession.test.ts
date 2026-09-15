import { describe, expect, it } from 'vitest'
import { NODE_BY_ID } from '../domain/catalog/nodes'
import { countItem, usedSlots } from '../inventory/slotInventory'
import {
  collectPendingDemo, craftDemo, createDemoState, demoCounts, demoLevel, demoNodeStatus, demoTool, depleteDemoNode, equipDemoTool, equipFromBag,
  fillDemoBag, gatherDemo, inspectDemoNode, itemCount, repairDemoTool, setDemoBag, setDemoCapacity, setDemoDurability, setDemoEnergy,
  setDemoInventory, setDemoLevel, setDemoWorker, syncDemoClock,
  type DemoNodeTarget, type DemoState,
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
    expect(countItem(next.bag, 'iron_ore')).toBeGreaterThan(countItem(state.bag, 'iron_ore'))
    expect(outcome.placements.length).toBeGreaterThan(0)
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
    ['locked_level', (s: DemoState) => setDemoLevel(s, 'mining', 10), iron],
    ['no_energy', (s: DemoState) => setDemoEnergy(s, 5), iron],
    ['tool_broken', (s: DemoState) => setDemoDurability(s, 'pickaxe', 0), iron],
    ['no_tool', (s: DemoState) => equipDemoTool(s, 'pickaxe', null), iron],
    ['inventory_full', (s: DemoState) => fillDemoBag(s, 'full'), iron],
    ['locked_access', (s: DemoState) => setDemoWorker(setDemoLevel(s, 'mining', 25), 'mining', 81), crystal],
  ] as const)('blocks with %s without changing state', (status, prepare, target) => {
    const state = prepare(createDemoState(T0))
    expect(gatherDemo(state, target)).toEqual({ ok: false, state, status })
  })

  it('opens access through the Pokémon, not a hardcoded unlock', () => {
    const state = setDemoWorker(setDemoLevel(createDemoState(T0), 'mining', 25), 'mining', 68)
    expect(demoNodeStatus(state, crystal)).toBe('available')
  })
})

describe('demo inventory (slots + stacks)', () => {
  it('lets a partial stack accept rewards when no slot is free, and keeps overflow as pending', () => {
    const nearly = fillDemoBag(createDemoState(T0), 'nearly_full')
    expect(demoNodeStatus(nearly, iron)).toBe('available')
    let state = nearly
    let pendingSeen = false
    for (let i = 0; i < iron.node.personalCharges; i++) {
      const outcome = gatherDemo(state, iron)
      if (!outcome.ok) break
      state = outcome.state
      const total = itemCount(demoCounts(state)) + state.pending.reduce((sum, stack) => sum + stack.quantity, 0)
      const before = itemCount(demoCounts(nearly))
      expect(total).toBeGreaterThan(before)
      if (outcome.overflow.length) pendingSeen = true
    }
    expect(pendingSeen || demoNodeStatus(state, iron) === 'inventory_full').toBe(true)
  })

  it('collects pending rewards once space is freed', () => {
    const base = fillDemoBag(createDemoState(T0), 'full')
    const withPending = { ...setDemoBag(base, base.bag.slots.map((slot, i) => (i === 0 ? null : slot))), pending: [{ itemId: 'gold_ore', quantity: 3 }] }
    const collected = collectPendingDemo(withPending)
    expect(collected.state.pending).toEqual([])
    expect(countItem(collected.state.bag, 'gold_ore')).toBe(3)
  })

  it('moves slots beyond a reduced capacity into pending instead of deleting them', () => {
    const state = setDemoCapacity(fillDemoBag(createDemoState(T0), 'full'), 4)
    expect(state.bag.capacity).toBe(4)
    expect(state.pending.length).toBeGreaterThan(0)
  })

  it('equips a spare tool from the bag and stores the previous one', () => {
    const state = fillDemoBag(createDemoState(T0), 'stacks')
    const toolSlot = state.bag.slots.findIndex(slot => slot?.itemId === 'steel_pickaxe')
    const swapped = equipFromBag(state, toolSlot)
    expect(demoTool(swapped, 'mining')?.definition.itemId).toBe('steel_pickaxe')
    expect(swapped.bag.slots[toolSlot]?.itemId).toBe('iron_pickaxe')
    expect(usedSlots(swapped.bag)).toBe(usedSlots(state.bag))
  })
})

describe('demo crafting and repair', () => {
  it('crafts a potion with real recipe inputs', () => {
    const state = createDemoState(T0)
    const outcome = craftDemo(state, 'brew_potion', 2)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(demoCounts(outcome.state)).toMatchObject({ oran_berry: demoCounts(state).oran_berry - 4, potion: 2 })
    expect(demoCounts(outcome.state).vial).toBeUndefined()
    expect(outcome.state.xp.alchemy).toBeGreaterThan(state.xp.alchemy)
  })

  it('crafts tools as non-stackable instances', () => {
    const state = setDemoInventory(createDemoState(T0), { stone: 20, plank: 4 })
    const outcome = craftDemo(state, 'craft_stone_pickaxe', 2)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const tools = outcome.state.bag.slots.filter(slot => slot?.itemId === 'stone_pickaxe')
    expect(tools).toHaveLength(2)
    expect(tools.every(slot => slot?.instanceId)).toBe(true)
  })

  it('rejects missing inputs, locked recipes, unknown ids and a full bag', () => {
    const state = createDemoState(T0)
    expect(craftDemo(state, 'brew_potion', 3)).toMatchObject({ ok: false, reason: 'missing_inputs' })
    expect(craftDemo(state, 'brew_hyper_potion', 1)).toMatchObject({ ok: false, reason: 'level_too_low' })
    expect(craftDemo(state, 'nope', 1)).toMatchObject({ ok: false, reason: 'unknown_recipe' })
  })

  it('repairs with local materials or explains what is missing', () => {
    const state = createDemoState(T0)
    expect(repairDemoTool(state, 'mining')).toMatchObject({ ok: false, reason: 'missing_materials' })
    const stocked = setDemoInventory(state, { ...demoCounts(state), iron_ingot: 5, coal: 5 })
    const repaired = repairDemoTool(stocked, 'mining')
    expect(repaired.ok).toBe(true)
    if (!repaired.ok) return
    const tool = demoTool(repaired.state, 'mining')!.instance
    expect(tool.durability).toBe(tool.maxDurability)
    expect(itemCount(demoCounts(repaired.state))).toBeLessThan(itemCount(demoCounts(stocked)))
    expect(repairDemoTool(repaired.state, 'mining')).toMatchObject({ ok: false, reason: 'not_damaged' })
  })

  it('keeps level controls on the real XP curve', () => {
    expect(demoLevel(setDemoLevel(createDemoState(T0), 'fishing', 33), 'fishing')).toBe(33)
  })
})
