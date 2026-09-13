// Map feature types — R16
// Read-only view of the world. The map module never writes to any table.

import type { ActivityFeedEntry, Pokemon, Slot } from '../../../shared/types/database'

export interface MapZone {
  name: string
  x: number
  y: number
  w: number
  h: number
  img: string
}

/** World-space pixel dimensions and walkability grid. */
export interface MapDimensions {
  width: number
  height: number
  tileWidth: number
}

/**
 * A Pokémon placed on the map.
 * `slot` is null for wild (unowned) Pokémon.
 * `x`/`y` are world-space pixels, computed client-side at spawn — not persisted.
 */
export interface MapEntity {
  id: number
  pokemon: Pokemon
  slot: Slot | null
  x: number
  y: number
  isWild: boolean
}

/**
 * A realtime patch received from Supabase when a `slots` row changes.
 * The map module applies this to update entity display state without a full reload.
 */
export interface SlotPatch {
  pokemon_id: number
  owner_id: string | null
  owner_username: string | null
  current_price: number
  is_locked: boolean | null
  aura: number | null
}

/** Client-side viewport state — pan offset and zoom level. Not persisted. */
export interface CameraState {
  x: number
  y: number
  scale: number
}

export type MapActivityEvent = ActivityFeedEntry
