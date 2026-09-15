// View models for energy and tools: what the player has and why an action costs what it costs.

import { canBeRepaired, repairTool, toolCondition, wearTool } from '../domain/durability'
import { actionEnergyCost } from '../domain/energy'
import { levelEfficiency } from '../domain/progression'
import type { EnergyConfig, EnergyState, GatheringNodeDefinition, ToolDefinition, ToolInstance } from '../domain/types'

export interface EnergyView {
  readonly current: number
  readonly max: number
  readonly ratio: number
  readonly rested: number
  readonly minutesToFull: number
}

export function energyView(state: EnergyState, max: number, config: EnergyConfig): EnergyView {
  const missing = Math.max(0, max - state.current)
  return {
    current: Math.floor(state.current),
    max,
    ratio: max > 0 ? Math.min(1, state.current / max) : 0,
    rested: Math.floor(state.rested),
    minutesToFull: Math.ceil((missing / config.regenPerHour) * 60),
  }
}

export interface EnergyCostBreakdown {
  readonly base: number
  readonly pokemonSaving: number
  readonly levelSaving: number
  /** The combined saving hit the minimum cost ratio. */
  readonly floorApplied: boolean
  readonly final: number
}

export function energyCostBreakdown(node: GatheringNodeDefinition, energySaving: number, professionLevel: number, config: EnergyConfig): EnergyCostBreakdown {
  const pokemonSaving = Math.min(1, Math.max(0, energySaving))
  const levelSaving = levelEfficiency(professionLevel, node.requiredLevel).energy
  return {
    base: node.energyCost,
    pokemonSaving,
    levelSaving,
    floorApplied: (1 - pokemonSaving) * (1 - levelSaving) < config.minCostRatio,
    final: actionEnergyCost(node.energyCost, pokemonSaving, levelSaving, config),
  }
}

export type ToolHealth = 'healthy' | 'worn' | 'critical' | 'broken' | 'retired'

export const TOOL_HEALTH_LABEL: Readonly<Record<ToolHealth, string>> = {
  healthy: 'En buen estado',
  worn: 'Desgastada',
  critical: 'A punto de romperse',
  broken: 'Rota · reparable',
  retired: 'Inservible',
}

export interface ToolHealthView {
  readonly health: ToolHealth
  readonly label: string
  /** Current durability over current max. */
  readonly ratio: number
  /** Current max over the original max: how much life repairs already took. */
  readonly lifeRatio: number
  readonly repairsLeft: number
}

export function toolHealth(instance: ToolInstance, definition: ToolDefinition): ToolHealthView {
  const condition = toolCondition(instance, definition)
  const ratio = instance.maxDurability > 0 ? instance.durability / instance.maxDurability : 0
  const health: ToolHealth = condition === 'retired' ? 'retired'
    : condition === 'broken' ? 'broken'
      : ratio >= 0.6 ? 'healthy' : ratio >= 0.25 ? 'worn' : 'critical'

  let repairsLeft = 0
  let probe = instance
  while (canBeRepaired(probe, definition)) {
    const repaired = repairTool(wearTool(probe, 1), definition)
    if (!repaired.ok) break
    probe = repaired.instance
    repairsLeft++
  }
  return { health, label: TOOL_HEALTH_LABEL[health], ratio, lifeRatio: instance.maxDurability / definition.maxDurability, repairsLeft }
}
