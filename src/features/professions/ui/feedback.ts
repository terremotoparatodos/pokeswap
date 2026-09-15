// Result lines shown after gathering or crafting.

import { PROFESSIONS } from '../domain/catalog/professions'
import type { GatheringResult, ProcessingResult, ProfessionId } from '../domain/types'
import { itemName } from './progressionView'

export type FeedbackTone = 'item' | 'rare' | 'xp' | 'energy' | 'wear' | 'level' | 'warn'

export interface FeedbackLine {
  readonly text: string
  readonly tone: FeedbackTone
  readonly itemId?: string
}

export interface FeedbackContext {
  readonly profession: ProfessionId
  readonly leveledUp: boolean
  readonly newLevel: number
  readonly toolBroke: boolean
  readonly hasTool: boolean
}

const format = (value: number): string => String(Math.round(value * 100) / 100).replace('.', ',')

export function gatheringFeedback(result: Extract<GatheringResult, { ok: true }>, context: FeedbackContext): FeedbackLine[] {
  const name = PROFESSIONS[context.profession].name
  const lines: FeedbackLine[] = [
    ...result.drops.map(stack => ({ text: `+${stack.quantity} ${itemName(stack.itemId)}`, tone: 'item' as const, itemId: stack.itemId })),
    ...result.rareDrops.map(stack => ({ text: `+${stack.quantity} ${itemName(stack.itemId)}`, tone: 'rare' as const, itemId: stack.itemId })),
  ]
  if (result.critical) lines.push({ text: 'Botín doble', tone: 'rare' })
  if (result.fineUnits > 0) lines.push({ text: `${result.fineUnits} de calidad fina`, tone: 'item' })
  lines.push({ text: `+${result.xp} XP ${name}`, tone: 'xp' })
  lines.push({ text: `−${format(result.energySpent)} energía`, tone: 'energy' })
  if (context.hasTool) {
    lines.push(result.durabilityLoss > 0
      ? { text: `−${result.durabilityLoss} durabilidad`, tone: 'wear' }
      : { text: 'Sin desgaste', tone: 'wear' })
  }
  if (context.leveledUp) lines.push({ text: `¡${name} sube a Nv. ${context.newLevel}!`, tone: 'level' })
  if (context.toolBroke) lines.push({ text: 'Tu herramienta se rompió', tone: 'warn' })
  return lines
}

/** How rewards landed in the slot inventory (R31-C1). */
export function inventoryFeedback(
  placements: readonly { readonly itemId: string; readonly newStack: boolean; readonly filledStack: boolean }[],
  overflow: readonly { readonly itemId: string; readonly quantity: number }[],
): FeedbackLine[] {
  const lines: FeedbackLine[] = []
  const seen = new Set<string>()
  for (const placement of placements) {
    const key = `${placement.itemId}:${placement.newStack}:${placement.filledStack}`
    if (seen.has(key)) continue
    seen.add(key)
    if (placement.filledStack) lines.push({ text: `Stack de ${itemName(placement.itemId)} completo`, tone: 'level', itemId: placement.itemId })
    else if (placement.newStack) lines.push({ text: `Nuevo espacio: ${itemName(placement.itemId)}`, tone: 'item', itemId: placement.itemId })
  }
  for (const stack of overflow) {
    lines.push({ text: `No entró: ${stack.quantity} ${itemName(stack.itemId)} (queda pendiente)`, tone: 'warn', itemId: stack.itemId })
  }
  return lines
}

export function craftingFeedback(result: Extract<ProcessingResult, { ok: true }>, profession: ProfessionId, leveledUp: boolean, newLevel: number): FeedbackLine[] {
  const name = PROFESSIONS[profession].name
  return [
    ...result.produced.map(stack => ({ text: `+${stack.quantity} ${itemName(stack.itemId)}`, tone: 'item' as const, itemId: stack.itemId })),
    ...result.consumed.map(stack => ({ text: `−${stack.quantity} ${itemName(stack.itemId)}`, tone: 'energy' as const, itemId: stack.itemId })),
    ...(result.savedInputs > 0 ? [{ text: `Tu Pokémon ahorró ${result.savedInputs} insumo${result.savedInputs > 1 ? 's' : ''}`, tone: 'rare' as const }] : []),
    { text: `+${result.xp} XP ${name}`, tone: 'xp' },
    ...(leveledUp ? [{ text: `¡${name} sube a Nv. ${newLevel}!`, tone: 'level' as const }] : []),
  ]
}
