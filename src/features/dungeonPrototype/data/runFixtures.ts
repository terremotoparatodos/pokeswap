// Party, items and loot fixtures for the labs (D0).
//
// Dev data only. There is no persistence here and no economy: the numbers exist
// so the loops can be felt, and every one of them is a PROTOTYPE ASSUMPTION.

import type { BattleItem } from '../domain/battle'
import type { Combatant } from '../domain/damage'
import { hpFor, MAX_PARTY, type PokemonInstance } from '../domain/party'
import { moveById } from '../domain/moves'
import type { LootTable } from '../domain/rewards'
import { speciesById } from './speciesFixtures'

export interface PartyBlueprint {
  readonly speciesId: number
  readonly level: number
  readonly moves: readonly string[]
}

/** Six members, because the approved party size is six and the engine must feel that limit. */
export const DEFAULT_PARTY: readonly PartyBlueprint[] = [
  { speciesId: 68, level: 30, moves: ['bodySlam', 'quickAttack', 'swordsDance', 'protect'] },
  { speciesId: 135, level: 30, moves: ['quickAttack', 'thunderWave', 'tackle', 'protect'] },
  { speciesId: 4, level: 28, moves: ['flamethrower', 'tackle', 'growl', 'hyperBeam'] },
  { speciesId: 79, level: 28, moves: ['tackle', 'growl', 'protect', 'bodySlam'] },
  { speciesId: 81, level: 26, moves: ['tackle', 'thunderWave', 'protect', 'quickAttack'] },
  { speciesId: 43, level: 26, moves: ['tackle', 'growl', 'protect', 'swordsDance'] },
]

export function buildPokemon(blueprint: PartyBlueprint, index: number): PokemonInstance {
  const species = speciesById(blueprint.speciesId)!
  const maxHp = hpFor(species.baseStats[0], blueprint.level)
  const pp: Record<string, number> = {}
  for (const moveId of blueprint.moves) pp[moveId] = moveById(moveId)?.pp ?? 10
  return {
    instanceId: `${species.name.toLowerCase()}-${index}`,
    speciesId: blueprint.speciesId,
    level: blueprint.level,
    moves: [...blueprint.moves],
    hp: maxHp,
    maxHp,
    pp,
    status: 'none',
    sleepFor: 0,
  }
}

/** Never more than six: the engine must not assume an endless bench. */
export const buildParty = (blueprints: readonly PartyBlueprint[] = DEFAULT_PARTY): PokemonInstance[] =>
  blueprints.slice(0, MAX_PARTY).map(buildPokemon)

export const combatantFor = (pokemon: PokemonInstance): Combatant => ({
  pokemon,
  species: speciesById(pokemon.speciesId)!,
  stages: {},
})

/** A wild encounter built from the floor plan. */
export function buildWild(speciesId: number, level: number, moves?: readonly string[]): PokemonInstance {
  const species = speciesById(speciesId) ?? speciesById(74)!
  const moveIds = moves ?? ['tackle', 'growl', 'quickAttack', 'protect']
  return buildPokemon({ speciesId: species.speciesId, level, moves: moveIds }, Math.round(level * 1000 + species.speciesId))
}

/** The four consumables the brief asks for, and nothing else. */
export const BATTLE_ITEMS: Readonly<Record<string, BattleItem>> = {
  potion: { id: 'potion', name: 'Poción', kind: 'heal', amount: 40 },
  revive: { id: 'revive', name: 'Revivir', kind: 'revive', amount: 0.5 },
  ether: { id: 'ether', name: 'Éter', kind: 'ether', amount: 10 },
  poke_ball: { id: 'poke_ball', name: 'Poké Ball', kind: 'ball', amount: 1 },
}

/** What the player walks in with. A basic loadout, as the NPC shop will sell. */
export const STARTING_INVENTORY: Readonly<Record<string, number>> = {
  potion: 4, revive: 1, ether: 2, poke_ball: 6,
}

/** Inventory slots the prototype pretends the player has. */
export const INVENTORY_SLOTS = 20

export const FLOOR_LOOT: LootTable = {
  id: 'floor',
  entries: [
    { itemId: 'cave_shard', name: 'Esquirla de cueva', rarity: 'common', quantity: 2, weight: 60 },
    { itemId: 'damp_moss', name: 'Musgo húmedo', rarity: 'common', quantity: 1, weight: 30 },
    { itemId: 'iron_chunk', name: 'Trozo de hierro', rarity: 'rare', quantity: 1, weight: 9 },
    { itemId: 'alpha_dust', name: 'Polvo alfa', rarity: 'veryRare', quantity: 1, weight: 1 },
  ],
}

export const BOSS_LOOT: LootTable = {
  id: 'boss',
  entries: [
    { itemId: 'iron_chunk', name: 'Trozo de hierro', rarity: 'common', quantity: 3, weight: 50 },
    { itemId: 'alpha_core', name: 'Núcleo alfa', rarity: 'rare', quantity: 1, weight: 35 },
    { itemId: 'alpha_crown', name: 'Corona alfa', rarity: 'veryRare', quantity: 1, weight: 15 },
  ],
}

/**
 * The hook the economy will plug into: these ids are materials, not currency,
 * and they are meant to feed crafting, Alquimia and Construcción later. No
 * prices, no recipes and no faucet decisions are made here.
 */
export const MATERIAL_IDS = ['cave_shard', 'damp_moss', 'iron_chunk', 'alpha_dust', 'alpha_core', 'alpha_crown'] as const
