// Recipe cards for the crafting bench: what is needed, what is owned, what is missing.

import { PUBLIC_STATION_TIME_MULTIPLIER } from '../domain/catalog/tools'
import { mergeStacks } from '../domain/inventory'
import type { Inventory, ProfessionId, RecipeDefinition, StationKind } from '../domain/types'
import { itemName, recipeTitle } from './progressionView'

export const STATION_LABEL: Readonly<Record<StationKind, string>> = {
  workbench: 'Banco de Trabajo',
  smelter: 'Horno de Fundición',
  alchemyTable: 'Mesa de Alquimia',
  campfire: 'Fogata',
}

/** Same batch limit as resolveProcessing. */
export const MAX_BATCH = 100

export type RecipeAvailability = 'ready' | 'missing' | 'locked'

export interface IngredientView {
  readonly itemId: string
  readonly name: string
  readonly need: number
  readonly have: number
  readonly missing: number
}

export interface RecipeView {
  readonly id: string
  readonly title: string
  readonly profession: ProfessionId
  readonly requiredLevel: number
  readonly availability: RecipeAvailability
  readonly ingredients: readonly IngredientView[]
  readonly outputs: readonly { readonly itemId: string; readonly name: string; readonly quantity: number }[]
  readonly maxCraftable: number
  readonly station: string
  /** Seconds at a public town station for the chosen quantity. */
  readonly seconds: number
}

export function maxCraftable(recipe: RecipeDefinition, inventory: Inventory): number {
  const limits = mergeStacks(recipe.inputs).map(input => Math.floor((inventory[input.itemId] ?? 0) / input.quantity))
  return Math.min(MAX_BATCH, ...limits)
}

export function recipeView(recipe: RecipeDefinition, inventory: Inventory, level: number, quantity = 1): RecipeView {
  const batch = Math.max(1, Math.floor(quantity))
  const ingredients = mergeStacks(recipe.inputs).map(input => {
    const need = input.quantity * batch
    const have = inventory[input.itemId] ?? 0
    return { itemId: input.itemId, name: itemName(input.itemId), need, have, missing: Math.max(0, need - have) }
  })
  const availability: RecipeAvailability = level < recipe.requiredLevel ? 'locked'
    : ingredients.some(ingredient => ingredient.missing > 0) ? 'missing' : 'ready'
  return {
    id: recipe.id,
    title: recipeTitle(recipe),
    profession: recipe.profession,
    requiredLevel: recipe.requiredLevel,
    availability,
    ingredients,
    outputs: recipe.outputs.map(output => ({ itemId: output.itemId, name: itemName(output.itemId), quantity: output.quantity * batch })),
    maxCraftable: maxCraftable(recipe, inventory),
    station: recipe.station ? STATION_LABEL[recipe.station] : 'Se construye en el lugar',
    seconds: Math.round(recipe.baseSeconds * batch * (recipe.station ? PUBLIC_STATION_TIME_MULTIPLIER : 1) * 10) / 10,
  }
}
