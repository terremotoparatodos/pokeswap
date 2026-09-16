// Immutable inventory arithmetic shared by processing, repair and the simulator.

import type { Inventory, ItemStack } from './types'

/** A real amount of items: a whole number above zero (NaN, infinities, fractions and negatives are not). */
export function isWholePositive(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

/** Throws on an amount no resolver can produce; adding must never invent or silently drop units. */
export function assertWholePositive(value: number, what: string): void {
  if (!isWholePositive(value)) throw new RangeError(`${what} must be a whole number above zero, got ${value}`)
}

export function hasItems(inventory: Inventory, stacks: readonly ItemStack[], multiplier = 1): boolean {
  if (!isWholePositive(multiplier)) return false
  return mergeStacks(stacks).every(stack => isWholePositive(stack.quantity) && (inventory[stack.itemId] ?? 0) >= stack.quantity * multiplier)
}

export function addItems(inventory: Inventory, stacks: readonly ItemStack[], multiplier = 1): Inventory {
  assertWholePositive(multiplier, 'multiplier')
  const next: Record<string, number> = { ...inventory }
  for (const stack of stacks) {
    assertWholePositive(stack.quantity, `quantity of ${stack.itemId}`)
    next[stack.itemId] = (next[stack.itemId] ?? 0) + stack.quantity * multiplier
  }
  return next
}

/** Returns null instead of going negative, so callers cannot silently overdraw. */
export function removeItems(inventory: Inventory, stacks: readonly ItemStack[], multiplier = 1): Inventory | null {
  if (!hasItems(inventory, stacks, multiplier)) return null
  const next: Record<string, number> = { ...inventory }
  for (const stack of stacks) next[stack.itemId] -= stack.quantity * multiplier
  return next
}

/** Sums duplicate item ids, preserving first-seen order. */
export function mergeStacks(stacks: readonly ItemStack[]): ItemStack[] {
  const totals = new Map<string, number>()
  for (const stack of stacks) totals.set(stack.itemId, (totals.get(stack.itemId) ?? 0) + stack.quantity)
  return [...totals].map(([itemId, quantity]) => ({ itemId, quantity }))
}
