// City Mapping Lab — the editable form of a town (DEV only).
//
// WildLands towns are plain data: a `TownDef` (areas/hearthome.ts) that the
// real `TownArea` turns into collision, baked ground and sprites. The lab
// edits a copy of that data and never the module it came from.
//
// `TownDef` lists props without ids, so the lab gives every record a stable id
// derived from what it *is* in the baseline (`lamp@8,15`, `gym`, `gate-tundra`)
// rather than where it sits in an array. Ids are what the exported patch talks
// about, so they must survive a reordering of the source lists.

import type { TownBuilding, TownDef, TownGate, TownProp, TownResident } from '../../wildlands/areas/townArea'
import type { Arrival } from '../../wildlands/engine/area'
import type { Tile } from '../../wildlands/engine/pathfinding'
import type { TileRect } from '../../wildlands/engine/townGround'
import type { TownPropKind } from '../../wildlands/engine/townProps'
import type { DecorKind } from '../../wildlands/engine/world'
import { isCityTreeId, treeCollisionTiles, treeVisualTiles, type CityTreeId } from '../../worldAssets/trees/cityTrees'

/** Terrain letters a town grid understands (see hearthomeTerrain.ts). */
export type TerrainKind = 's' | 'g' | 'p' | 't'
export const TERRAIN_KINDS: readonly TerrainKind[] = ['s', 'g', 'p', 't']

/** Street furniture a `TownDef` can hold (`spray` is the fountain's own jet, not a prop). */
export type StreetPropKind = Exclude<TownPropKind, 'spray'>
export const STREET_PROP_KINDS: readonly StreetPropKind[] = ['lamp', 'sign', 'bench', 'hedge', 'fenceH', 'fenceV']

/**
 * Anything the palette can place: street furniture, one of the world's own
 * props (rocks, crystals…), or a city tree (worldAssets/trees). The last two
 * families have no slot in `TownDef` today; the lab draws them through
 * `LabTownArea` and the patch flags them.
 */
export type LabPropKind = StreetPropKind | DecorKind | CityTreeId

/** A placed city tree: its `tx, ty` is the top-left tile of its 2×2 cell. */
export function isTreeProp(kind: LabPropKind): kind is CityTreeId {
  return isCityTreeId(kind)
}

export function isStreetProp(kind: LabPropKind): kind is StreetPropKind {
  return (STREET_PROP_KINDS as readonly string[]).includes(kind)
}

export interface LabProp {
  readonly id: string
  readonly kind: LabPropKind
  readonly tx: number
  readonly ty: number
  readonly text?: string
  readonly board?: boolean
  /** Informational in exported patches: the tile cell a tree covers (always 2×2 today). */
  readonly footprint?: { readonly w: number; readonly d: number }
}

export interface LabFountain extends TileRect {
  readonly id: string
}

export interface LabGate extends TownGate {
  readonly id: string
}

export interface LabResident extends TownResident {
  readonly id: string
}

export interface LabWanderer extends Tile {
  readonly id: string
}

export interface LabCity {
  readonly terrain: readonly string[]
  readonly props: readonly LabProp[]
  readonly buildings: readonly TownBuilding[]
  readonly fountains: readonly LabFountain[]
  readonly gates: readonly LabGate[]
  readonly spawn: Arrival
  readonly residents: readonly LabResident[]
  readonly wanderers: readonly LabWanderer[]
}

export type EntityType = 'prop' | 'building' | 'fountain' | 'gate' | 'arrival' | 'spawn' | 'resident' | 'wanderer'

/** What the editor has selected. `spawn` has the single id `spawn`. */
export interface EntityRef {
  readonly type: EntityType
  readonly id: string
}

export const SPAWN_REF: EntityRef = { type: 'spawn', id: 'spawn' }

export const propKey = (kind: string, tx: number, ty: number) => `${kind}@${tx},${ty}`

/** Baseline city → editable city, with ids. Pure: `def` is never touched. */
export function fromTownDef(def: TownDef): LabCity {
  const seen = new Map<string, number>()
  const props = def.props.map(p => {
    const base = propKey(p.kind, p.tx, p.ty)
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    const prop: LabProp = { id: count === 1 ? base : `${base}#${count}`, kind: p.kind as StreetPropKind, tx: p.tx, ty: p.ty }
    return {
      ...prop,
      ...(p.text !== undefined ? { text: p.text } : {}),
      ...(p.board ? { board: true } : {}),
    }
  })
  return {
    terrain: [...def.terrain],
    props,
    buildings: def.buildings.map(cloneBuilding),
    fountains: def.fountains.map((f, i) => ({ id: `fountain-${i}`, x0: f.x0, y0: f.y0, x1: f.x1, y1: f.y1 })),
    gates: def.gates.map(g => ({ ...cloneGate(g), id: `gate-${g.to}` })),
    spawn: { ...def.spawn },
    residents: def.residents.map((r, i) => ({ id: `resident-${i}`, tx: r.tx, ty: r.ty, dir: r.dir, lines: [...r.lines] })),
    wanderers: def.wanderers.map((w, i) => ({ id: `wanderer-${i}`, tx: w.tx, ty: w.ty })),
  }
}

function cloneBuilding(b: TownBuilding): TownBuilding {
  return {
    ...b,
    ...(b.open ? { open: b.open.map(t => ({ tx: t.tx, ty: t.ty })) } : {}),
    ...(b.door ? { door: { tx: b.door.tx, ty: b.door.ty } } : {}),
    ...(b.image ? { image: { ...b.image } } : {}),
  }
}

function cloneGate(g: TownGate): TownGate {
  return { ...g, tiles: g.tiles.map(t => ({ tx: t.tx, ty: t.ty })), arrival: { ...g.arrival } }
}

/**
 * Editable city → the `TownDef` the real engine consumes. Everything the lab
 * does not edit (name, art, plots, plaza zones, lens) comes from `base`.
 * World props are left out: `TownDef` has no slot for them (see `labDecor`).
 */
export function toTownDef(city: LabCity, base: TownDef): TownDef {
  const props: TownProp[] = city.props.filter(p => isStreetProp(p.kind)).map(p => ({
    kind: p.kind as StreetPropKind, tx: p.tx, ty: p.ty,
    ...(p.text !== undefined ? { text: p.text } : {}),
    ...(p.board ? { board: true } : {}),
  }))
  return {
    ...base,
    terrain: city.terrain,
    props,
    buildings: city.buildings,
    fountains: city.fountains.map(({ x0, y0, x1, y1 }) => ({ x0, y0, x1, y1 })),
    gates: city.gates.map((g): TownGate => ({ to: g.to, label: g.label, tiles: g.tiles, arrival: g.arrival, ...(g.pad !== undefined ? { pad: g.pad } : {}) })),
    spawn: city.spawn,
    residents: city.residents.map((r): TownResident => ({ tx: r.tx, ty: r.ty, dir: r.dir, lines: r.lines })),
    wanderers: city.wanderers.map(({ tx, ty }) => ({ tx, ty })),
  }
}

/** World props placed in the lab (rocks, crystals…), which `TownDef` cannot hold yet. */
export function labDecor(city: LabCity): readonly (LabProp & { kind: DecorKind })[] {
  return city.props.filter((p): p is LabProp & { kind: DecorKind } => !isStreetProp(p.kind) && !isTreeProp(p.kind))
}

/** City trees placed in the lab, which `TownDef` cannot hold yet either. */
export function labTrees(city: LabCity): readonly (LabProp & { kind: CityTreeId })[] {
  return city.props.filter((p): p is LabProp & { kind: CityTreeId } => isTreeProp(p.kind))
}

/** Tiles an entity physically blocks or claims: a tree's trunk row, everything else as `tilesOf`. */
export function collisionTilesOf(city: LabCity, ref: EntityRef): Tile[] {
  if (ref.type === 'prop') {
    const p = city.props.find(x => x.id === ref.id)
    if (p && isTreeProp(p.kind)) return treeCollisionTiles(p.kind, p.tx, p.ty)
  }
  return tilesOf(city, ref)
}

export function cityWidth(city: LabCity): number {
  return city.terrain[0]?.length ?? 0
}

export function cityHeight(city: LabCity): number {
  return city.terrain.length
}

export function inBounds(city: LabCity, tx: number, ty: number): boolean {
  return tx >= 0 && ty >= 0 && tx < cityWidth(city) && ty < cityHeight(city)
}

export function terrainAt(city: LabCity, tx: number, ty: number): TerrainKind | null {
  return inBounds(city, tx, ty) ? (city.terrain[ty][tx] as TerrainKind) : null
}

/** Recursively freezes the baseline so an accidental mutation throws in DEV and in tests. */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value as object)) deepFreeze((value as Record<string, unknown>)[key])
  }
  return value
}

/** The tile an entity is dragged by: what "move to (tx, ty)" means for it. */
export function anchorOf(city: LabCity, ref: EntityRef): Tile | null {
  switch (ref.type) {
    case 'spawn': return { tx: city.spawn.tx, ty: city.spawn.ty }
    case 'prop': return pick(city.props, ref.id)
    case 'resident': return pick(city.residents, ref.id)
    case 'wanderer': return pick(city.wanderers, ref.id)
    case 'building': {
      const b = city.buildings.find(x => x.id === ref.id)
      return b ? { tx: b.x, ty: b.y } : null
    }
    case 'fountain': {
      const f = city.fountains.find(x => x.id === ref.id)
      return f ? { tx: f.x0, ty: f.y0 } : null
    }
    case 'gate': {
      const g = city.gates.find(x => x.id === ref.id)
      return g ? { ...g.tiles[0] } : null
    }
    case 'arrival': {
      const g = city.gates.find(x => x.id === ref.id)
      return g ? { tx: g.arrival.tx, ty: g.arrival.ty } : null
    }
  }
}

function pick(list: readonly (Tile & { id: string })[], id: string): Tile | null {
  const found = list.find(x => x.id === id)
  return found ? { tx: found.tx, ty: found.ty } : null
}

/** Every tile an entity covers (its footprint), for overlays and overlap checks. */
export function tilesOf(city: LabCity, ref: EntityRef): Tile[] {
  if (ref.type === 'building') {
    const b = city.buildings.find(x => x.id === ref.id)
    return b ? rectTiles(b.x, b.y, b.x + b.w - 1, b.y + b.d - 1) : []
  }
  if (ref.type === 'fountain') {
    const f = city.fountains.find(x => x.id === ref.id)
    return f ? rectTiles(f.x0, f.y0, f.x1, f.y1) : []
  }
  if (ref.type === 'gate') return city.gates.find(x => x.id === ref.id)?.tiles.map(t => ({ ...t })) ?? []
  if (ref.type === 'prop') {
    const p = city.props.find(x => x.id === ref.id)
    if (p && isTreeProp(p.kind)) return treeVisualTiles(p.kind, p.tx, p.ty)
  }
  const at = anchorOf(city, ref)
  return at ? [at] : []
}

export function rectTiles(x0: number, y0: number, x1: number, y1: number): Tile[] {
  const out: Tile[] = []
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) out.push({ tx, ty })
  return out
}

export function sameRef(a: EntityRef | null, b: EntityRef | null): boolean {
  return !!a && !!b && a.type === b.type && a.id === b.id
}

export function entityExists(city: LabCity, ref: EntityRef): boolean {
  return anchorOf(city, ref) !== null
}
