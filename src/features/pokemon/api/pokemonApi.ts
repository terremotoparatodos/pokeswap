import { supabase } from '../../../shared/api/supabase'
import type { Pokemon, Slot } from '../../../shared/types/database'

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
