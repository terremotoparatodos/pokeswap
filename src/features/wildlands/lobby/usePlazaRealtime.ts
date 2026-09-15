// Plaza Realtime — WildLands lobby
//
// Read-only subscriptions for slots and activity_feed. Every mounted consumer
// gets unique topics because Supabase channel removal is asynchronous.

import { onUnmounted, readonly, ref } from 'vue'
import { supabase } from '../../../shared/api/supabase'
import { activityFromRow, slotPatchFromRow, type SlotPatch } from './domain/ownedSlots'
import type { ActivityFeedEntry } from '../../../shared/types/database'

const ACTIVITY_MAX = 20
let instances = 0

export interface PlazaRealtimeOptions {
  channel?: string
  onActivity?: (event: ActivityFeedEntry) => void
  onReconnect?: () => void
}

export function usePlazaRealtime(onSlotPatch: (patch: SlotPatch) => void, options: PlazaRealtimeOptions = {}) {
  const prefix = options.channel ?? 'plaza'
  const instance = ++instances
  const recentActivity = ref<ActivityFeedEntry[]>([])
  const connected = ref(false)
  let wasConnected = false

  const slotsChannel = supabase
    .channel(`${prefix}-slots-${instance}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'slots' }, payload => {
      const patch = slotPatchFromRow(payload.eventType === 'DELETE' ? payload.old : payload.new)
      if (patch) onSlotPatch(patch)
    })
    .subscribe(status => {
      connected.value = status === 'SUBSCRIBED'
      if (connected.value && wasConnected) options.onReconnect?.()
      if (connected.value) wasConnected = true
    })

  const activityChannel = supabase
    .channel(`${prefix}-activity-${instance}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_feed' }, payload => {
      const row = activityFromRow(payload.new)
      if (!row) return
      recentActivity.value = [row, ...recentActivity.value].slice(0, ACTIVITY_MAX)
      options.onActivity?.(row)
    })
    .subscribe()

  onUnmounted(() => {
    supabase.removeChannel(slotsChannel)
    supabase.removeChannel(activityChannel)
  })

  function seedActivity(events: ActivityFeedEntry[]) {
    recentActivity.value = events.slice(0, ACTIVITY_MAX)
  }

  return { recentActivity: readonly(recentActivity), connected: readonly(connected), seedActivity }
}
