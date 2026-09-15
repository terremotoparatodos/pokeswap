// Processing (refining, crafting, alchemy, construction) as a pure function.
// Processing costs no energy: it is limited by input materials, which is
// itself the sink that keeps gathering in demand.

import { PUBLIC_STATION_TIME_MULTIPLIER } from './catalog/tools'
import { hasItems, mergeStacks } from './inventory'
import { actionXp } from './progression'
import type { Inventory, ItemStack, ProcessingResult, RecipeDefinition } from './types'

const MAX_PROCESSING_BONUS = 0.3
const MAX_BATCH = 100

export interface ProcessingContext {
  readonly recipe: RecipeDefinition
  readonly professionLevel: number
  readonly inventory: Inventory
  readonly quantity: number
  /** Aggregated Pokémon `processing` trait. */
  readonly processingBonus: number
  /** 'owned' uses the player's structure bonus; 'public' is the slower town station. */
  readonly station: 'owned' | 'public'
  readonly stationSpeedBonus: number
  readonly random: () => number
}

export function resolveProcessing(context: ProcessingContext): ProcessingResult {
  const { recipe, quantity, random } = context
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_BATCH) return { ok: false, reason: 'invalid_quantity' }
  if (context.professionLevel < recipe.requiredLevel) return { ok: false, reason: 'level_too_low' }
  if (!hasItems(context.inventory, recipe.inputs, quantity)) return { ok: false, reason: 'missing_inputs' }

  const bonus = Math.min(MAX_PROCESSING_BONUS, Math.max(0, context.processingBonus))
  let savedInputs = 0
  for (let craft = 0; craft < quantity; craft++) if (random() < bonus) savedInputs++

  // A saved input refunds one unit of the first ingredient of that craft.
  const consumed: ItemStack[] = mergeStacks(recipe.inputs).map((stack, index) => ({
    itemId: stack.itemId,
    quantity: stack.quantity * quantity - (index === 0 ? Math.min(savedInputs, stack.quantity * quantity) : 0),
  }))

  const stationMultiplier = recipe.station === null
    ? 1
    : context.station === 'public' ? PUBLIC_STATION_TIME_MULTIPLIER : 1 - Math.max(0, context.stationSpeedBonus)

  return {
    ok: true,
    consumed,
    produced: recipe.outputs.map(stack => ({ itemId: stack.itemId, quantity: stack.quantity * quantity })),
    savedInputs,
    seconds: Math.round(recipe.baseSeconds * quantity * stationMultiplier * (1 - bonus) * 100) / 100,
    xp: actionXp(recipe.xp, context.professionLevel, recipe.requiredLevel, false, 0) * quantity,
  }
}
