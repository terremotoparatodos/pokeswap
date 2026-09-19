// City Mapping Lab — what a click in EDIT selects (DEV only).
//
// Order, front to back: small art (props, NPCs, the spawn) → ground markers
// (spawn tile, gate stairs, arrival points) → large art (buildings,
// fountains) → whatever occupies the tile under the cursor. Ground markers
// beat buildings so the gate stairs inside the Plaza Amistad art stay
// clickable.

import type { Tile } from '../../wildlands/engine/pathfinding'
import type { CityGrid } from '../domain/cityGrid'
import type { EntityRef, LabCity } from '../domain/labCity'
import { tileAt, type FrameGeometry } from './labProjection'
import { thingAt } from './labOverlay'
import type { DrawnThing } from './labThings'

export function pickEntity(
  f: FrameGeometry, city: LabCity, grid: CityGrid, things: readonly DrawnThing[], cssX: number, cssY: number,
): { ref: EntityRef | null; tile: Tile | null } {
  const sx = cssX * f.dpr
  const sy = cssY * f.dpr
  const tile = tileAt(f, cssX, cssY)
  const small = thingAt(f, things, sx, sy, false)
  if (small?.ref) return { ref: small.ref, tile }
  if (tile) {
    const marker = markerAt(city, tile)
    if (marker) return { ref: marker, tile }
  }
  const large = thingAt(f, things, sx, sy, true)
  if (large?.ref) return { ref: large.ref, tile }
  if (!tile) return { ref: null, tile }
  const npc = city.residents.find(r => r.tx === tile.tx && r.ty === tile.ty)
  if (npc) return { ref: { type: 'resident', id: npc.id }, tile }
  const walker = city.wanderers.find(w => w.tx === tile.tx && w.ty === tile.ty)
  if (walker) return { ref: { type: 'wanderer', id: walker.id }, tile }
  const prop = grid.props(tile.tx, tile.ty)
  if (prop.length) return { ref: { type: 'prop', id: prop[prop.length - 1] }, tile }
  const building = grid.building(tile.tx, tile.ty)
  if (building) return { ref: { type: 'building', id: building }, tile }
  const fountain = grid.fountain(tile.tx, tile.ty)
  if (fountain) return { ref: { type: 'fountain', id: fountain }, tile }
  return { ref: null, tile }
}

function markerAt(city: LabCity, t: Tile): EntityRef | null {
  if (city.spawn.tx === t.tx && city.spawn.ty === t.ty) return { type: 'spawn', id: 'spawn' }
  const arrival = city.gates.find(g => g.arrival.tx === t.tx && g.arrival.ty === t.ty)
  if (arrival) return { type: 'arrival', id: arrival.id }
  const gate = city.gates.find(g => g.tiles.some(x => x.tx === t.tx && x.ty === t.ty))
  if (gate) return { type: 'gate', id: gate.id }
  return null
}
