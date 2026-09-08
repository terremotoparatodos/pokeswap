// Dungeon API — R18 (moved from progressionApi, R14/R15).
//
// Server-authoritative: the client simulates combat (INV-DGN-1) but every
// persistent result — energy deduction, XP, dungeon tokens — goes through
// a server-side RPC. The client must never write slots.energy,
// pokemon_xp, profiles.tokens, or profiles.dungeon_tokens_today directly.

import { supabase } from '../../../shared/api/supabase'

// DGN-2 (R15): dungeon-start Edge Function — server gate for dungeon entry.
// Deducts DUNGEON_ENERGY_COST (30) from slots.energy atomically via
// consume_dungeon_energy() RPC. Must be called before combat begins.
// Closes INV-DGN-5: energy deduction is non-refundable and server-authoritative.
export async function startDungeon(
  pokemonId: number,
): Promise<{ remaining_energy: number }> {
  const { data, error } = await supabase.functions.invoke('dungeon-start', {
    body: { pokemon_id: pokemonId },
  })
  if (error) throw error
  return data as { remaining_energy: number }
}

// DGN-1 (R14): dungeon-reward Edge Function — validates ownership and applies
// XP + dungeon token rewards atomically via award_dungeon_reward() RPC.
// Closes V-02 (dungeon tokens) and V-03 (XP awards).
// Client-supplied values are advisory; the RPC clamps them server-side:
//   xp_earned     → capped at 10,000
//   tokens_earned → capped at 3,000, then by daily remainder (INV-DGN-3)
export async function submitDungeonReward(payload: {
  pokemon_id:    number
  xp_earned:     number
  tokens_earned: number
}): Promise<{
  new_xp:         number
  new_level:      number
  leveled_up:     boolean
  tokens_awarded: number
  new_balance:    number
}> {
  const { data, error } = await supabase.functions.invoke('dungeon-reward', { body: payload })
  if (error) throw error
  return data as {
    new_xp:         number
    new_level:      number
    leveled_up:     boolean
    tokens_awarded: number
    new_balance:    number
  }
}
