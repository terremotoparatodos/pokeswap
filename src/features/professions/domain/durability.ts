// Tool durability and repair.
//
// A tool at 0 durability is broken, not destroyed: it keeps its identity and
// can be repaired. Each repair lowers max durability, so every tool still
// retires eventually and material demand never stops.

import type { ItemStack, ToolCondition, ToolDefinition, ToolInstance } from './types'

export function createToolInstance(definition: ToolDefinition, instanceId: string): ToolInstance {
  return { instanceId, itemId: definition.itemId, durability: definition.maxDurability, maxDurability: definition.maxDurability, repairs: 0 }
}

function maxAfterRepair(instance: ToolInstance, definition: ToolDefinition): number {
  return Math.round(instance.maxDurability - definition.maxDurability * definition.maxDurabilityLossPerRepair)
}

export function canBeRepaired(instance: ToolInstance, definition: ToolDefinition): boolean {
  return maxAfterRepair(instance, definition) >= definition.maxDurability * definition.retireBelowRatio
}

export function toolCondition(instance: ToolInstance, definition: ToolDefinition): ToolCondition {
  if (instance.durability > 0) return 'ok'
  return canBeRepaired(instance, definition) ? 'broken' : 'retired'
}

export function wearTool(instance: ToolInstance, loss: number): ToolInstance {
  return { ...instance, durability: Math.max(0, instance.durability - Math.max(0, loss)) }
}

/** Materials proportional to missing durability; at least 1 of each when anything is missing. */
export function repairCost(instance: ToolInstance, definition: ToolDefinition): ItemStack[] {
  const missing = instance.maxDurability - instance.durability
  if (missing <= 0) return []
  const fraction = missing / definition.maxDurability
  return definition.repairMaterials.map(material => ({
    itemId: material.itemId,
    quantity: Math.max(1, Math.ceil(material.quantity * fraction)),
  }))
}

export type RepairOutcome =
  | { readonly ok: true; readonly instance: ToolInstance; readonly cost: readonly ItemStack[] }
  | { readonly ok: false; readonly reason: 'not_damaged' | 'worn_out' }

/** Pure: the caller removes `cost` from inventory atomically with persisting `instance`. */
export function repairTool(instance: ToolInstance, definition: ToolDefinition): RepairOutcome {
  if (instance.durability >= instance.maxDurability) return { ok: false, reason: 'not_damaged' }
  if (!canBeRepaired(instance, definition)) return { ok: false, reason: 'worn_out' }
  const maxDurability = maxAfterRepair(instance, definition)
  return {
    ok: true,
    cost: repairCost(instance, definition),
    instance: { ...instance, maxDurability, durability: maxDurability, repairs: instance.repairs + 1 },
  }
}

/** Total durability a tool delivers from crafting until it retires (for balance and the simulator). */
export function lifetimeDurability(definition: ToolDefinition): number {
  let instance = createToolInstance(definition, 'lifetime')
  let total = 0
  for (;;) {
    total += instance.durability
    const repaired = repairTool(wearTool(instance, instance.durability), definition)
    if (!repaired.ok) return total
    instance = repaired.instance
  }
}
