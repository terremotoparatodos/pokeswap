// The alchemy recipe browser (R31-C4), as a pure module.
//
// It sits on top of `ui/recipeView` and adds what a *player-facing* list needs
// and the domain does not carry: a title that is unique, where each ingredient
// comes from, why a recipe is blocked and which one is worth suggesting.
//
// Those gaps are findings, not inventions: `RecipeDefinition` has no name, no
// description and no icon, so every label here is derived from the catalog.

import { ITEM_BY_ID } from '../domain/catalog/items'
import { PROFESSIONS } from '../domain/catalog/professions'
import { RECIPES } from '../domain/catalog/recipes'
import type { Inventory, ProfessionId, RecipeDefinition } from '../domain/types'
import { itemName } from '../ui/progressionView'
import { recipeView, type IngredientView, type RecipeView } from '../ui/recipeView'

/**
 * What the bench offers: the Alchemy recipes of category `alchemy`, in the
 * catalog's own order. `build_alchemy_table` is an alchemy recipe too, but it is
 * `construction` — you raise it on the ground, not on a table — so it does not
 * belong in this list (see the handoff, finding H-4).
 */
export const ALCHEMY_RECIPES: readonly RecipeDefinition[] = RECIPES.filter(recipe => recipe.profession === 'alchemy' && recipe.category === 'alchemy')

/** Where an ingredient comes from; `null` covers PvE drops and unowned items. */
export type IngredientOrigin = ProfessionId | 'pve' | 'unknown'

export const ORIGIN_LABEL: Readonly<Record<IngredientOrigin, string>> = {
  mining: 'Minería',
  woodcutting: 'Tala',
  fishing: 'Pesca',
  alchemy: 'Alquimia',
  pve: 'Combate',
  unknown: 'Otros',
}

export function originOf(itemId: string): IngredientOrigin {
  const item = ITEM_BY_ID.get(itemId)
  if (!item) return 'unknown'
  if (item.profession) return item.profession
  return item.tags.includes('pveDrop') ? 'pve' : 'unknown'
}

export interface AlchemyIngredientView extends IngredientView {
  readonly origin: IngredientOrigin
  readonly originLabel: string
  /** True when this is the ingredient that is short. */
  readonly short: boolean
}

export type CraftBlock =
  | { readonly kind: 'none' }
  | { readonly kind: 'level'; readonly text: string }
  | { readonly kind: 'missing'; readonly text: string; readonly items: readonly AlchemyIngredientView[] }

export interface AlchemyRecipeView extends Omit<RecipeView, 'ingredients'> {
  /** Unique, human title (the catalog only has outputs to name a recipe by). */
  readonly label: string
  readonly ingredients: readonly AlchemyIngredientView[]
  readonly block: CraftBlock
  /** Suggested to the player: ready to make and the most valuable of those. */
  readonly recommended: boolean
  /** Professions that feed this recipe, for the "viene de" chips. */
  readonly origins: readonly IngredientOrigin[]
}

/**
 * Two recipes can produce the same item from different ingredients
 * (`brew_revive` and `brew_revive_scale` both make a Revive), and since a title
 * is derived from the output they would appear twice with the same name. The
 * distinguishing ingredient is appended so the list stays readable.
 */
export function recipeLabel(recipe: RecipeDefinition, all: readonly RecipeDefinition[] = ALCHEMY_RECIPES): string {
  const title = recipe.outputs.map(o => `${o.quantity > 1 ? `${o.quantity} × ` : ''}${itemName(o.itemId)}`).join(' + ')
  const twins = all.filter(other => other.id !== recipe.id
    && other.outputs.length === recipe.outputs.length
    && other.outputs.every((o, i) => o.itemId === recipe.outputs[i].itemId))
  if (!twins.length) return title
  const others = new Set(twins.flatMap(twin => twin.inputs.map(input => input.itemId)))
  const distinct = recipe.inputs.find(input => !others.has(input.itemId))
  return distinct ? `${title} (con ${itemName(distinct.itemId)})` : title
}

function blockOf(view: RecipeView, ingredients: readonly AlchemyIngredientView[]): CraftBlock {
  if (view.availability === 'locked') return { kind: 'level', text: `Necesitás Alquimia Nv. ${view.requiredLevel}` }
  const short = ingredients.filter(ingredient => ingredient.missing > 0)
  if (!short.length) return { kind: 'none' }
  const text = short.length === 1
    ? `Te falta ${short[0].missing} × ${short[0].name}`
    : `Te faltan ${short.length} ingredientes`
  return { kind: 'missing', text, items: short }
}

export function alchemyRecipeView(
  recipe: RecipeDefinition, inventory: Inventory, level: number, quantity = 1,
  all: readonly RecipeDefinition[] = ALCHEMY_RECIPES,
): AlchemyRecipeView {
  const base = recipeView(recipe, inventory, level, quantity)
  const ingredients: AlchemyIngredientView[] = base.ingredients.map(ingredient => {
    const origin = originOf(ingredient.itemId)
    return { ...ingredient, origin, originLabel: ORIGIN_LABEL[origin], short: ingredient.missing > 0 }
  })
  return {
    ...base,
    label: recipeLabel(recipe, all),
    ingredients,
    block: blockOf(base, ingredients),
    recommended: false,
    origins: [...new Set(ingredients.map(ingredient => ingredient.origin))],
  }
}

const AVAILABILITY_ORDER = { ready: 0, missing: 1, locked: 2 } as const

/**
 * The whole browser: every alchemy recipe, sorted the way a player reads it
 * (what I can make, what I am short of, what is still locked), with the most
 * advanced makeable recipe marked as the suggestion.
 */
export function alchemyBrowser(inventory: Inventory, level: number): readonly AlchemyRecipeView[] {
  const views = ALCHEMY_RECIPES.map(recipe => alchemyRecipeView(recipe, inventory, level))
    .sort((a, b) => AVAILABILITY_ORDER[a.availability] - AVAILABILITY_ORDER[b.availability]
      || b.requiredLevel - a.requiredLevel
      || a.label.localeCompare(b.label))
  const best = views.find(view => view.availability === 'ready')
  return best ? views.map(view => (view.id === best.id ? { ...view, recommended: true } : view)) : views
}

/** Chip text for the profession that feeds an ingredient. */
export const professionName = (id: ProfessionId): string => PROFESSIONS[id].name
