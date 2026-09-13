// Map API — R16
//
// Read-only access to the data the map needs.
// The map module never writes to any table.
// Authority: pokemon (public SELECT), slots (public SELECT).

import { supabase } from '../../../shared/api/supabase'
import type { Pokemon, Slot } from '../../../shared/types/database'

export interface MapData {
  pokemon: Pokemon[]
  slots: Record<number, Slot>
}

/**
 * Loads all Pokémon and all slots in parallel.
 * Returns slots indexed by pokemon_id for O(1) lookup.
 *
 * Both tables are publicly readable (RLS allows SELECT for all).
 * No auth is required.
 */
export async function fetchMapData(): Promise<MapData> {
  const [pokemonResult, slotsResult] = await Promise.all([
    supabase.from('pokemon').select('*').order('id'),
    supabase.from('slots').select('*'),
  ])

  if (pokemonResult.error) throw pokemonResult.error
  if (slotsResult.error) throw slotsResult.error

  const slotMap: Record<number, Slot> = {}
  for (const slot of slotsResult.data) {
    slotMap[slot.pokemon_id] = slot
  }

  return {
    pokemon: pokemonResult.data,
    slots: slotMap,
  }
}

/**
 * Fetches recent activity feed entries for the activity strip.
 * Returns up to `limit` entries, newest first.
 */
export async function fetchRecentActivity(limit = 20) {
  const { data, error } = await supabase
    .from('activity_feed')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return data
}
