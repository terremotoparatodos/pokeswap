import { describe, expect, it } from 'vitest'
import {
  addInstance, addStacks, canFit, containerCounts, countItem, createContainer, freeSlots, removeSlot, removeStacks, transferSlot, usedSlots,
  type StackRules,
} from './slotInventory'
import { DEMO_STACK_CONFIG, stackClassOf, stackRules } from './stackRules'

const rules: StackRules = { maxStack: itemId => (itemId === 'gold_ore' ? 5 : itemId.endsWith('pickaxe') ? 1 : 10) }
const bag = (capacity = 4) => createContainer('bag', 'player_inventory', capacity)

describe('slot inventory stacks', () => {
  it('one item type takes one slot until its stack is full', () => {
    const { container, placements, overflow } = addStacks(bag(), [{ itemId: 'iron_ore', quantity: 7 }], rules)
    expect(usedSlots(container)).toBe(1)
    expect(placements).toEqual([{ slot: 0, itemId: 'iron_ore', added: 7, newStack: true, filledStack: false }])
    expect(overflow).toEqual([])
  })

  it('tops up the existing stack before opening a new one', () => {
    const first = addStacks(bag(), [{ itemId: 'iron_ore', quantity: 7 }], rules).container
    const { container, placements } = addStacks(first, [{ itemId: 'iron_ore', quantity: 5 }], rules)
    expect(container.slots[0]).toEqual({ itemId: 'iron_ore', quantity: 10 })
    expect(container.slots[1]).toEqual({ itemId: 'iron_ore', quantity: 2 })
    expect(placements).toEqual([
      { slot: 0, itemId: 'iron_ore', added: 3, newStack: false, filledStack: true },
      { slot: 1, itemId: 'iron_ore', added: 2, newStack: true, filledStack: false },
    ])
    expect(countItem(container, 'iron_ore')).toBe(12)
  })

  it('returns what does not fit instead of losing it', () => {
    const { container, overflow } = addStacks(bag(2), [{ itemId: 'gold_ore', quantity: 12 }, { itemId: 'coal', quantity: 1 }], rules)
    expect(container.slots).toEqual([{ itemId: 'gold_ore', quantity: 5 }, { itemId: 'gold_ore', quantity: 5 }])
    expect(overflow).toEqual([{ itemId: 'gold_ore', quantity: 2 }, { itemId: 'coal', quantity: 1 }])
    expect(canFit(container, [{ itemId: 'coal', quantity: 1 }], rules)).toBe(false)
  })

  it('still accepts items into a partial stack when no slot is free', () => {
    const full = addStacks(bag(2), [{ itemId: 'coal', quantity: 4 }, { itemId: 'stone', quantity: 10 }], rules).container
    expect(freeSlots(full)).toBe(0)
    expect(canFit(full, [{ itemId: 'coal', quantity: 6 }], rules)).toBe(true)
    expect(canFit(full, [{ itemId: 'coal', quantity: 7 }], rules)).toBe(false)
    expect(canFit(full, [{ itemId: 'stone', quantity: 1 }], rules)).toBe(false)
  })

  it('keeps tools as non-stackable instances', () => {
    let container = addInstance(bag(3), 'iron_pickaxe', 'tool-a').container
    container = addInstance(container, 'iron_pickaxe', 'tool-b').container
    expect(usedSlots(container)).toBe(2)
    expect(container.slots[1]).toEqual({ itemId: 'iron_pickaxe', quantity: 1, instanceId: 'tool-b' })
    expect(addStacks(container, [{ itemId: 'iron_pickaxe', quantity: 1 }], rules).placements[0].slot).toBe(2)
    expect(addInstance(addInstance(container, 'stone_pickaxe', 'c').container, 'x', 'y').overflow).toEqual([{ itemId: 'x', quantity: 1 }])
  })

  it('removes from the last stacks first and refuses partial removal', () => {
    const container = addStacks(bag(), [{ itemId: 'iron_ore', quantity: 15 }], rules).container
    const after = removeStacks(container, [{ itemId: 'iron_ore', quantity: 6 }])!
    expect(after.slots.slice(0, 2)).toEqual([{ itemId: 'iron_ore', quantity: 9 }, null])
    expect(removeStacks(container, [{ itemId: 'iron_ore', quantity: 16 }])).toBeNull()
    expect(containerCounts(after)).toEqual({ iron_ore: 9 })
    expect(removeSlot(after, 0).removed).toEqual({ itemId: 'iron_ore', quantity: 9 })
  })

  it('transfers between containers all-or-nothing (future storage)', () => {
    const inventory = addStacks(bag(), [{ itemId: 'coal', quantity: 8 }], rules).container
    const chest = createContainer('chest', 'storage', 1)
    const moved = transferSlot(inventory, chest, 0, 5, rules)!
    expect(moved.moved).toBe(5)
    expect(moved.from.slots[0]).toEqual({ itemId: 'coal', quantity: 3 })
    expect(moved.to.slots[0]).toEqual({ itemId: 'coal', quantity: 5 })
    const fullChest = addStacks(chest, [{ itemId: 'stone', quantity: 1 }], rules).container
    expect(transferSlot(inventory, fullChest, 0, 5, rules)).toBeNull()
  })
})

describe('demo stack rules', () => {
  it('classifies items and never stacks tools', () => {
    const demo = stackRules()
    expect(stackClassOf('stone')).toBe('basic')
    expect(stackClassOf('iron_ore')).toBe('uncommon')
    expect(stackClassOf('gold_ore')).toBe('rare')
    expect(stackClassOf('evolution_shard')).toBe('rare')
    expect(stackClassOf('iron_ingot')).toBe('refined')
    expect(stackClassOf('potion')).toBe('consumable')
    expect(demo.maxStack('iron_pickaxe')).toBe(1)
    expect(demo.maxStack('stone')).toBe(DEMO_STACK_CONFIG.basic)
    expect(stackRules({ ...DEMO_STACK_CONFIG, rare: 3 }).maxStack('gold_ore')).toBe(3)
  })
})
