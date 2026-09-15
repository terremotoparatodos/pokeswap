// Tool, structure and consumable catalogs.
//
// Tools break into an unusable-but-repairable state; each repair shaves the
// max durability until the tool retires (ENERGY_DURABILITY.md §Durabilidad).

import type { ConsumableDefinition, ItemStack, StructureDefinition, Tier, ToolDefinition, ToolKind } from '../types'

const stack = (itemId: string, quantity: number): ItemStack => ({ itemId, quantity })

const TIER_STATS: Readonly<Record<Tier, { requiredLevel: number; maxDurability: number; speedMultiplier: number; yieldBonus: number }>> = {
  1: { requiredLevel: 1, maxDurability: 60, speedMultiplier: 1, yieldBonus: 0 },
  2: { requiredLevel: 15, maxDurability: 150, speedMultiplier: 0.85, yieldBonus: 0.05 },
  3: { requiredLevel: 35, maxDurability: 300, speedMultiplier: 0.72, yieldBonus: 0.1 },
}

/** Action-time multiplier when a node allows bare hands and no tool is equipped. */
export const BARE_HANDS_SPEED_MULTIPLIER = 1.5

function tool(itemId: string, kind: ToolKind, tier: Tier, repairMaterials: ItemStack[]): ToolDefinition {
  return { itemId, kind, tier, ...TIER_STATS[tier], repairMaterials, maxDurabilityLossPerRepair: 0.08, retireBelowRatio: 0.5 }
}

export const TOOLS: readonly ToolDefinition[] = [
  tool('stone_pickaxe', 'pickaxe', 1, [stack('stone', 3)]),
  tool('iron_pickaxe', 'pickaxe', 2, [stack('iron_ingot', 2), stack('coal', 2)]),
  tool('steel_pickaxe', 'pickaxe', 3, [stack('steel_ingot', 2), stack('coal', 3)]),
  tool('stone_axe', 'axe', 1, [stack('stone', 3)]),
  tool('iron_axe', 'axe', 2, [stack('iron_ingot', 2), stack('coal', 2)]),
  tool('steel_axe', 'axe', 3, [stack('steel_ingot', 2), stack('coal', 3)]),
  tool('stone_sickle', 'sickle', 1, [stack('stone', 2)]),
  tool('iron_sickle', 'sickle', 2, [stack('iron_ingot', 2), stack('coal', 1)]),
  tool('steel_sickle', 'sickle', 3, [stack('steel_ingot', 2), stack('coal', 2)]),
  tool('basic_rod', 'rod', 1, [stack('resin', 2), stack('plank', 1)]),
  tool('reinforced_rod', 'rod', 2, [stack('iron_ingot', 1), stack('resin', 2)]),
  tool('master_rod', 'rod', 3, [stack('steel_ingot', 1), stack('resin', 2)]),
]

export const TOOL_BY_ID: ReadonlyMap<string, ToolDefinition> = new Map(TOOLS.map(entry => [entry.itemId, entry]))

export const STRUCTURES: readonly StructureDefinition[] = [
  {
    itemId: 'workbench', station: 'workbench', maxCondition: 100, decayPerActiveDay: 2,
    maintenance: [stack('plank', 2)], restoresCondition: 50, effects: { processingSpeed: 0.1 },
  },
  {
    itemId: 'campfire', station: 'campfire', maxCondition: 100, decayPerActiveDay: 10,
    maintenance: [stack('common_log', 3)], restoresCondition: 50, effects: { energyRegenBonus: 0.1 },
  },
  {
    itemId: 'smelter', station: 'smelter', maxCondition: 100, decayPerActiveDay: 3,
    maintenance: [stack('stone_brick', 2), stack('coal', 2)], restoresCondition: 50, effects: { processingSpeed: 0.15 },
  },
  {
    itemId: 'alchemy_table', station: 'alchemyTable', maxCondition: 100, decayPerActiveDay: 2,
    maintenance: [stack('hardwood_plank', 1), stack('vial', 1)], restoresCondition: 50, effects: { processingSpeed: 0.15 },
  },
]

/** Public town stations: always available, no maintenance, slower. */
export const PUBLIC_STATION_TIME_MULTIPLIER = 1.5

export const CONSUMABLES: readonly ConsumableDefinition[] = [
  { itemId: 'potion', effect: 'heal', value: 20, context: 'pve' },
  { itemId: 'super_potion', effect: 'heal', value: 50, context: 'pve' },
  { itemId: 'hyper_potion', effect: 'heal', value: 120, context: 'pve' },
  { itemId: 'revive', effect: 'revive', value: 50, context: 'pve' },
  { itemId: 'ether', effect: 'restorePp', value: 10, context: 'pve' },
  { itemId: 'vigor_tea', effect: 'restoreEnergy', value: 120, context: 'gathering' },
]
