// Named simulation scenarios. Numbers are starting assumptions to iterate on
// in R32/R33, not approved balance.

import type { AccessTag, ItemId, ProfessionId, Tier, TraitBonuses } from '../domain/types'

export interface PlayerArchetype {
  readonly id: string
  readonly share: number
  readonly sessionsPerDay: number
  readonly gatheringMinutesPerSession: number
}

export interface SimulationConfig {
  readonly seed: number
  readonly players: number
  readonly days: number
  readonly archetypes: readonly PlayerArchetype[]
  /** Share of players whose main gathering profession is each one. */
  readonly professionShare: Readonly<Record<ProfessionId, number>>
  readonly startingLevel: number
  /** Average aggregated Pokémon bonuses of a player's profession party. */
  readonly pokemonBonuses: TraitBonuses
  readonly access: readonly AccessTag[]
  readonly startingToolTier: 0 | Tier
  readonly repairTools: boolean
  readonly craftTools: boolean
  readonly regenBonus: number
  /** Units consumed per player per day by PvE, exploration and gathering (final sinks). */
  readonly demandPerPlayerDay: Readonly<Record<ItemId, number>>
  readonly pveDropsPerPlayerDay: Readonly<Record<ItemId, number>>
  /** Share of players owning each structure and paying its maintenance. */
  readonly structureOwnership: Readonly<Record<ItemId, number>>
  /** Items whose stock is recorded at the end of every day. */
  readonly trackItems: readonly ItemId[]
}

export const AVERAGE_POKEMON_BONUSES: TraitBonuses = { yield: 0.08, speed: 0.06, energySaving: 0.06, toolCare: 0.1, rareFind: 0.2 }

export const BASE_SCENARIO: SimulationConfig = {
  seed: 31,
  players: 100,
  days: 7,
  archetypes: [
    { id: 'casual', share: 0.5, sessionsPerDay: 1, gatheringMinutesPerSession: 45 },
    { id: 'regular', share: 0.35, sessionsPerDay: 2, gatheringMinutesPerSession: 45 },
    { id: 'hardcore', share: 0.15, sessionsPerDay: 3, gatheringMinutesPerSession: 90 },
  ],
  professionShare: { mining: 0.4, woodcutting: 0.25, fishing: 0.15, alchemy: 0.2 },
  startingLevel: 1,
  pokemonBonuses: AVERAGE_POKEMON_BONUSES,
  access: [],
  startingToolTier: 1,
  repairTools: true,
  craftTools: true,
  regenBonus: 0,
  demandPerPlayerDay: { potion: 3, super_potion: 1, hyper_potion: 0.2, revive: 0.3, ether: 0.5, vigor_tea: 0.5 },
  pveDropsPerPlayerDay: { wild_essence: 0.4 },
  structureOwnership: { campfire: 0.5, workbench: 0.3, smelter: 0.15, alchemy_table: 0.05 },
  trackItems: ['stone', 'coal', 'iron_ore', 'iron_ingot', 'common_log', 'plank', 'oran_berry', 'vial'],
}

export const SCENARIOS: Readonly<Record<string, SimulationConfig>> = {
  base: BASE_SCENARIO,
  'mining-only': { ...BASE_SCENARIO, professionShare: { mining: 1, woodcutting: 0, fishing: 0, alchemy: 0 } },
  'no-pokemon': { ...BASE_SCENARIO, pokemonBonuses: {} },
  'no-repair': { ...BASE_SCENARIO, repairTools: false },
  veterans: {
    ...BASE_SCENARIO, startingLevel: 40, startingToolTier: 3, access: ['hardRock', 'deepWater', 'frozenGround'],
    pokemonBonuses: { yield: 0.15, speed: 0.12, energySaving: 0.12, toolCare: 0.25, rareFind: 0.5 },
  },
  'month-100': { ...BASE_SCENARIO, days: 30 },
}
