// useMapRealtime — R16 (channel names and reconnect in R26)
//
// Supabase Realtime subscriptions for world views (legacy map, WildLands plaza).
// Subscribes to:
//   - slots (all events): ownership changes → entity update
//   - activity_feed (INSERT): new events → activity strip
//
// Read-only. This composable only receives and exposes server-pushed state;
// it never writes back to Supabase.

import { ref, readonly, onUnmounted } from 'vue'
import { supabase } from '../../../shared/api/supabase'
import { activityFromRow, slotPatchFromRow } from '../domain/ownedSlots'
import type { MapActivityEvent, SlotPatch } from '../types'

const ACTIVITY_MAX = 20

/**
 * supabase-js hands back an existing channel when a topic repeats, and its
 * removal is asynchronous: a view remounting quickly would get the old,
 * already-subscribed channel. Every subscription gets its own topic instead.
 */
let instances = 0

export interface MapRealtimeOptions {
  /** Channel name prefix, to tell views apart in the Realtime inspector. */
  channel?: string
  /** A new activity row arrived (after the list is updated). */
  onActivity?: (event: MapActivityEvent) => void
  /** The slots channel came back after dropping; events may have been missed. */
  onReconnect?: () => void
}

export function useMapRealtime(
  onSlotPatch: (patch: SlotPatch) => void,
  options: MapRealtimeOptions = {},
) {
  const prefix = options.channel ?? 'map'
  const instance = ++instances
  const recentActivity = ref<MapActivityEvent[]>([])
  const connected = ref(false)
  let wasConnected = false

  const slotsChannel = supabase
    .channel(`${prefix}-slots-${instance}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'slots' },
      payload => {
        const row = payload.eventType === 'DELETE' ? payload.old : payload.new
        const patch = slotPatchFromRow(row)
        if (patch) onSlotPatch(patch)
      },
    )
    .subscribe(status => {
      connected.value = status === 'SUBSCRIBED'
      if (connected.value && wasConnected) options.onReconnect?.()
      if (connected.value) wasConnected = true
    })

  const activityChannel = supabase
    .channel(`${prefix}-activity-${instance}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'activity_feed' },
      payload => {
        const row = activityFromRow(payload.new)
        if (!row) return
        recentActivity.value = [row, ...recentActivity.value].slice(0, ACTIVITY_MAX)
        options.onActivity?.(row)
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
