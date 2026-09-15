// Feedback hierarchy for mining results: how loud a drop should feel.
// COMMON → UNCOMMON → RARE → SPECIAL changes particles, glint, label colour and
// how long the reward lingers — never a different cinematic.

import { ITEM_BY_ID } from '../domain/catalog/items'
import type { GatheringResult } from '../domain/types'

export type DropRarity = 'common' | 'uncommon' | 'rare' | 'special'

export const RARITY_ORDER: readonly DropRarity[] = ['common', 'uncommon', 'rare', 'special']

/** Explicit mining mapping; other items fall back to their catalog tier and tags. */
export const MINING_ITEM_RARITY: Readonly<Record<string, DropRarity>> = {
  stone: 'common', coal: 'common', iron_ore: 'uncommon', gold_ore: 'rare', evolution_shard: 'special',
}

export function rarityOfItem(itemId: string): DropRarity {
  const explicit = MINING_ITEM_RARITY[itemId]
  if (explicit) return explicit
  const item = ITEM_BY_ID.get(itemId)
  if (!item) return 'common'
  if (item.tags.includes('rare')) return 'special'
  return item.tier === 3 ? 'rare' : item.tier === 2 ? 'uncommon' : 'common'
}

export interface RarityFeedback {
  readonly chips: number
  readonly sparks: number
  readonly glints: number
  readonly dust: number
  /** Extra time the reward lingers, in ms. */
  readonly lingerMs: number
  readonly labelColor: string
}

export const RARITY_FEEDBACK: Readonly<Record<DropRarity, RarityFeedback>> = {
  common: { chips: 4, sparks: 0, glints: 0, dust: 2, lingerMs: 0, labelColor: '#ffffff' },
  uncommon: { chips: 5, sparks: 2, glints: 0, dust: 2, lingerMs: 150, labelColor: '#ffd9b0' },
  rare: { chips: 6, sparks: 3, glints: 1, dust: 2, lingerMs: 400, labelColor: '#ffe066' },
  special: { chips: 6, sparks: 2, glints: 3, dust: 1, lingerMs: 800, labelColor: '#d9b8ff' },
}

const rank = (rarity: DropRarity) => RARITY_ORDER.indexOf(rarity)

export function highestRarity(rarities: readonly DropRarity[]): DropRarity {
  return rarities.reduce<DropRarity>((best, next) => (rank(next) > rank(best) ? next : best), 'common')
}

/** Rarity of a whole gathering outcome; a critical hit counts at least as rare. */
export function outcomeRarity(result: Extract<GatheringResult, { ok: true }>): DropRarity {
  const base = highestRarity([...result.drops, ...result.rareDrops].map(stack => rarityOfItem(stack.itemId)))
  return result.critical ? highestRarity([base, 'rare']) : base
}
