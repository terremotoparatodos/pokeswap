// Where a station stands, as data (R33).
//
// Three jobs, all pure:
//
//   1. **The record.** `StationPlacement` is the explicit placement data a
//      productive or persisted station needs: which area, which tile, which
//      shape, and which station instance. It is a *declaration*, never a
//      derivation.
//   2. **Validation.** May a station stand here? Bounds, solid terrain, water,
//      tiles a gathering node already owns, doors and portals, and overlap with
//      anything already placed. The whole footprint is checked, not the anchor
//      -- which is the part a 1x1 world never had to answer.
//   3. **Declaration to the engine.** Turn it into the flat record F-1
//      registers (`PlacedObject`), so collision, navigation and picking all
//      read one source.
//
// **A canonical station is never positioned by a runtime search.** A spiral out
// from a world's spawn is fine for a fixture or a demo harness, and that is
// where it lives -- `devStationPlacement.ts`, which nothing in this module
// imports. `O-9` is decided: explicit placement data is the contract, and a
// search is a way of *producing* one for DEV, not a way of *being* one.
//
// It does not build and it does not let a player place anything: player
// construction is `O-10` and stays closed. What exists here is the validation a
// builder would call.
//
// The engine is not imported. Like the Alchemy bench before it (F-1 11.2), a
// station declares itself **structurally** and the wiring hands the record to
// `placedObject()`, which keeps the R31 isolation rule intact.

import { footprintTiles, type FootprintCell, type FootprintTile, type StationFootprint } from './stationFootprint'
import { definitionOf, placeStation, type PlacedStation } from './stationInstance'
import { stationDefinition, type StationDefinition, type StationTypeId } from './stationDefinition'

// -- The productive placement record ----------------------------------------

/**
 * Explicit placement data: everything needed to stand a station somewhere,
 * with nothing to recompute.
 *
 * `cells` is carried rather than read back from the definition on purpose. A
 * stored structure has to say what it actually occupies: if a later version
 * makes the furnace 3x2, every furnace already standing must keep its own
 * footprint until something migrates it, and a server has to be able to check
 * a position against the shape that was agreed when it was placed.
 */
export interface StationPlacement {
  /** Identity of this station instance, distinct from its type. */
  readonly stationId: string
  readonly stationType: StationTypeId
  /** Which area or world it stands in. */
  readonly areaId: string
  /** Its front-left tile. */
  readonly anchor: FootprintTile
  /** The shape it occupies, as agreed when it was placed. */
  readonly cells: readonly FootprintCell[]
  readonly ownerId: string | null
}

/** Writes a placement record. Throws on a station type nothing defines. */
export function stationPlacement(
  stationId: string, stationType: StationTypeId, areaId: string, anchor: FootprintTile, ownerId: string | null = null,
): StationPlacement {
  const definition = stationDefinition(stationType)
  if (!definition) throw new RangeError(`unknown station type: ${stationType}`)
  return {
    stationId, stationType, areaId, anchor, ownerId,
    cells: definition.footprint.cells.map(cell => ({ dx: cell.dx, dy: cell.dy })),
  }
}

/** Stands a station up from its placement record: the only productive way in. */
export const stationFromPlacement = (placement: StationPlacement): PlacedStation =>
  placeStation(placement.stationId, placement.stationType, placement.areaId, placement.anchor, placement.ownerId)

/** What the world has to be able to answer before a station may stand somewhere. */
export interface StationWorldPort {
  isSolid(tx: number, ty: number): boolean
  isWater(tx: number, ty: number): boolean
  /** True when a gathering node already owns the tile. */
  hasNode(tx: number, ty: number): boolean
  /** True when the tile is outside the area, when the area has an edge. */
  outOfBounds?(tx: number, ty: number): boolean
  /** True when something already placed covers the tile (F-1's registry). */
  isOccupied?(tx: number, ty: number): boolean
  /** True when the tile is a door threshold or a portal pad; those are never built on. */
  isTransition?(tx: number, ty: number): boolean
}

export type PlacementRejection =
  | 'out_of_bounds' | 'solid_tile' | 'water' | 'node_tile' | 'occupied' | 'transition'

export interface PlacementFailure {
  readonly reason: PlacementRejection
  /** The first tile that failed, so a UI can point at it. */
  readonly tile: FootprintTile
}

export type PlacementCheck =
  | { readonly ok: true; readonly tiles: readonly FootprintTile[] }
  | { readonly ok: false; readonly failure: PlacementFailure }

/** Checks every tile of the footprint, and reports the first one that fails. */
export function validatePlacement(port: StationWorldPort, footprint: StationFootprint, anchor: FootprintTile): PlacementCheck {
  const tiles = footprintTiles(footprint, anchor)
  for (const tile of tiles) {
    const reason = rejectionFor(port, tile)
    if (reason) return { ok: false, failure: { reason, tile } }
  }
  return { ok: true, tiles }
}

export function rejectionFor(port: StationWorldPort, tile: FootprintTile): PlacementRejection | null {
  if (port.outOfBounds?.(tile.tx, tile.ty)) return 'out_of_bounds'
  if (port.isTransition?.(tile.tx, tile.ty)) return 'transition'
  if (port.isSolid(tile.tx, tile.ty)) return 'solid_tile'
  if (port.isWater(tile.tx, tile.ty)) return 'water'
  if (port.hasNode(tile.tx, tile.ty)) return 'node_tile'
  if (port.isOccupied?.(tile.tx, tile.ty)) return 'occupied'
  return null
}

// ── Declaring the station to the world ──────────────────────────────────────

/**
 * The flat record F-1 registers, declared structurally so professions never
 * import the engine. Field for field this is `PlacedObjectSpec`.
 */
export interface StationPlacedObject {
  readonly id: string
  readonly areaId: string
  readonly anchor: FootprintTile
  readonly kind: 'alchemyTable' | 'smelter' | 'campfire' | 'workbench'
  /** The footprint's own cells, so a multi-tile station needs no engine change per station. */
  readonly cells: readonly { readonly dx: number; readonly dy: number }[]
  /**
   * The art's reach for a tap — its declared size, not its footprint. A sprite
   * may overhang the tiles it stands on, and it must never become collision.
   */
  readonly hitbox: { readonly width: number; readonly height: number }
}

/** Describes a placed station the way F-1 wants it. Throws on an unknown station type. */
export function stationPlacedObject(station: PlacedStation): StationPlacedObject {
  const definition = definitionOf(station)
  if (!definition) throw new RangeError(`unknown station type: ${station.stationType}`)
  return placedObjectFor(definition, station.stationId, station.areaId, station.anchor)
}

export function placedObjectFor(
  definition: StationDefinition, id: string, areaId: string, anchor: FootprintTile,
): StationPlacedObject {
  return {
    id,
    areaId,
    anchor,
    kind: definition.id,
    cells: definition.footprint.cells.map(cell => ({ dx: cell.dx, dy: cell.dy })),
    hitbox: { width: definition.art.width, height: definition.art.height },
  }
}
