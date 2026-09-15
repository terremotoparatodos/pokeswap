// Plaza API — WildLands lobby
//
// Read-only access to the shared state displayed in Ciudad Corazón.

import { supabase } from '../../../../shared/api/supabase'
import type { Slot } from '../../../../shared/types/database'

/** Loads all slots, indexed by pokemon_id. Public SELECT; no auth required. */
export async function fetchSlots(): Promise<Record<number, Slot>> {
  const { data, error } = await supabase.from('slots').select('*')
  if (error) throw error

  const slotMap: Record<number, Slot> = {}
  for (const slot of data) slotMap[slot.pokemon_id] = slot
  return slotMap
}

/** Fetches recent activity entries, newest first. */
export async function fetchRecentActivity(limit = 20) {
  const { data, error } = await supabase
    .from('activity_feed')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return data
}
