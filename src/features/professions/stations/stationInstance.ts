// One station standing in the world (R33).
//
// `StationDefinition` says what a furnace *is*; this says that *this* furnace
// is in this area, on these tiles, currently doing this. It is the record a
// future server would hold and hand out, so it is plain JSON: ids, an anchor,
// and the process — no class, no engine handle, no Vue ref.
//
// It deliberately does **not** contain art, solidity or a hitbox. Those come
// from the definition and from F-1's `PlacedObject`, which is built from this
// (`stationPlacement.ts`). Two records describing the same tiles would be one
// record too many.

import { stationDefinition, type StationDefinition, type StationTypeId } from './stationDefinition'
import { footprintCovers, footprintRing, footprintTiles, nearestFootprintTile, type FootprintTile } from './stationFootprint'
import { advanceProcess, stationPhase, type StationPhase, type StationProcessState } from './stationProcess'

export interface PlacedStation {
  /** Identity of this station, distinct from its type and from its structure item. */
  readonly stationId: string
  readonly stationType: StationTypeId
  readonly areaId: string
  /** Front-left tile of the footprint, the same anchor rule F-1 uses. */
  readonly anchor: FootprintTile
  /**
   * Who built it, when that exists.
   *
   * Carried so the record does not have to change shape later; R33 implements
   * no ownership economy at all — no income, no share, no permissions, no
   * shop (§40). Nothing reads it.
   */
  readonly ownerId: string | null
  readonly process: StationProcessState | null
}

export function placeStation(
  stationId: string, stationType: StationTypeId, areaId: string, anchor: FootprintTile, ownerId: string | null = null,
): PlacedStation {
  return { stationId, stationType, areaId, anchor, ownerId, process: null }
}

/** The definition behind this station, or null if the type is unknown. */
export const definitionOf = (station: PlacedStation): StationDefinition | null => stationDefinition(station.stationType)

/** The tiles this station occupies. Throws on an unknown type rather than answering "none". */
export function stationTiles(station: PlacedStation): FootprintTile[] {
  const definition = definitionOf(station)
  if (!definition) throw new RangeError(`unknown station type: ${station.stationType}`)
  return footprintTiles(definition.footprint, station.anchor)
}

/** True when this station stands on that tile of that area. */
export function stationCovers(station: PlacedStation, areaId: string, tx: number, ty: number): boolean {
  const definition = definitionOf(station)
  if (!definition || station.areaId !== areaId) return false
  return footprintCovers(definition.footprint, station.anchor, tx, ty)
}

/** The tiles a player may stand on to use it: the orthogonal ring around the whole footprint. */
export function stationApproaches(station: PlacedStation): FootprintTile[] {
  const definition = definitionOf(station)
  if (!definition) throw new RangeError(`unknown station type: ${station.stationType}`)
  return footprintRing(definition.footprint, station.anchor)
}

/**
 * True when a player standing on `(tx, ty)` is close enough to use it.
 *
 * Reach is a property of the station (`interactionReach`), measured from the
 * whole footprint — which is the multi-tile part that a 1×1 world never had to
 * answer: standing beside the far corner of a 2×2 furnace is standing beside
 * the furnace, even though it is two tiles from the anchor.
 */
export function canInteractFrom(station: PlacedStation, tx: number, ty: number): boolean {
  const definition = definitionOf(station)
  if (!definition) return false
  if (footprintCovers(definition.footprint, station.anchor, tx, ty)) return false
  const near = nearestFootprintTile(definition.footprint, station.anchor, tx, ty)
  return Math.abs(near.tx - tx) + Math.abs(near.ty - ty) <= definition.interactionReach
}

export const stationState = (station: PlacedStation): StationPhase => stationPhase(station.process)

/** Moves a WORKING station to DONE if its time is up. Pure, idempotent, and safe on every frame. */
export function advanceStation(station: PlacedStation, nowMs: number): PlacedStation {
  const process = advanceProcess(station.process, nowMs)
  return process === station.process ? station : { ...station, process }
}

export const withProcess = (station: PlacedStation, process: StationProcessState | null): PlacedStation =>
  ({ ...station, process })
