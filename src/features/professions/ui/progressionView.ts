// Profession progression and unlock timeline, derived from R31-A catalogs.
// Entries are 'defined' when a catalog requirement exists and 'future' when
// R31-A only reserved them (specializations, "Reservado" milestones).

import { ITEM_BY_ID } from '../domain/catalog/items'
import { GATHERING_NODES } from '../domain/catalog/nodes'
import { MAX_PROFESSION_LEVEL, PROFESSIONS } from '../domain/catalog/professions'
import { RECIPES } from '../domain/catalog/recipes'
import { TOOLS } from '../domain/catalog/tools'
import { levelForXp, totalXpForLevel } from '../domain/progression'
import type { ProfessionId, RecipeDefinition } from '../domain/types'

export type UnlockKind = 'node' | 'recipe' | 'tool' | 'milestone' | 'specialization'

export interface UnlockEntry {
  readonly level: number
  readonly kind: UnlockKind
  readonly id: string
  readonly name: string
  readonly status: 'defined' | 'future'
}

const KIND_ORDER: readonly UnlockKind[] = ['node', 'tool', 'recipe', 'milestone', 'specialization']

export function itemName(itemId: string): string {
  return ITEM_BY_ID.get(itemId)?.name ?? itemId
}

/** R31-A recipes have no display name; the output is the name. */
export function recipeTitle(recipe: RecipeDefinition): string {
  return recipe.outputs.map(output => `${output.quantity > 1 ? `${output.quantity} × ` : ''}${itemName(output.itemId)}`).join(' + ')
}

export function professionUnlocks(profession: ProfessionId): UnlockEntry[] {
  const definition = PROFESSIONS[profession]
  const entries: UnlockEntry[] = [
    ...GATHERING_NODES.filter(node => node.profession === profession)
      .map(node => ({ level: node.requiredLevel, kind: 'node' as const, id: node.id, name: node.name, status: 'defined' as const })),
    ...TOOLS.filter(tool => tool.kind === definition.toolKind)
      .map(tool => ({ level: tool.requiredLevel, kind: 'tool' as const, id: tool.itemId, name: itemName(tool.itemId), status: 'defined' as const })),
    ...RECIPES.filter(recipe => recipe.profession === profession)
      .map(recipe => ({ level: recipe.requiredLevel, kind: 'recipe' as const, id: recipe.id, name: recipeTitle(recipe), status: 'defined' as const })),
    ...definition.milestones.map(milestone => ({
      level: milestone.level, kind: 'milestone' as const, id: `milestone-${milestone.level}`, name: milestone.description,
      status: milestone.description.startsWith('Reservado') ? 'future' as const : 'defined' as const,
    })),
    ...definition.specializations.map(stub => ({ level: stub.unlockLevel, kind: 'specialization' as const, id: stub.id, name: stub.name, status: 'future' as const })),
  ]
  return entries.sort((a, b) => a.level - b.level || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
}

export interface ProgressionView {
  readonly profession: ProfessionId
  readonly level: number
  readonly maxLevel: number
  readonly totalXp: number
  /** XP earned inside the current level. */
  readonly levelXp: number
  /** XP span of the current level (0 at max level). */
  readonly levelSpan: number
  readonly progress: number
  readonly unlocked: readonly UnlockEntry[]
  readonly upcoming: readonly UnlockEntry[]
}

export function progressionView(profession: ProfessionId, xp: number, upcomingCount = 4): ProgressionView {
  const level = levelForXp(xp)
  const floor = totalXpForLevel(level)
  const levelSpan = level >= MAX_PROFESSION_LEVEL ? 0 : totalXpForLevel(level + 1) - floor
  const unlocks = professionUnlocks(profession)
  return {
    profession,
    level,
    maxLevel: MAX_PROFESSION_LEVEL,
    totalXp: xp,
    levelXp: xp - floor,
    levelSpan,
    progress: levelSpan === 0 ? 1 : (xp - floor) / levelSpan,
    unlocked: unlocks.filter(entry => entry.level <= level),
    upcoming: unlocks.filter(entry => entry.level > level).slice(0, upcomingCount),
  }
}
