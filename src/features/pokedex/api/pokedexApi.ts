import { supabase } from '../../../shared/api/supabase'
import type { PokedexEntry } from '../../../shared/types/database'

export async function loadPokedexEntries(userId: string): Promise<PokedexEntry[]> {
  const { data, error } = await supabase
    .from('pokedex_entries')
    .select('pokemon_id, registered_at')
    .eq('user_id', userId)
  if (error) throw error
  return (data as PokedexEntry[]).map(row => ({ ...row, user_id: userId }))
}

export async function recordPokemonSeen(pokemonId: number): Promise<void> {
  const { error } = await supabase.rpc('record_pokemon_seen', { p_pokemon_id: pokemonId })
  if (error) throw error
}

export async function bulkRecordPokemonSeen(pokemonIds: number[]): Promise<void> {
  if (pokemonIds.length === 0) return
  const { error } = await supabase.rpc('bulk_record_pokemon_seen', { p_pokemon_ids: pokemonIds })
  if (error) throw error
}

export async function registerPokemon(pokemonId: number): Promise<void> {
  const { error } = await supabase.rpc('register_pokemon', { p_pokemon_id: pokemonId })
  if (error) throw error
}
