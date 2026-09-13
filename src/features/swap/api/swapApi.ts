// Swap API — R06 service layer.
//
// All swap mutations are server-authoritative via `pokeswap-swap` (R02 §6.2).
// No client-side RNG result is ever submitted as authoritative state.

import { supabase } from '../../../shared/api/supabase'
import type { SwapHistoryEntry } from '../../../shared/types/database'

export interface SwapResult {
  pokemon_given_id: number
  pokemon_received_id: number
  was_shiny: boolean
  rarity: string
  swap_cooldown_until: string
}

// Server-authoritative — `pokeswap-swap` Edge Function (R02 §6.2).
// pokemonGivenId is optional; omit to let the server choose randomly.
export async function swap(pokemonGivenId?: number): Promise<SwapResult> {
  const body: Record<string, unknown> = {}
  if (pokemonGivenId !== undefined) {
    body.pokemon_given_id = pokemonGivenId
  }
  const { data, error } = await supabase.functions.invoke('pokeswap-swap', { body })
  if (error) throw error
  return data as SwapResult
}

// TKN-4 (R10): skip_swap_cooldown RPC — debits 1,000 tokens and clears
// swap_cooldown_until atomically. Raises if no active cooldown or insufficient balance.
export async function skipCooldown(): Promise<{ new_balance: number }> {
  const { data, error } = await supabase.rpc('skip_swap_cooldown')
  if (error) throw error
  return data as { new_balance: number }
}

// Own swap history — SELECT own rows via RLS.
export async function getHistory(): Promise<SwapHistoryEntry[]> {
  const { data, error } = await supabase
    .from('swap_history')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}
