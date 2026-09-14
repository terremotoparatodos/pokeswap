// Map feature public API — R16
//
// The map module is read-only: it loads and displays world state,
// subscribes to realtime changes, and emits selection events.
// It does not own market, auth, or economy logic.

export type { MapEntity, MapZone, CameraState, SlotPatch, MapActivityEvent } from './types'

export { MAP_W, MAP_H, TILE_W, ZONES, ZONE_TYPES } from './data/mapConfig'
export { isWalkable, getHearthomePoint, getSpawnPoint } from './data/mapConfig'

export { fetchMapData, fetchRecentActivity, fetchSlots } from './api/mapApi'
export type { MapData } from './api/mapApi'

export {
  TOP_OWNED_COUNT, topPricedIds, visibleOwnedIds, mergeSlotPatch, slotPatchFromRow,
  activityFromRow, diffIds, activityLabel,
} from './domain/ownedSlots'

export { useCamera } from './composables/useCamera'
export { useMapEntities } from './composables/useMapEntities'
export { useMapRealtime } from './composables/useMapRealtime'
