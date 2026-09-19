// Where a station may stand, and how it is declared to the world (R33).
//
// Two jobs, both pure:
//
//   1. **Validation.** Can this station stand here? Bounds, solid terrain,
//      water, tiles a gathering node already owns, and overlap with anything
//      already placed. The whole footprint is checked, not the anchor — which
//      is the part a 1×1 world never had to answer.
//   2. **Declaration.** Turn the station into the flat record F-1 registers
//      (`PlacedObject`), so collision, navigation and picking all read one
//      source.
//
// It does not build, it does not charge materials and it does not let a player
// place anything: player construction is `O-10` and stays closed (§26 of the
// R33 brief). What exists here is the validation a builder would call, and the
// deterministic spot the demo furnace stands on.
//
// The engine is not imported. Like the Alchemy bench before it (F-1 §11.2), a
// station declares itself **structurally** and the wiring hands the record to
// `placedObject()`, which keeps the R31 isolation rule intact.

import { footprintTiles, type FootprintTile, type StationFootprint } from './stationFootprint'
import { definitionOf, type PlacedStation } from './stationInstance'
import type { StationDefinition } from './stationDefinition'

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

function rejectionFor(port: StationWorldPort, tile: FootprintTile): PlacementRejection | null {
  if (port.outOfBounds?.(tile.tx, tile.ty)) return 'out_of_bounds'
  if (port.isTransition?.(tile.tx, tile.ty)) return 'transition'
  if (port.isSolid(tile.tx, tile.ty)) return 'solid_tile'
  if (port.isWater(tile.tx, tile.ty)) return 'water'
  if (port.hasNode(tile.tx, tile.ty)) return 'node_tile'
  if (port.isOccupied?.(tile.tx, tile.ty)) return 'occupied'
  return null
}

/**
 * A place for a station, searched ring by ring outwards from an anchor.
 *
 * The same idea as the Alchemy bench's spiral (`alchemy/stationPlacement.ts`),
 * generalised to a footprint and to a free ring around it, so the result is
 * deterministic — everyone puts the furnace on the same tile, which is what a
 * server would need to validate it. The bench's own function is untouched: its
 * tile is part of the frozen overlay baseline and must not move.
 *
 * Returns null when the area is too crowded, and then the station simply does
 * not appear.
 */
export function findStationSpot(
  port: StationWorldPort, footprint: StationFootprint, anchor: FootprintTile,
  options: { readonly minRing?: number; readonly maxRing?: number; readonly clearRing?: boolean } = {},
): FootprintTile | null {
  const minRing = options.minRing ?? 4
  const maxRing = options.maxRing ?? 14
  for (let ring = minRing; ring <= maxRing; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue
        const candidate = { tx: anchor.tx + dx, ty: anchor.ty + dy }
        if (!validatePlacement(port, footprint, candidate).ok) continue
        // A station nobody can walk up to is worse than no station: ask for a
        // clear tile all the way round unless the caller says otherwise.
        if (options.clearRing !== false && !ringIsClear(port, footprint, candidate)) continue
        return candidate
      }
    }
  }
  return null
}

function ringIsClear(port: StationWorldPort, footprint: StationFootprint, anchor: FootprintTile): boolean {
  const inside = new Set(footprintTiles(footprint, anchor).map(tile => `${tile.tx}:${tile.ty}`))
  for (const tile of footprintTiles(footprint, anchor)) {
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      const next = { tx: tile.tx + dx, ty: tile.ty + dy }
      if (inside.has(`${next.tx}:${next.ty}`)) continue
      if (rejectionFor(port, next)) return false
    }
  }
  return true
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
