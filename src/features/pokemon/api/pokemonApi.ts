import { supabase } from '../../../shared/api/supabase'
import type { Pokemon, Slot } from '../../../shared/types/database'

export interface SlotWithPokemon {
  slot: Slot
  pokemon: Pokemon
}

export async function listPokemon(): Promise<Pokemon[]> {
  const { data, error } = await supabase
    .from('pokemon')
    .select('*')
    .order('id')
  if (error) throw error
  return data
}

export async function getPokemon(pokemonId: number): Promise<Pokemon> {
  const { data, error } = await supabase
    .from('pokemon')
    .select('*')
    .eq('id', pokemonId)
    .single()
  if (error) throw error
  return data
}

export async function listSlots(): Promise<Slot[]> {
  const { data, error } = await supabase
    .from('slots')
    .select('*')
    .order('pokemon_id')
  if (error) throw error
  return data
}

export async function getSlot(pokemonId: number): Promise<Slot> {
  const { data, error } = await supabase
    .from('slots')
    .select('*')
    .eq('pokemon_id', pokemonId)
    .single()
  if (error) throw error
  return data
}

export async function listOwnedSlots(userId: string): Promise<Slot[]> {
  const { data, error } = await supabase
    .from('slots')
    .select('*')
    .eq('owner_id', userId)
    .order('pokemon_id')
  if (error) throw error
  return data
}

export async function listOwnedSlotsWithPokemon(userId: string): Promise<SlotWithPokemon[]> {
  const slotsRes = await supabase
    .from('slots')
    .select('*')
    .eq('owner_id', userId)
    .order('pokemon_id')
  if (slotsRes.error) throw slotsRes.error
  if (!slotsRes.data.length) return []

  const ids = slotsRes.data.map(s => s.pokemon_id)
  const pokemonRes = await supabase.from('pokemon').select('*').in('id', ids)
  if (pokemonRes.error) throw pokemonRes.error

  const pMap = new Map(pokemonRes.data.map(p => [p.id, p]))
  return slotsRes.data
    .filter(s => pMap.has(s.pokemon_id))
    .map(s => ({ slot: s, pokemon: pMap.get(s.pokemon_id)! }))
}
