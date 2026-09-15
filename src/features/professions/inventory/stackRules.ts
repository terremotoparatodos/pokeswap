// Demo stack rules for the R31-C1 inventory prototype.
//
// DEMO VALUES — not economic rules. They only exist so the UI can show
// stacks filling up, new stacks opening and the inventory running out.
// Final numbers belong to R31-C2 (INVENTORY_DESIGN.md §Pendientes).

import { ITEM_BY_ID } from '../domain/catalog/items'
import type { ItemId } from '../domain/types'
import type { StackRules } from './slotInventory'

export type StackClass = 'basic' | 'uncommon' | 'rare' | 'refined' | 'consumable' | 'unique'

export interface StackConfig {
  readonly basic: number
  readonly uncommon: number
  readonly rare: number
  readonly refined: number
  readonly consumable: number
}

export const DEMO_STACK_CONFIG: StackConfig = { basic: 100, uncommon: 60, rare: 20, refined: 50, consumable: 25 }

/** Within the 24–30 range requested for the prototype; configurable in the playground. */
export const DEMO_INVENTORY_SLOTS = 24

export function stackClassOf(itemId: ItemId): StackClass {
  const item = ITEM_BY_ID.get(itemId)
  if (!item) return 'basic'
  if (item.kind === 'tool' || item.kind === 'structure') return 'unique'
  if (item.kind === 'consumable') return 'consumable'
  if (item.kind === 'refined') return 'refined'
  if (item.tags.includes('rare') || item.tier === 3) return 'rare'
  return item.tier === 2 ? 'uncommon' : 'basic'
}

export function stackRules(config: StackConfig = DEMO_STACK_CONFIG): StackRules {
  return {
    maxStack(itemId) {
      const cls = stackClassOf(itemId)
      return cls === 'unique' ? 1 : config[cls]
    },
  }
}
