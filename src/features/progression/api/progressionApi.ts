// Progression API — R06 service layer.
//
// Gap operations (V-01, V-02, V-03) must NOT fall back to direct client writes.
// Per TRUST_BOUNDARY.md §7, this layer calls the target server-side functions
// even though they are not yet deployed. They will return errors until R10/R12.

import { supabase } from '../../../shared/api/supabase'
import type { Profile, TokenLedgerEntry, PokemonXp } from '../../../shared/types/database'

// Own profile — SELECT via RLS (public read).
export async function getProfile(userId: string): Promise<Profile> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  if (error) throw error
  return data
}

// Safe client write — avatar_url, display_name, lang are client-owned fields
// (TRUST_BOUNDARY.md §3.7). tokens/cooldown/multiplier columns must NOT be
// included here; those are server-only.
export async function updateSafeProfileFields(
  userId: string,
  fields: Pick<Profile, 'avatar_url' | 'display_name' | 'lang'>,
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update(fields)
    .eq('id', userId)
  if (error) throw error
}

// Own token ledger — SELECT own rows via RLS.
export async function getTokenLedger(): Promise<TokenLedgerEntry[]> {
  const { data, error } = await supabase
    .from('token_ledger')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

// TKN-3 (R10): collect-passive-tokens Edge Function validates auth and rate-limits,
// then calls collect_passive_tokens() RPC which owns the token math.
export async function collectPassiveTokens(): Promise<{ delta: number; new_balance: number }> {
  const { data, error } = await supabase.functions.invoke('collect-passive-tokens', { body: {} })
  if (error) throw error
  return data as { delta: number; new_balance: number }
}

// TKN-4 (R10): spend_tokens_learn_move RPC — debits 150 tokens atomically and
// updates pokemon_xp.moves. Cost applies whether the user confirms or cancels
// (mirrors legacy behavior). new_moves is the full updated move-slug array.
export async function learnMove(
  pokemonId: number,
  newMoves: string[],
): Promise<{ new_balance: number }> {
  const { data, error } = await supabase.rpc('spend_tokens_learn_move', {
    p_pokemon_id: pokemonId,
    p_new_moves: newMoves,
  })
  if (error) throw error
  return data as { new_balance: number }
}

// Own XP records — SELECT own rows via RLS.
export async function getPokemonXp(pokemonId: number): Promise<PokemonXp | null> {
  const { data, error } = await supabase
    .from('pokemon_xp')
    .select('*')
    .eq('pokemon_id', pokemonId)
    .maybeSingle()
  if (error) throw error
  return data
}

// XP-1 (R12): grant_pokemon_xp RPC — awards XP atomically and recomputes level
// server-side using the Medium Fast curve (L³). Validates ownership.
// Called by dungeon-reward (R15) and any future XP source.
// The client must never write pokemon_xp.xp directly; this is the only path.
export async function grantXp(
  pokemonId: number,
  xpAmount: number,
  reason = 'dungeon',
): Promise<{ new_xp: number; new_level: number; leveled_up: boolean }> {
  const { data, error } = await supabase.rpc('grant_pokemon_xp', {
    p_pokemon_id: pokemonId,
    p_xp_amount: xpAmount,
    p_reason: reason,
  })
  if (error) throw error
  return data as { new_xp: number; new_level: number; leveled_up: boolean }
}

// Gap V-02 / V-03 — `dungeon-reward` Edge Function does not yet exist.
// Enforces trust boundary: no component may write pokemon_xp or profiles.tokens
// from client-computed dungeon results. Will be implemented in R15.
// (Token ledger write is server-side; the debit side lives in the RPC.)
export async function submitDungeonReward(payload: {
  run_id: string
  pokemon_id: number
  xp_earned: number
  tokens_earned: number
  moves: Record<string, unknown>
}): Promise<{ new_xp: number; new_balance: number }> {
  const { data, error } = await supabase.functions.invoke('dungeon-reward', { body: payload })
  if (error) throw error
  return data as { new_xp: number; new_balance: number }
}
