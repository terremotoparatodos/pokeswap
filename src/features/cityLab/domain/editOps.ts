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
  anchorOf, collisionTilesOf, inBounds, isTreeProp, tilesOf, type EntityRef, type LabCity, type LabGate, type LabProp, type LabPropKind, type TerrainKind,
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

/** The lowest `<prefix>-N` id not used by any entity, so ids stay short and deterministic. */
export function nextNewId(city: LabCity, prefix = 'new'): string {
  const used = new Set<string>([
    ...city.props, ...city.wanderers, ...city.residents, ...city.buildings, ...city.fountains, ...city.gates,
  ].map(x => x.id))
  let n = 1
  while (used.has(`${prefix}-${n}`)) n++
  return `${prefix}-${n}`
}

/**
 * Where a prop added at the cursor tile goes: a tree puts its trunk (left
 * half) under the cursor, so its 2×2 cell starts one row up.
 */
export function addAnchor(kind: LabPropKind, at: Tile): Tile {
  return isTreeProp(kind) ? { tx: at.tx, ty: at.ty - 1 } : at
}

/** Adds a prop whose anchor (see `addAnchor`) is the cursor tile. */
export function addProp(base: TownDef, city: LabCity, kind: LabPropKind, cursor: Tile): EditResult {
  if (!inBounds(city, cursor.tx, cursor.ty)) return refused('Fuera de los límites del mapa.')
  const at = addAnchor(kind, cursor)
  const prop: LabProp = { id: nextNewId(city), kind, tx: at.tx, ty: at.ty, ...(kind === 'sign' ? { text: 'Cartel nuevo' } : {}) }
  return settle(base, { ...city, props: [...city.props, prop] }, { type: 'prop', id: prop.id })
}

export function addWanderer(base: TownDef, city: LabCity, at: Tile): EditResult {
  const id = nextNewId(city, 'wanderer-new')
  return settle(base, { ...city, wanderers: [...city.wanderers, { id, tx: at.tx, ty: at.ty }] }, { type: 'wanderer', id })
}

/** Everything but the spawn: a town always has exactly one. */
export function canDelete(ref: EntityRef): boolean {
  return ref.type !== 'spawn'
}

const inside = (t: Tile, b: { x: number; y: number; w: number; d: number }, margin = 0) =>
  t.tx >= b.x - margin && t.tx < b.x + b.w + margin && t.ty >= b.y - margin && t.ty < b.y + b.d + margin

/** What stops working in the game when `ref` disappears (the edit still goes through). */
export function deletionWarnings(city: LabCity, ref: EntityRef): string[] {
  const out: string[] = []
  if (ref.type === 'building') {
    const b = city.buildings.find(x => x.id === ref.id)
    if (!b) return out
    if (b.feature) out.push(`${b.name} era la ENTRADA a "${b.feature}": esa función queda sin puerta en la ciudad.`)
    for (const g of city.gates) {
      if (g.tiles.some(t => inside(t, b, 1))) out.push(`El portal "${g.label}" queda sin edificio: sigue funcionando, pero sin arte que lo marque.`)
    }
  }
  if (ref.type === 'gate' || ref.type === 'arrival') {
    const g = city.gates.find(x => x.id === ref.id)
    if (g) out.push(`Se borra la SALIDA "${g.label}" y su llegada: ese mundo queda sin acceso desde la ciudad y quien vuelva de él aparece en el spawn.`)
  }
  return out
}

export function deleteEntity(city: LabCity, ref: EntityRef): EditResult {
  if (!canDelete(ref)) return refused('El PLAYER SPAWN no se borra: la ciudad necesita uno. Movelo.')
  const warnings = deletionWarnings(city, ref)
  const gateId = ref.type === 'arrival' ? ref.id : ref.type === 'gate' ? ref.id : null
  const next: LabCity = {
    ...city,
    props: ref.type === 'prop' ? city.props.filter(p => p.id !== ref.id) : city.props,
    residents: ref.type === 'resident' ? city.residents.filter(r => r.id !== ref.id) : city.residents,
    wanderers: ref.type === 'wanderer' ? city.wanderers.filter(w => w.id !== ref.id) : city.wanderers,
    buildings: ref.type === 'building' ? city.buildings.filter(b => b.id !== ref.id) : city.buildings,
    fountains: ref.type === 'fountain' ? city.fountains.filter(f => f.id !== ref.id) : city.fountains,
    gates: gateId ? city.gates.filter(g => g.id !== gateId) : city.gates,
  }
  const count = (c: LabCity) => c.props.length + c.residents.length + c.wanderers.length + c.buildings.length + c.fountains.length + c.gates.length
  if (count(next) === count(city)) return refused('La entidad no existe.')
  return { ok: true, city: next, ref: null, warnings }
}

export const canDuplicate = canDelete

const ID_PREFIX: Record<EntityRef['type'], string> = {
  prop: 'new', resident: 'resident-new', wanderer: 'wanderer-new', building: 'building-new',
  fountain: 'fountain-new', gate: 'gate-new', arrival: 'gate-new', spawn: 'spawn',
}

/** The copy of `ref` with id `id`, moved by (dx, dy). */
function copyOf(city: LabCity, ref: EntityRef, id: string, dx: number, dy: number): LabCity {
  switch (ref.type) {
    case 'prop': {
      const p = city.props.find(x => x.id === ref.id)!
      // The activity board stays unique: a copied board is a plain sign.
      const copy: LabProp = { id, kind: p.kind, tx: p.tx + dx, ty: p.ty + dy, ...(p.text !== undefined ? { text: p.text } : {}) }
      return { ...city, props: [...city.props, copy] }
    }
    case 'resident': {
      const r = city.residents.find(x => x.id === ref.id)!
      return { ...city, residents: [...city.residents, { ...r, id, tx: r.tx + dx, ty: r.ty + dy }] }
    }
    case 'wanderer': {
      const w = city.wanderers.find(x => x.id === ref.id)!
      return { ...city, wanderers: [...city.wanderers, { id, tx: w.tx + dx, ty: w.ty + dy }] }
    }
    case 'building': {
      const b = city.buildings.find(x => x.id === ref.id)!
      return {
        ...city,
        buildings: [...city.buildings, {
          ...b, id, x: b.x + dx, y: b.y + dy,
          ...(b.door ? { door: shift(b.door, dx, dy) } : {}),
          ...(b.open ? { open: b.open.map(t => shift(t, dx, dy)) } : {}),
        }],
      }
    }
    case 'fountain': {
      const f = city.fountains.find(x => x.id === ref.id)!
      return { ...city, fountains: [...city.fountains, { id, x0: f.x0 + dx, y0: f.y0 + dy, x1: f.x1 + dx, y1: f.y1 + dy }] }
    }
    case 'gate':
    case 'arrival': {
      const g = city.gates.find(x => x.id === ref.id)!
      return { ...city, gates: [...city.gates, { ...g, id, tiles: g.tiles.map(t => shift(t, dx, dy)), arrival: { ...g.arrival, ...shift(g.arrival, dx, dy) } }] }
    }
    case 'spawn': return city
  }
}

/** Copies an entity onto the nearest spot (ring by ring) where the copy is valid. */
export function duplicateEntity(base: TownDef, city: LabCity, ref: EntityRef): EditResult {
  if (!canDuplicate(ref)) return refused('El PLAYER SPAWN no se duplica: la ciudad tiene uno solo.')
  const from = anchorOf(city, ref)
  if (!from) return refused('La entidad no existe.')
  const type = ref.type === 'arrival' ? 'gate' : ref.type
  const id = nextNewId(city, ID_PREFIX[ref.type])
  const warnings: string[] = []
  const b = ref.type === 'building' ? city.buildings.find(x => x.id === ref.id) : null
  if (b?.feature) warnings.push(`La copia también es ENTRADA a "${b.feature}": hay dos puertas; al cerrar el panel el juego te deja en la primera.`)
  if (type === 'gate') warnings.push('La copia es otra SALIDA al mismo mundo: al volver, el juego usa la llegada del primer portal.')
  // Big things need room: search further away for them.
  const reach = ref.type === 'building' || ref.type === 'fountain' ? 16 : 6
  for (let r = 1; r <= reach; r++) {
    for (const t of ring(from, r)) {
      const result = settle(base, copyOf(city, ref, id, t.tx - from.tx, t.ty - from.ty), { type, id })
      if (result.ok) return { ...result, warnings: [...warnings, ...result.warnings] }
    }
  }
  return refused('No hay lugar libre cerca para la copia.')
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

/** The physical part of that preview (a tree's trunk row; everything else: its whole footprint). */
export function previewSolidTiles(city: LabCity, ref: EntityRef, to: Tile): Tile[] {
  const from = anchorOf(city, ref)
  if (!from) return []
  return collisionTilesOf(city, ref).map(t => shift(t, to.tx - from.tx, to.ty - from.ty))
}

/** Preview for adding `kind` with the cursor on `cursor`: visual cell, physical tiles and validity. */
export function previewAdd(base: TownDef, city: LabCity, kind: LabPropKind, cursor: Tile): { tiles: Tile[]; solid: Tile[]; valid: boolean; reason: string } {
  const result = addProp(base, city, kind, cursor)
  const probe = result.ok ? result.city : { ...city, props: [...city.props, { id: '__preview__', kind, ...addAnchor(kind, cursor) }] }
  const ref: EntityRef = { type: 'prop', id: result.ok && result.ref ? result.ref.id : '__preview__' }
  return {
    tiles: tilesOf(probe, ref),
    solid: collisionTilesOf(probe, ref),
    valid: result.ok,
    reason: result.ok ? result.warnings.join(' ') : result.errors.join(' '),
  }
}
