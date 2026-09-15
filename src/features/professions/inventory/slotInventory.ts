// Slot + stack container — the R31-C1 inventory model.
//
// One container shape serves the player inventory now and storage, house
// storage or shop stock later: only `kind`, capacity and stack rules differ.
// Pure: every operation returns a new container and reports what happened,
// and nothing is ever dropped silently (overflow is returned to the caller).

import type { Inventory, ItemId, ItemStack } from '../domain/types'

export type ContainerKind = 'player_inventory' | 'storage' | 'house_storage' | 'shop_stock'

export interface ItemSlot {
  readonly itemId: ItemId
  readonly quantity: number
  /** Set for non-stackable items with identity (tools). */
  readonly instanceId?: string
}

export interface SlotContainer {
  readonly id: string
  readonly kind: ContainerKind
  readonly capacity: number
  readonly slots: readonly (ItemSlot | null)[]
}

export interface StackRules {
  maxStack(itemId: ItemId): number
}

export interface Placement {
  readonly slot: number
  readonly itemId: ItemId
  readonly added: number
  /** The unit(s) needed a slot that was empty. */
  readonly newStack: boolean
  /** The stack reached its max with this addition. */
  readonly filledStack: boolean
}

export interface AddResult {
  readonly container: SlotContainer
  readonly placements: readonly Placement[]
  /** What did not fit. Callers must show or keep it, never discard it. */
  readonly overflow: readonly ItemStack[]
}

export function createContainer(id: string, kind: ContainerKind, capacity: number, slots: readonly (ItemSlot | null)[] = []): SlotContainer {
  const size = Math.max(0, Math.floor(capacity))
  return { id, kind, capacity: size, slots: Array.from({ length: size }, (_, i) => slots[i] ?? null) }
}

export function usedSlots(container: SlotContainer): number {
  return container.slots.filter(Boolean).length
}

export function freeSlots(container: SlotContainer): number {
  return container.capacity - usedSlots(container)
}

export function countItem(container: SlotContainer, itemId: ItemId): number {
  return container.slots.reduce((sum, slot) => sum + (slot?.itemId === itemId ? slot.quantity : 0), 0)
}

/** Totals per item, for recipes and resolvers that read a plain inventory. */
export function containerCounts(container: SlotContainer): Inventory {
  const counts: Record<string, number> = {}
  for (const slot of container.slots) if (slot) counts[slot.itemId] = (counts[slot.itemId] ?? 0) + slot.quantity
  return counts
}

export function addStacks(container: SlotContainer, stacks: readonly ItemStack[], rules: StackRules): AddResult {
  const slots = [...container.slots]
  const placements: Placement[] = []
  const overflow: ItemStack[] = []

  for (const stack of stacks) {
    let remaining = Math.max(0, Math.floor(stack.quantity))
    const max = Math.max(1, Math.floor(rules.maxStack(stack.itemId)))
    // 1. Top up existing stacks of the same item, in slot order.
    for (let i = 0; i < slots.length && remaining > 0; i++) {
      const slot = slots[i]
      if (!slot || slot.itemId !== stack.itemId || slot.instanceId || slot.quantity >= max) continue
      const added = Math.min(remaining, max - slot.quantity)
      slots[i] = { ...slot, quantity: slot.quantity + added }
      remaining -= added
      placements.push({ slot: i, itemId: stack.itemId, added, newStack: false, filledStack: slot.quantity + added === max })
    }
    // 2. Open new stacks in empty slots.
    for (let i = 0; i < slots.length && remaining > 0; i++) {
      if (slots[i]) continue
      const added = Math.min(remaining, max)
      slots[i] = { itemId: stack.itemId, quantity: added }
      remaining -= added
      placements.push({ slot: i, itemId: stack.itemId, added, newStack: true, filledStack: added === max })
    }
    if (remaining > 0) overflow.push({ itemId: stack.itemId, quantity: remaining })
  }
  return { container: { ...container, slots }, placements, overflow }
}

/** A non-stackable item with identity (e.g. a tool). */
export function addInstance(container: SlotContainer, itemId: ItemId, instanceId: string): AddResult {
  const index = container.slots.findIndex(slot => slot === null)
  if (index < 0) return { container, placements: [], overflow: [{ itemId, quantity: 1 }] }
  const slots = [...container.slots]
  slots[index] = { itemId, quantity: 1, instanceId }
  return { container: { ...container, slots }, placements: [{ slot: index, itemId, added: 1, newStack: true, filledStack: true }], overflow: [] }
}

/** True when every unit of `stacks` fits, without changing anything. */
export function canFit(container: SlotContainer, stacks: readonly ItemStack[], rules: StackRules): boolean {
  return addStacks(container, stacks, rules).overflow.length === 0
}

/**
 * Removes quantities, draining the last stacks first so earlier slots stay
 * stable. Returns null (and changes nothing) if anything is missing.
 */
export function removeStacks(container: SlotContainer, stacks: readonly ItemStack[]): SlotContainer | null {
  const slots = [...container.slots]
  for (const stack of stacks) {
    let remaining = stack.quantity
    for (let i = slots.length - 1; i >= 0 && remaining > 0; i--) {
      const slot = slots[i]
      if (!slot || slot.itemId !== stack.itemId || slot.instanceId) continue
      const taken = Math.min(remaining, slot.quantity)
      slots[i] = slot.quantity === taken ? null : { ...slot, quantity: slot.quantity - taken }
      remaining -= taken
    }
    if (remaining > 0) return null
  }
  return { ...container, slots }
}

export function removeSlot(container: SlotContainer, index: number): { container: SlotContainer; removed: ItemSlot | null } {
  const removed = container.slots[index] ?? null
  if (!removed) return { container, removed: null }
  const slots = [...container.slots]
  slots[index] = null
  return { container: { ...container, slots }, removed }
}

/**
 * Moves a whole slot (or part of a stack) between containers — the future
 * inventory ↔ storage operation. All-or-nothing: if the target cannot take
 * everything, neither container changes.
 */
export function transferSlot(
  from: SlotContainer, to: SlotContainer, index: number, quantity: number, rules: StackRules,
): { from: SlotContainer; to: SlotContainer; moved: number } | null {
  const slot = from.slots[index]
  if (!slot) return null
  const amount = Math.min(slot.quantity, Math.max(1, Math.floor(quantity)))
  const added = slot.instanceId ? addInstance(to, slot.itemId, slot.instanceId) : addStacks(to, [{ itemId: slot.itemId, quantity: amount }], rules)
  if (added.overflow.length) return null
  const slots = [...from.slots]
  slots[index] = slot.quantity === amount ? null : { ...slot, quantity: slot.quantity - amount }
  return { from: { ...from, slots }, to: added.container, moved: amount }
}
