import type { SlotWithPokemon } from '../../pokemon/api/pokemonApi'
import type { CompanionPokemon } from '../engine/companion'
import type { PlayerCharacter } from './playerCharacters'

export interface PlayerVisualIdentity {
  username: string | null
  character: PlayerCharacter
  companion: CompanionPokemon | null
}

/**
 * Resolves a cosmetic preference only through the server-backed My Box result.
 * localStorage contributes the id, never ownership or market availability.
 */
export function eligibleCompanion(
  pokemonId: number | null,
  userId: string,
  items: readonly SlotWithPokemon[],
): SlotWithPokemon | null {
  if (pokemonId === null) return null
  return items.find(item =>
    item.slot.pokemon_id === pokemonId &&
    item.slot.owner_id === userId &&
    item.slot.is_locked !== true,
  ) ?? null
}
