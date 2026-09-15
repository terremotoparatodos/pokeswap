// Shared stock pool used by the simulator as a proxy for the player market.
// Tracks where every unit came from (faucets) and where it went (sinks).

import { RECIPES } from '../domain/catalog/recipes'
import { mergeStacks } from '../domain/inventory'
import type { ItemId, ItemStack, RecipeDefinition } from '../domain/types'

export type FlowSource = 'gathered' | 'pveDropped' | 'crafted'
export type FlowSink = 'craftingInput' | 'equipped' | 'repair' | 'maintenance' | 'consumption'

export type ItemFlow = Record<FlowSource | FlowSink | 'shortage', number>

const MAX_CRAFT_DEPTH = 6

const emptyFlow = (): ItemFlow => ({
  gathered: 0, pveDropped: 0, crafted: 0, craftingInput: 0, equipped: 0, repair: 0, maintenance: 0, consumption: 0, shortage: 0,
})

export class EconomyLedger {
  private readonly stock = new Map<ItemId, number>()
  private readonly flows = new Map<ItemId, ItemFlow>()
  private readonly recipesByOutput = new Map<ItemId, RecipeDefinition[]>()

  constructor(recipes: readonly RecipeDefinition[] = RECIPES) {
    for (const recipe of [...recipes].sort((a, b) => a.requiredLevel - b.requiredLevel)) {
      for (const output of recipe.outputs) {
        this.recipesByOutput.set(output.itemId, [...(this.recipesByOutput.get(output.itemId) ?? []), recipe])
      }
    }
  }

  stockOf(itemId: ItemId): number {
    return this.stock.get(itemId) ?? 0
  }

  private flow(itemId: ItemId): ItemFlow {
    let flow = this.flows.get(itemId)
    if (!flow) this.flows.set(itemId, (flow = emptyFlow()))
    return flow
  }

  add(itemId: ItemId, quantity: number, source: FlowSource): void {
    if (quantity <= 0) return
    this.stock.set(itemId, this.stockOf(itemId) + quantity)
    this.flow(itemId)[source] += quantity
  }

  /** All-or-nothing removal of already-stocked items. */
  private take(stacks: readonly ItemStack[], sink: FlowSink, multiplier = 1): boolean {
    const merged = mergeStacks(stacks)
    if (!merged.every(stack => this.stockOf(stack.itemId) >= stack.quantity * multiplier)) return false
    for (const stack of merged) {
      this.stock.set(stack.itemId, this.stockOf(stack.itemId) - stack.quantity * multiplier)
      this.flow(stack.itemId)[sink] += stack.quantity * multiplier
    }
    return true
  }

  /**
   * Makes `quantity` units available, crafting missing ones from stock through
   * recipes (recursively). Crafted intermediates stay in stock if a later input
   * is missing. Crafter levels are assumed available — the simulator models
   * material flow, not who crafts.
   */
  ensure(itemId: ItemId, quantity: number, depth = 0): boolean {
    if (this.stockOf(itemId) >= quantity) return true
    if (depth >= MAX_CRAFT_DEPTH) return false
    for (const recipe of this.recipesByOutput.get(itemId) ?? []) {
      const missing = quantity - this.stockOf(itemId)
      if (missing <= 0) break
      const perBatch = recipe.outputs.find(output => output.itemId === itemId)!.quantity
      const batches = Math.ceil(missing / perBatch)
      if (!recipe.inputs.every(input => this.ensure(input.itemId, input.quantity * batches, depth + 1))) continue
      if (!this.take(recipe.inputs, 'craftingInput', batches)) continue
      for (const output of recipe.outputs) this.add(output.itemId, output.quantity * batches, 'crafted')
    }
    return this.stockOf(itemId) >= quantity
  }

  /** Crafts what it can, removes all-or-nothing, and records shortage on failure. */
  acquire(stacks: readonly ItemStack[], sink: FlowSink): boolean {
    const merged = mergeStacks(stacks)
    const available = merged.every(stack => this.ensure(stack.itemId, stack.quantity)) && this.take(merged, sink)
    if (!available) {
      for (const stack of merged) this.flow(stack.itemId).shortage += Math.max(0, stack.quantity - this.stockOf(stack.itemId))
    }
    return available
  }

  /** Partial consumption for demand: uses what exists, records the rest as shortage. */
  consume(itemId: ItemId, quantity: number, sink: FlowSink): number {
    if (quantity <= 0) return 0
    this.ensure(itemId, quantity)
    const used = Math.min(this.stockOf(itemId), quantity)
    if (used > 0) this.take([{ itemId, quantity: used }], sink)
    this.flow(itemId).shortage += quantity - used
    return used
  }

  snapshot(): Record<ItemId, ItemFlow & { endStock: number }> {
    const result: Record<ItemId, ItemFlow & { endStock: number }> = {}
    for (const itemId of [...new Set([...this.flows.keys(), ...this.stock.keys()])].sort()) {
      result[itemId] = { ...(this.flows.get(itemId) ?? emptyFlow()), endStock: this.stockOf(itemId) }
    }
    return result
  }
}
