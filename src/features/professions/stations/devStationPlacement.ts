// Finding somewhere to put a station, for DEV only (R33).
//
// **This is not the placement contract.** A productive or persisted station is
// placed by explicit data (`stationPlacement.ts`); `O-9` is decided that way on
// purpose, because a canonical station whose position is recomputed at runtime
// cannot be validated by a server, cannot be moved, and quietly changes if the
// world generator does.
//
// What a search is good for is *producing* such a record when nobody has
// written one yet: a fixture, a test, or the dev harness that has to put a
// furnace somewhere in a procedural world so a human can walk up to it. That is
// the only caller this module has, and nothing in the productive contract
// imports it — a test asserts that.
//
// The Alchemy bench derives its tile the same way
// (`alchemy/stationPlacement.ts`), which is why the bench is also a prototype
// placement and not a fixed one.

import { footprintTiles, type FootprintTile, type StationFootprint } from './stationFootprint'
import { rejectionFor, validatePlacement, type StationWorldPort } from './stationPlacement'

export interface DevSpotOptions {
  readonly minRing?: number
  readonly maxRing?: number
  /** Demand a free tile all the way round, so the station is reachable. Default true. */
  readonly clearRing?: boolean
}

/**
 * A place for a station, searched ring by ring outwards from an anchor.
 *
 * Deterministic: the same world and the same anchor give the same tile every
 * time, which is what makes the dev harness reproducible. Returns null when the
 * area is too crowded, and then the station simply does not appear.
 */
export function devFindStationSpot(
  port: StationWorldPort, footprint: StationFootprint, anchor: FootprintTile, options: DevSpotOptions = {},
): FootprintTile | null {
  const minRing = options.minRing ?? 4
  const maxRing = options.maxRing ?? 14
  for (let ring = minRing; ring <= maxRing; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue
        const candidate = { tx: anchor.tx + dx, ty: anchor.ty + dy }
        if (!validatePlacement(port, footprint, candidate).ok) continue
        // A station nobody can walk up to is worse than no station.
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
