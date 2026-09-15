// Structural checks that keep the economy connected as the catalog grows:
// every reference resolves, every raw resource has a faucet, every material
// has a sink (or an explicitly reserved one), every tool/consumable/structure
// can be made.

import { SPECIES_OVERRIDES } from './catalog/affinityProfiles'
import { ITEM_BY_ID, ITEMS, PVE_DROP_ITEMS, RESERVED_SINKS } from './catalog/items'
import { GATHERING_NODES } from './catalog/nodes'
import { MAX_PROFESSION_LEVEL, PROFESSIONS } from './catalog/professions'
import { RECIPES } from './catalog/recipes'
import { CONSUMABLES, STRUCTURES, TOOLS } from './catalog/tools'
import { SPECIES_BASE_STATS } from './catalog/speciesBaseStats'
import { PROFESSION_IDS, type ItemStack } from './types'

export const MAX_SPECIES_OVERRIDES = 25

function duplicates(ids: readonly string[]): string[] {
  return ids.filter((id, index) => ids.indexOf(id) !== index)
}

export function validateCatalog(): string[] {
  const issues: string[] = []
  const requireItem = (itemId: string, where: string) => {
    if (!ITEM_BY_ID.has(itemId)) issues.push(`${where}: unknown item "${itemId}"`)
  }
  const requireStacks = (stacks: readonly ItemStack[], where: string) => stacks.forEach(stack => {
    requireItem(stack.itemId, where)
    if (!Number.isInteger(stack.quantity) || stack.quantity < 1) issues.push(`${where}: invalid quantity for "${stack.itemId}"`)
  })
  const requireLevel = (level: number, where: string) => {
    if (!Number.isInteger(level) || level < 1 || level > MAX_PROFESSION_LEVEL) issues.push(`${where}: level ${level} out of range`)
  }

  for (const id of duplicates(ITEMS.map(entry => entry.id))) issues.push(`duplicate item "${id}"`)
  for (const id of duplicates(GATHERING_NODES.map(entry => entry.id))) issues.push(`duplicate node "${id}"`)
  for (const id of duplicates(RECIPES.map(entry => entry.id))) issues.push(`duplicate recipe "${id}"`)

  for (const node of GATHERING_NODES) {
    requireLevel(node.requiredLevel, `node ${node.id}`)
    for (const entry of [node.drops.primary, ...node.drops.secondary]) {
      requireItem(entry.itemId, `node ${node.id}`)
      if (entry.chance <= 0 || entry.chance > 1 || entry.min < 1 || entry.max < entry.min) issues.push(`node ${node.id}: invalid drop "${entry.itemId}"`)
    }
    if (node.drops.primary.chance !== 1) issues.push(`node ${node.id}: primary drop must be guaranteed`)
    if (node.personalCharges < 1 || node.respawnSeconds <= 0 || node.energyCost <= 0) issues.push(`node ${node.id}: invalid pacing`)
  }
  for (const recipe of RECIPES) {
    requireLevel(recipe.requiredLevel, `recipe ${recipe.id}`)
    requireStacks(recipe.inputs, `recipe ${recipe.id}`)
    requireStacks(recipe.outputs, `recipe ${recipe.id}`)
    const outputs = new Set(recipe.outputs.map(stack => stack.itemId))
    if (recipe.inputs.some(stack => outputs.has(stack.itemId))) issues.push(`recipe ${recipe.id}: consumes its own output`)
  }
  for (const tool of TOOLS) {
    requireItem(tool.itemId, `tool ${tool.itemId}`)
    requireStacks(tool.repairMaterials, `tool ${tool.itemId} repair`)
    requireLevel(tool.requiredLevel, `tool ${tool.itemId}`)
  }
  for (const structure of STRUCTURES) {
    requireItem(structure.itemId, `structure ${structure.itemId}`)
    requireStacks(structure.maintenance, `structure ${structure.itemId} maintenance`)
  }
  for (const consumable of CONSUMABLES) requireItem(consumable.itemId, `consumable ${consumable.itemId}`)

  const faucets = new Set([...GATHERING_NODES.flatMap(node => [node.drops.primary, ...node.drops.secondary].map(entry => entry.itemId)), ...PVE_DROP_ITEMS])
  const produced = new Set(RECIPES.flatMap(recipe => recipe.outputs.map(stack => stack.itemId)))
  const sinks = new Set([
    ...RECIPES.flatMap(recipe => recipe.inputs.map(stack => stack.itemId)),
    ...TOOLS.flatMap(tool => tool.repairMaterials.map(stack => stack.itemId)),
    ...STRUCTURES.flatMap(structure => structure.maintenance.map(stack => stack.itemId)),
  ])

  for (const entry of ITEMS) {
    if (entry.kind === 'raw' && !faucets.has(entry.id)) issues.push(`raw item "${entry.id}" has no faucet`)
    if (entry.kind !== 'raw' && !produced.has(entry.id)) issues.push(`item "${entry.id}" has no recipe`)
    if ((entry.kind === 'raw' || entry.kind === 'refined') && !sinks.has(entry.id) && !RESERVED_SINKS[entry.id]) {
      issues.push(`material "${entry.id}" has no sink`)
    }
  }
  if (TOOLS.length !== new Set(TOOLS.map(tool => tool.itemId)).size) issues.push('duplicate tool definition')
  for (const profession of PROFESSION_IDS) {
    const tiers = TOOLS.filter(tool => tool.kind === PROFESSIONS[profession].toolKind).map(tool => tool.tier).sort()
    if (tiers.join() !== '1,2,3') issues.push(`profession ${profession}: tool tiers must be 1,2,3`)
  }

  if (SPECIES_OVERRIDES.length > MAX_SPECIES_OVERRIDES) issues.push(`too many species overrides (${SPECIES_OVERRIDES.length})`)
  for (const override of SPECIES_OVERRIDES) {
    if (!SPECIES_BASE_STATS[override.speciesId]) issues.push(`override for unknown species ${override.speciesId}`)
    if (!override.reason.trim()) issues.push(`override ${override.speciesId} needs a reason`)
  }
  return issues
}
