// City Mapping Lab — edits on the working copy (DEV only).
//
// Every operation is pure: it takes a city and returns a new one (or the
// reasons it refused), sharing everything it did not change. The baseline is
// frozen, so an operation that mutated instead of copying would throw.

import type { TownDef } from '../../wildlands/areas/townArea'
import type { Dir } from '../../wildlands/engine/characters'
import type { Tile } from '../../wildlands/engine/pathfinding'
import { CityGrid } from './cityGrid'
import {
  anchorOf, inBounds, tilesOf, type EntityRef, type LabCity, type LabGate, type LabProp, type LabPropKind, type TerrainKind,
} from './labCity'
import { placementIssues } from './placement'

export type EditResult =
  | { readonly ok: true; readonly city: LabCity; readonly ref: EntityRef | null; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly errors: readonly string[] }

const refused = (...errors: string[]): EditResult => ({ ok: false, errors })

/** Runs the placement rules for `ref` on the candidate city. */
function settle(base: TownDef, city: LabCity, ref: EntityRef): EditResult {
  const issues = placementIssues(new CityGrid(city, base), ref)
  if (issues.errors.length) return { ok: false, errors: issues.errors }
  return { ok: true, city, ref, warnings: issues.warnings }
}

const shift = (t: Tile, dx: number, dy: number): Tile => ({ tx: t.tx + dx, ty: t.ty + dy })

/** Gates whose trigger tiles belong to a building: inside its footprint or touching it. */
function gatesOf(city: LabCity, id: string): LabGate[] {
  const b = city.buildings.find(x => x.id === id)
  if (!b) return []
  return city.gates.filter(g => g.tiles.every(t => t.tx >= b.x - 1 && t.tx <= b.x + b.w && t.ty >= b.y - 1 && t.ty <= b.y + b.d))
}

/** Moves an entity so its anchor (see `anchorOf`) lands on `to`. */
export function moveEntity(base: TownDef, city: LabCity, ref: EntityRef, to: Tile): EditResult {
  const from = anchorOf(city, ref)
  if (!from) return refused('La entidad no existe en la working copy.')
  const dx = to.tx - from.tx
  const dy = to.ty - from.ty
  if (dx === 0 && dy === 0) return { ok: true, city, ref, warnings: [] }
  let next: LabCity
  switch (ref.type) {
    case 'spawn': next = { ...city, spawn: { ...city.spawn, tx: to.tx, ty: to.ty } }; break
    case 'prop': next = { ...city, props: city.props.map(p => (p.id === ref.id ? { ...p, tx: to.tx, ty: to.ty } : p)) }; break
    case 'resident': next = { ...city, residents: city.residents.map(r => (r.id === ref.id ? { ...r, tx: to.tx, ty: to.ty } : r)) }; break
    case 'wanderer': next = { ...city, wanderers: city.wanderers.map(w => (w.id === ref.id ? { ...w, tx: to.tx, ty: to.ty } : w)) }; break
    case 'fountain':
      next = { ...city, fountains: city.fountains.map(f => (f.id === ref.id ? { ...f, x0: f.x0 + dx, x1: f.x1 + dx, y0: f.y0 + dy, y1: f.y1 + dy } : f)) }
      break
    case 'gate':
      // The trigger tiles move together; the arrival point is its own marker.
      next = { ...city, gates: city.gates.map(g => (g.id === ref.id ? { ...g, tiles: g.tiles.map(t => shift(t, dx, dy)) } : g)) }
      break
    case 'arrival':
      next = { ...city, gates: city.gates.map(g => (g.id === ref.id ? { ...g, arrival: { ...g.arrival, tx: to.tx, ty: to.ty } } : g)) }
      break
    case 'building': {
      // A building carries its door, its open tiles and the gates built into it.
      const carried = new Set(gatesOf(city, ref.id).map(g => g.id))
      next = {
        ...city,
        buildings: city.buildings.map(b => (b.id !== ref.id ? b : {
          ...b, x: b.x + dx, y: b.y + dy,
          ...(b.door ? { door: shift(b.door, dx, dy) } : {}),
          ...(b.open ? { open: b.open.map(t => shift(t, dx, dy)) } : {}),
        })),
        gates: city.gates.map(g => (!carried.has(g.id) ? g : {
          ...g, tiles: g.tiles.map(t => shift(t, dx, dy)), arrival: { ...g.arrival, ...shift(g.arrival, dx, dy) },
        })),
      }
      const result = settle(base, next, ref)
      if (!result.ok) return result
      const grid = new CityGrid(next, base)
      const extra = [...carried].flatMap(id => placementIssues(grid, { type: 'arrival', id }).errors.map(e => `Portal arrastrado ${id}: ${e}`))
      return extra.length ? refused(...extra) : result
    }
  }
  return settle(base, next, ref)
}

/** The lowest `new-N` id not yet used, so ids stay short and deterministic. */
export function nextNewId(city: LabCity, prefix = 'new'): string {
  const used = new Set([...city.props, ...city.wanderers, ...city.residents].map(x => x.id))
  let n = 1
  while (used.has(`${prefix}-${n}`)) n++
  return `${prefix}-${n}`
}

export function addProp(base: TownDef, city: LabCity, kind: LabPropKind, at: Tile): EditResult {
  if (!inBounds(city, at.tx, at.ty)) return refused('Fuera de los límites del mapa.')
  const prop: LabProp = { id: nextNewId(city), kind, tx: at.tx, ty: at.ty, ...(kind === 'sign' ? { text: 'Cartel nuevo' } : {}) }
  return settle(base, { ...city, props: [...city.props, prop] }, { type: 'prop', id: prop.id })
}

export function addWanderer(base: TownDef, city: LabCity, at: Tile): EditResult {
  const id = nextNewId(city, 'wanderer-new')
  return settle(base, { ...city, wanderers: [...city.wanderers, { id, tx: at.tx, ty: at.ty }] }, { type: 'wanderer', id })
}

export function canDelete(ref: EntityRef): boolean {
  return ref.type === 'prop' || ref.type === 'resident' || ref.type === 'wanderer'
}

export function deleteEntity(city: LabCity, ref: EntityRef): EditResult {
  if (!canDelete(ref)) return refused('Sólo se pueden borrar objetos, residentes y wanderers (los edificios, portales y el spawn se mueven).')
  const before = city.props.length + city.residents.length + city.wanderers.length
  const next: LabCity = {
    ...city,
    props: ref.type === 'prop' ? city.props.filter(p => p.id !== ref.id) : city.props,
    residents: ref.type === 'resident' ? city.residents.filter(r => r.id !== ref.id) : city.residents,
    wanderers: ref.type === 'wanderer' ? city.wanderers.filter(w => w.id !== ref.id) : city.wanderers,
  }
  if (next.props.length + next.residents.length + next.wanderers.length === before) return refused('La entidad no existe.')
  return { ok: true, city: next, ref: null, warnings: [] }
}

export const canDuplicate = canDelete

/** Copies an entity onto the nearest tile (ring by ring) where the copy is valid. */
export function duplicateEntity(base: TownDef, city: LabCity, ref: EntityRef): EditResult {
  if (!canDuplicate(ref)) return refused('Sólo se pueden duplicar objetos, residentes y wanderers.')
  const from = anchorOf(city, ref)
  if (!from) return refused('La entidad no existe.')
  const id = nextNewId(city, ref.type === 'prop' ? 'new' : `${ref.type}-new`)
  const copyAt = (t: Tile): LabCity => {
    if (ref.type === 'prop') {
      const p = city.props.find(x => x.id === ref.id)!
      return { ...city, props: [...city.props, { ...p, id, tx: t.tx, ty: t.ty, ...(p.board ? { board: false } : {}) }] }
    }
    if (ref.type === 'resident') {
      const r = city.residents.find(x => x.id === ref.id)!
      return { ...city, residents: [...city.residents, { ...r, id, tx: t.tx, ty: t.ty }] }
    }
    return { ...city, wanderers: [...city.wanderers, { id, tx: t.tx, ty: t.ty }] }
  }
  for (let r = 1; r <= 6; r++) {
    for (const t of ring(from, r)) {
      if (!inBounds(city, t.tx, t.ty)) continue
      const result = settle(base, copyAt(t), { type: ref.type, id })
      if (result.ok) return result
    }
  }
  return refused('No hay ningún tile libre cerca para la copia.')
}

/** Tiles at Chebyshev distance `r`, starting to the right and going clockwise. */
function ring(c: Tile, r: number): Tile[] {
  const out: Tile[] = []
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) out.push(shift(c, dx, dy))
  return out.sort((a, b) => dist(a, c) - dist(b, c) || a.ty - b.ty || a.tx - b.tx)
}

const dist = (a: Tile, b: Tile) => Math.abs(a.tx - b.tx) + Math.abs(a.ty - b.ty)

/** Paints terrain; no placement rules (Validate Map reports what it breaks). */
export function paintTerrain(city: LabCity, tiles: readonly Tile[], kind: TerrainKind): LabCity {
  const rows = new Map<number, string[]>()
  for (const t of tiles) {
    if (!inBounds(city, t.tx, t.ty) || city.terrain[t.ty][t.tx] === kind) continue
    let row = rows.get(t.ty)
    if (!row) rows.set(t.ty, (row = city.terrain[t.ty].split('')))
    row[t.tx] = kind
  }
  if (!rows.size) return city
  return { ...city, terrain: city.terrain.map((row, ty) => rows.get(ty)?.join('') ?? row) }
}

/** Square brush of side `size` (1 or 3) centred on a tile. */
export function brushTiles(center: Tile, size: number): Tile[] {
  const r = Math.floor(size / 2)
  const out: Tile[] = []
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) out.push(shift(center, dx, dy))
  return out
}

export function setSignText(city: LabCity, id: string, text: string): LabCity {
  return { ...city, props: city.props.map(p => (p.id === id && p.kind === 'sign' ? { ...p, text } : p)) }
}

export function setFacing(city: LabCity, ref: EntityRef, dir: Dir): LabCity {
  if (ref.type === 'spawn') return { ...city, spawn: { ...city.spawn, dir } }
  if (ref.type === 'resident') return { ...city, residents: city.residents.map(r => (r.id === ref.id ? { ...r, dir } : r)) }
  if (ref.type === 'arrival') return { ...city, gates: city.gates.map(g => (g.id === ref.id ? { ...g, arrival: { ...g.arrival, dir } } : g)) }
  return city
}

/** Footprint of `ref` if it were moved so its anchor sits on `to` (drag preview). */
export function previewTiles(city: LabCity, ref: EntityRef, to: Tile): Tile[] {
  const from = anchorOf(city, ref)
  if (!from) return []
  return tilesOf(city, ref).map(t => shift(t, to.tx - from.tx, to.ty - from.ty))
}
