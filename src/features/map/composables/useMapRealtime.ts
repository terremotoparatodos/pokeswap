// useMapRealtime — R16
//
// Supabase Realtime subscriptions for the map view.
// Subscribes to:
//   - slots (all events): ownership changes → entity update
//   - activity_feed (INSERT): new events → activity strip
//
// The map module is read-only. This composable only receives and exposes
// server-pushed state; it never writes back to Supabase.

import { ref, readonly, onUnmounted } from 'vue'
import { supabase } from '../../../shared/api/supabase'
import type { MapActivityEvent, SlotPatch } from '../types'

const ACTIVITY_MAX = 20

export function useMapRealtime(
  onSlotPatch: (patch: SlotPatch) => void,
) {
  const recentActivity = ref<MapActivityEvent[]>([])
  const connected = ref(false)

  const slotsChannel = supabase
    .channel('map-slots')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'slots' },
      payload => {
        const row = (payload.new ?? payload.old) as Record<string, unknown>
        if (!row || !row['pokemon_id']) return
        onSlotPatch({
          pokemon_id: row['pokemon_id'] as number,
          owner_id: (row['owner_id'] as string | null) ?? null,
          owner_username: (row['owner_username'] as string | null) ?? null,
          current_price: (row['current_price'] as number) ?? 0,
          is_locked: (row['is_locked'] as boolean | null) ?? null,
          aura: (row['aura'] as number | null) ?? null,
        })
      },
    )
    .subscribe(status => {
      connected.value = status === 'SUBSCRIBED'
    })

  const activityChannel = supabase
    .channel('map-activity')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'activity_feed' },
      payload => {
        const row = payload.new as MapActivityEvent
        recentActivity.value = [row, ...recentActivity.value].slice(0, ACTIVITY_MAX)
      },
    )
    .subscribe()

  onUnmounted(() => {
    supabase.removeChannel(slotsChannel)
    supabase.removeChannel(activityChannel)
  })

  /** Seed the activity strip with data fetched before realtime connected. */
  function seedActivity(events: MapActivityEvent[]) {
    recentActivity.value = events.slice(0, ACTIVITY_MAX)
  }

  return {
    recentActivity: readonly(recentActivity),
    connected: readonly(connected),
    seedActivity,
  }
}
