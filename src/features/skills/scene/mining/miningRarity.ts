// Feedback hierarchy for work results: how loud a drop should feel.
// COMMON → UNCOMMON → RARE → SPECIAL changes particles, glint, label colour and
// how long the reward lingers — never a different cinematic.

import { MATERIAL_BY_ID } from '../../domain/materials'
import type { RolledReward } from '../../domain/workRules'

export type DropRarity = 'common' | 'uncommon' | 'rare' | 'special'

export const RARITY_ORDER: readonly DropRarity[] = ['common', 'uncommon', 'rare', 'special']

/** By material grade: the first two rungs are everyday, the last one is special. */
const GRADE_RARITY: Readonly<Record<number, DropRarity>> = { 1: 'common', 2: 'common', 3: 'uncommon', 4: 'rare', 5: 'special' }

export function rarityOfItem(itemId: string): DropRarity {
  const grade = MATERIAL_BY_ID.get(itemId)?.grade
  return grade ? GRADE_RARITY[grade] : 'common'
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

/** Rarity of a settled action; the aptitude bonus unit makes it feel at least uncommon. */
export function rewardRarity(rewards: readonly RolledReward[]): DropRarity {
  const base = highestRarity(rewards.map(reward => rarityOfItem(reward.itemId)))
  return rewards.some(reward => reward.bonus) ? highestRarity([base, 'uncommon']) : base
}
