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

/** A time reduction must be a fraction in [0, 1); anything else (NaN, ≥ 1, negative) counts as no reduction. */
function reductionOrNone(value: number): number {
  return Number.isFinite(value) && value >= 0 && value < 1 ? value : 0
}

export function resolveProcessing(context: ProcessingContext): ProcessingResult {
  const { recipe, quantity, random } = context
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_BATCH) return { ok: false, reason: 'invalid_quantity' }
  // Written as !(a >= b) so a NaN level fails closed instead of passing.
  if (!(context.professionLevel >= recipe.requiredLevel)) return { ok: false, reason: 'level_too_low' }
  if (!hasItems(context.inventory, recipe.inputs, quantity)) return { ok: false, reason: 'missing_inputs' }

  const bonus = Math.min(MAX_PROCESSING_BONUS, reductionOrNone(context.processingBonus))
  let savedInputs = 0
  for (let craft = 0; craft < quantity; craft++) if (random() < bonus) savedInputs++

  // A saved input refunds one unit of the first ingredient of that craft.
  // An input fully refunded is left out, rather than reported as a stack of zero.
  const consumed: ItemStack[] = mergeStacks(recipe.inputs).map((stack, index) => ({
    itemId: stack.itemId,
    quantity: stack.quantity * quantity - (index === 0 ? Math.min(savedInputs, stack.quantity * quantity) : 0),
  })).filter(stack => stack.quantity > 0)

  // The station bonus is not balanced here; this only guarantees time stays finite and positive.
  const stationMultiplier = recipe.station === null
    ? 1
    : context.station === 'public' ? PUBLIC_STATION_TIME_MULTIPLIER : 1 - reductionOrNone(context.stationSpeedBonus)

  return {
    ok: true,
    consumed,
    produced: recipe.outputs.map(stack => ({ itemId: stack.itemId, quantity: stack.quantity * quantity })),
    savedInputs,
    seconds: Math.round(recipe.baseSeconds * quantity * stationMultiplier * (1 - bonus) * 100) / 100,
    xp: actionXp(recipe.xp, context.professionLevel, recipe.requiredLevel, false, 0) * quantity,
  }
}
