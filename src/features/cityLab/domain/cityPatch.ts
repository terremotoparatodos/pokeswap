// City Mapping Lab — patch export/import (DEV only).
//
// A patch is the *difference* between the baseline city and the working copy,
// as plain JSON meant to be read by a person before anything is applied to
// `hearthome.ts`. It never writes anything itself.
//
// Determinism: every list is sorted by id (or by tile for terrain) and every
// object is built with a fixed key order, so the same working copy always
// serialises to the same bytes.
//
// Round trip: `applyPatch(baseline, diffCities(baseline, copy))` rebuilds a
// city equal to `copy` (tested). Moves and changes carry the baseline value
// they started from, so applying a patch to a baseline that has since changed
// reports a conflict instead of silently overwriting someone else's edit.

import type { TownBuilding } from '../../wildlands/areas/townArea'
import type { Arrival } from '../../wildlands/engine/area'
import type { Dir } from '../../wildlands/engine/characters'
import type { Tile } from '../../wildlands/engine/pathfinding'
import {
  isStreetProp, isTreeProp, TERRAIN_KINDS, type LabCity, type LabFountain, type LabGate, type LabProp, type LabResident, type LabWanderer, type TerrainKind,
} from './labCity'

export const PATCH_FORMAT = 'wildlands-city-patch'
export const PATCH_VERSION = 3
/**
 * v1 had no added/removed lists for buildings, fountains and gates; v2 had no
 * `buildings.modified`. Both still import.
 */
const OLDEST_VERSION = 1

interface Moved<T> { id: string; from: T; to: T }
type XY = { tx: number; ty: number }

export interface CityPatch {
  format: typeof PATCH_FORMAT
  version: typeof PATCH_VERSION
  city: string
  /** FNV-1a of the canonical baseline: tells whether the patch was made against this baseline. */
  baseline: string
  props: {
    added: LabProp[]
    removed: LabProp[]
    moved: Moved<XY>[]
    modified: { id: string; from: { text?: string; board?: boolean }; to: { text?: string; board?: boolean } }[]
  }
  terrain: { tx: number; ty: number; from: TerrainKind; to: TerrainKind }[]
  spawn: { from: Arrival; to: Arrival } | null
  buildings: {
    added: TownBuilding[]
    removed: TownBuilding[]
    moved: Moved<{ x: number; y: number; door?: Tile; open?: Tile[] }>[]
    /** Name, text, function, look or size of a baseline building. */
    modified: { id: string; from: BuildingLook; to: BuildingLook }[]
  }
  fountains: { added: LabFountain[]; removed: LabFountain[]; moved: Moved<{ x0: number; y0: number; x1: number; y1: number }>[] }
  gates: { added: LabGate[]; removed: LabGate[]; moved: Moved<{ tiles: Tile[]; arrival: Arrival }>[] }
  residents: { added: LabResident[]; removed: LabResident[]; moved: Moved<{ tx: number; ty: number; dir: Dir }>[] }
  wanderers: { added: LabWanderer[]; removed: LabWanderer[]; moved: Moved<XY>[] }
  /**
   * True when the copy uses something production `TownDef` cannot hold yet
   * (world props, city trees). The patch still describes it; applying it needs
   * schema support first, which the main station decides.
   */
  requiresProductionSchemaSupport: boolean
  /** Things the production town cannot express yet; the main station decides. */
  notes: string[]
}

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const xy = (t: Tile): XY => ({ tx: t.tx, ty: t.ty })
const arrival = (a: Arrival): Arrival => ({ tx: a.tx, ty: a.ty, dir: a.dir })
const tiles = (list: readonly Tile[]): Tile[] => list.map(xy)

/** A tree references its canonical asset by id (`kind`) and says what cell it covers; never pixels. */
function canonicalProp(p: LabProp): LabProp {
  return {
    id: p.id, kind: p.kind, tx: p.tx, ty: p.ty,
    ...(p.text !== undefined ? { text: p.text } : {}),
    ...(p.board ? { board: true } : {}),
    ...(isTreeProp(p.kind) ? { footprint: { w: 2, d: 2 } } : {}),
  }
}

const canonicalResident = (r: LabResident): LabResident => ({ id: r.id, tx: r.tx, ty: r.ty, dir: r.dir, lines: [...r.lines] })
const canonicalWanderer = (w: LabWanderer): LabWanderer => ({ id: w.id, tx: w.tx, ty: w.ty })

function buildingPlace(b: TownBuilding) {
  return { x: b.x, y: b.y, ...(b.door ? { door: xy(b.door) } : {}), ...(b.open ? { open: tiles(b.open) } : {}) }
}

/** A building's art in a fixed key order: its PNG, roof line and 3D model. */
function canonicalImage(i: NonNullable<TownBuilding['image']>): NonNullable<BuildingLook['image']> {
  return { src: i.src, ...(i.flatTop !== undefined ? { flatTop: i.flatTop } : {}), ...(i.model !== undefined ? { model: i.model } : {}) }
}

/** What a building is, apart from where it stands (see `buildingPlace`). */
export interface BuildingLook {
  name: string
  style: TownBuilding['style']
  w: number
  d: number
  feature?: TownBuilding['feature']
  blurb?: string
  image?: { src: string; flatTop?: number | 'all'; model?: string }
}

function buildingLook(b: TownBuilding): BuildingLook {
  return {
    name: b.name, style: b.style, w: b.w, d: b.d,
    ...(b.feature ? { feature: b.feature } : {}),
    ...(b.blurb !== undefined ? { blurb: b.blurb } : {}),
    ...(b.image ? { image: canonicalImage(b.image) } : {}),
  }
}

/** Full record in a fixed key order (added/removed entries must be reviewable on their own). */
function canonicalBuilding(b: TownBuilding): TownBuilding {
  return {
    id: b.id, name: b.name, style: b.style, x: b.x, y: b.y, w: b.w, d: b.d,
    ...(b.door ? { door: xy(b.door) } : {}),
    ...(b.open ? { open: tiles(b.open) } : {}),
    ...(b.feature ? { feature: b.feature } : {}),
    ...(b.blurb !== undefined ? { blurb: b.blurb } : {}),
    ...(b.image ? { image: canonicalImage(b.image) } : {}),
  }
}

const canonicalFountain = (f: LabFountain): LabFountain => ({ id: f.id, x0: f.x0, y0: f.y0, x1: f.x1, y1: f.y1 })

function canonicalGate(g: LabGate): LabGate {
  return { id: g.id, to: g.to, label: g.label, tiles: tiles(g.tiles), arrival: arrival(g.arrival), ...(g.pad !== undefined ? { pad: g.pad } : {}) }
}

const fountainPlace = (f: LabFountain) => ({ x0: f.x0, y0: f.y0, x1: f.x1, y1: f.y1 })
const gatePlace = (g: LabGate) => ({ tiles: tiles(g.tiles), arrival: arrival(g.arrival) })
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** 32-bit FNV-1a over the canonical JSON of a city. */
export function fingerprint(city: LabCity): string {
  const text = JSON.stringify({
    terrain: city.terrain,
    props: [...city.props].sort(byId).map(canonicalProp),
    buildings: [...city.buildings].sort(byId).map(b => ({ id: b.id, ...buildingPlace(b), w: b.w, d: b.d })),
    fountains: [...city.fountains].sort(byId).map(f => ({ id: f.id, ...fountainPlace(f) })),
    gates: [...city.gates].sort(byId).map(g => ({ id: g.id, ...gatePlace(g) })),
    spawn: arrival(city.spawn),
    residents: [...city.residents].sort(byId).map(canonicalResident),
    wanderers: [...city.wanderers].sort(byId).map(canonicalWanderer),
  })
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

function diffList<T extends { id: string }, P>(base: readonly T[], work: readonly T[], place: (x: T) => P) {
  const before = new Map(base.map(x => [x.id, x]))
  const after = new Map(work.map(x => [x.id, x]))
  const added = work.filter(x => !before.has(x.id)).sort(byId)
  const removed = base.filter(x => !after.has(x.id)).sort(byId)
  const moved: Moved<P>[] = []
  for (const x of [...work].sort(byId)) {
    const old = before.get(x.id)
    if (old && !same(place(old), place(x))) moved.push({ id: x.id, from: place(old), to: place(x) })
  }
  return { added, removed, moved }
}

function canonicalDiff<T extends { id: string }, P>(d: { added: T[]; removed: T[]; moved: Moved<P>[] }, canon: (x: T) => T) {
  return { added: d.added.map(canon), removed: d.removed.map(canon), moved: d.moved }
}

function buildingEdits(base: readonly TownBuilding[], work: readonly TownBuilding[]): CityPatch['buildings']['modified'] {
  const before = new Map(base.map(b => [b.id, b]))
  const out: CityPatch['buildings']['modified'] = []
  for (const b of [...work].sort(byId)) {
    const old = before.get(b.id)
    if (old && !same(buildingLook(old), buildingLook(b))) out.push({ id: b.id, from: buildingLook(old), to: buildingLook(b) })
  }
  return out
}

/** The working copy as a difference from the baseline. */
export function diffCities(base: LabCity, work: LabCity, cityId: string): CityPatch {
  const props = diffList(base.props, work.props, xy)
  const modified: CityPatch['props']['modified'] = []
  const baseProps = new Map(base.props.map(p => [p.id, p]))
  for (const p of [...work.props].sort(byId)) {
    const old = baseProps.get(p.id)
    if (!old) continue
    const from = { ...(old.text !== undefined ? { text: old.text } : {}), ...(old.board ? { board: true } : {}) }
    const to = { ...(p.text !== undefined ? { text: p.text } : {}), ...(p.board ? { board: true } : {}) }
    if (!same(from, to)) modified.push({ id: p.id, from, to })
  }

  const terrain: CityPatch['terrain'] = []
  for (let ty = 0; ty < work.terrain.length; ty++) {
    for (let tx = 0; tx < work.terrain[ty].length; tx++) {
      const from = base.terrain[ty]?.[tx] as TerrainKind
      const to = work.terrain[ty][tx] as TerrainKind
      if (from !== to) terrain.push({ tx, ty, from, to })
    }
  }

  const residents = diffList(base.residents, work.residents, r => ({ tx: r.tx, ty: r.ty, dir: r.dir }))
  const wanderers = diffList(base.wanderers, work.wanderers, xy)
  const decorAdded = props.added.filter(p => !isStreetProp(p.kind) && !isTreeProp(p.kind))
  const treesAdded = props.added.filter(p => isTreeProp(p.kind))
  const notes: string[] = []
  if (decorAdded.length) {
    notes.push(`${decorAdded.length} objeto(s) del mundo procedural (${[...new Set(decorAdded.map(p => p.kind))].sort().join(', ')}): TownDef todavía no tiene slot para ellos; aplicarlos requiere soporte en el motor.`)
  }
  if (treesAdded.length) {
    notes.push(`${treesAdded.length} árbol(es) de ciudad colocados (${[...new Set(treesAdded.map(p => p.kind))].sort().join(', ')}; worldAssets/trees/cityTrees.ts): celda 2×2 desde (tx, ty), tronco en la fila inferior. TownDef no los representa todavía.`)
  }
  if (residents.added.length) notes.push('Residentes duplicados conservan las líneas del original.')

  return {
    format: PATCH_FORMAT,
    version: PATCH_VERSION,
    city: cityId,
    baseline: fingerprint(base),
    props: { added: props.added.map(canonicalProp), removed: props.removed.map(canonicalProp), moved: props.moved, modified },
    terrain,
    spawn: same(arrival(base.spawn), arrival(work.spawn)) ? null : { from: arrival(base.spawn), to: arrival(work.spawn) },
    buildings: { ...canonicalDiff(diffList(base.buildings, work.buildings, buildingPlace), canonicalBuilding), modified: buildingEdits(base.buildings, work.buildings) },
    fountains: canonicalDiff(diffList(base.fountains, work.fountains, fountainPlace), canonicalFountain),
    gates: canonicalDiff(diffList(base.gates, work.gates, gatePlace), canonicalGate),
    residents: { added: residents.added.map(canonicalResident), removed: residents.removed.map(canonicalResident), moved: residents.moved },
    wanderers: { added: wanderers.added.map(canonicalWanderer), removed: wanderers.removed.map(canonicalWanderer), moved: wanderers.moved },
    requiresProductionSchemaSupport: decorAdded.length + treesAdded.length > 0,
    notes,
  }
}

export function serializePatch(patch: CityPatch): string {
  return `${JSON.stringify(patch, null, 2)}\n`
}

export function patchIsEmpty(p: CityPatch): boolean {
  return !p.props.added.length && !p.props.removed.length && !p.props.moved.length && !p.props.modified.length
    && !p.terrain.length && !p.spawn
    && !p.buildings.added.length && !p.buildings.removed.length && !p.buildings.moved.length && !p.buildings.modified.length
    && !p.fountains.added.length && !p.fountains.removed.length && !p.fountains.moved.length
    && !p.gates.added.length && !p.gates.removed.length && !p.gates.moved.length
    && !p.residents.added.length && !p.residents.removed.length && !p.residents.moved.length
    && !p.wanderers.added.length && !p.wanderers.removed.length && !p.wanderers.moved.length
}

export function patchSummary(p: CityPatch): string {
  const parts: [string, number][] = [
    ['props +', p.props.added.length], ['props −', p.props.removed.length], ['props movidos', p.props.moved.length],
    ['props editados', p.props.modified.length], ['tiles de terreno', p.terrain.length], ['spawn', p.spawn ? 1 : 0],
    ['edificios +', p.buildings.added.length], ['edificios −', p.buildings.removed.length], ['edificios movidos', p.buildings.moved.length],
    ['edificios editados', p.buildings.modified.length],
    ['fuentes', p.fountains.added.length + p.fountains.removed.length + p.fountains.moved.length],
    ['portales +', p.gates.added.length], ['portales −', p.gates.removed.length], ['portales movidos', p.gates.moved.length],
    ['residentes', p.residents.added.length + p.residents.removed.length + p.residents.moved.length],
    ['wanderers', p.wanderers.added.length + p.wanderers.removed.length + p.wanderers.moved.length],
  ]
  const used = parts.filter(([, n]) => n > 0)
  return used.length ? used.map(([label, n]) => `${label} ${n}`).join(' · ') : 'sin cambios'
}

export type ApplyResult =
  | { ok: true; city: LabCity; conflicts: string[] }
  | { ok: false; errors: string[] }

/**
 * Baseline + patch → working copy. Structural problems (wrong format, unknown
 * id) fail; a baseline that moved since the patch was made is reported as
 * conflicts and the patch's target values win.
 */
export function applyPatch(base: LabCity, input: unknown): ApplyResult {
  const errors = checkShape(input)
  if (errors.length) return { ok: false, errors }
  const p = upgrade(input as CityPatch)
  const conflicts: string[] = []
  if (p.baseline !== fingerprint(base)) conflicts.push(`El patch se hizo sobre otra baseline (${p.baseline} ≠ ${fingerprint(base)}).`)
  const note = (what: string, from: unknown, now: unknown) => {
    if (!same(from, now)) conflicts.push(`${what}: la baseline ya no coincide con el "from" del patch.`)
  }

  const missing: string[] = []
  const need = <T extends { id: string }>(list: readonly T[], id: string, what: string): T | undefined => {
    const found = list.find(x => x.id === id)
    if (!found) missing.push(`${what} "${id}" no existe en la baseline.`)
    return found
  }

  // Props
  const removed = new Set(p.props.removed.map(x => x.id))
  for (const id of removed) need(base.props, id, 'Prop')
  const movedProps = new Map(p.props.moved.map(m => [m.id, m]))
  const modifiedProps = new Map(p.props.modified.map(m => [m.id, m]))
  for (const m of p.props.moved) { const x = need(base.props, m.id, 'Prop'); if (x) note(m.id, m.from, xy(x)) }
  for (const m of p.props.modified) need(base.props, m.id, 'Prop')
  const props: LabProp[] = base.props.filter(x => !removed.has(x.id)).map(x => {
    const move = movedProps.get(x.id)
    const mod = modifiedProps.get(x.id)
    let next: LabProp = move ? { ...x, tx: move.to.tx, ty: move.to.ty } : x
    if (mod) {
      next = { id: next.id, kind: next.kind, tx: next.tx, ty: next.ty, ...(mod.to.text !== undefined ? { text: mod.to.text } : {}), ...(mod.to.board ? { board: true } : {}) }
    }
    return next
  })
  for (const a of p.props.added) {
    if (base.props.some(x => x.id === a.id)) missing.push(`Prop agregado "${a.id}" choca con un id de la baseline.`)
    props.push(canonicalProp(a))
  }

  // Terrain
  const rows = base.terrain.map(r => r.split(''))
  for (const c of p.terrain) {
    if (!rows[c.ty] || rows[c.ty][c.tx] === undefined) { missing.push(`Terreno (${c.tx}, ${c.ty}) fuera del mapa.`); continue }
    note(`Terreno (${c.tx}, ${c.ty})`, c.from, rows[c.ty][c.tx])
    rows[c.ty][c.tx] = c.to
  }

  // Places
  const place = <T extends { id: string }, P>(list: readonly T[], moves: Moved<P>[], what: string, current: (x: T) => P, apply: (x: T, to: P) => T): T[] => {
    const byKey = new Map(moves.map(m => [m.id, m]))
    for (const m of moves) { const x = need(list, m.id, what); if (x) note(m.id, m.from, current(x)) }
    return list.map(x => (byKey.has(x.id) ? apply(x, byKey.get(x.id)!.to) : x))
  }
  // Collections: removed, then moved, then added (with their full records).
  const collection = <T extends { id: string }, P>(
    list: readonly T[], diff: { added: T[]; removed: T[]; moved: Moved<P>[] }, what: string,
    current: (x: T) => P, move: (x: T, to: P) => T, canon: (x: T) => T,
  ): T[] => {
    const gone = new Set(diff.removed.map(x => x.id))
    for (const id of gone) need(list, id, what)
    const kept = place(list.filter(x => !gone.has(x.id)), diff.moved, what, current, move)
    for (const a of diff.added) if (list.some(x => x.id === a.id)) missing.push(`${what} agregado "${a.id}" choca con un id de la baseline.`)
    return [...kept, ...diff.added.map(canon)]
  }
  const buildings = collection(base.buildings, p.buildings, 'Edificio', buildingPlace, (b, to) => {
    const moved: TownBuilding = { ...b, x: to.x, y: to.y, door: to.door ? xy(to.door) : undefined, open: to.open ? tiles(to.open) : undefined }
    if (!moved.door) delete moved.door
    if (!moved.open) delete moved.open
    return moved
  }, canonicalBuilding)
  // Edited looks: the patch's target record replaces name, text, function, art and size.
  const edits = new Map(p.buildings.modified.map(m => [m.id, m]))
  for (const m of p.buildings.modified) { const x = need(base.buildings, m.id, 'Edificio'); if (x) note(m.id, m.from, buildingLook(x)) }
  const editedBuildings = buildings.map(b => {
    const m = edits.get(b.id)
    if (!m) return b
    const next: TownBuilding = { ...b, name: m.to.name, style: m.to.style, w: m.to.w, d: m.to.d }
    for (const key of ['feature', 'blurb', 'image'] as const) {
      if (m.to[key] === undefined) delete next[key]
      else (next as unknown as Record<string, unknown>)[key] = key === 'image' ? { ...m.to.image } : m.to[key]
    }
    return next
  })
  const fountains = collection(base.fountains, p.fountains, 'Fuente', fountainPlace, (f, to) => ({ ...f, ...to }), canonicalFountain)
  const gates = collection(base.gates, p.gates, 'Portal', gatePlace, (g, to) => ({ ...g, tiles: tiles(to.tiles), arrival: arrival(to.arrival) }), canonicalGate)
  const residents = collection(base.residents, p.residents, 'Residente', r => ({ tx: r.tx, ty: r.ty, dir: r.dir }), (x, to) => ({ ...x, ...to }), canonicalResident)
  const wanderers = collection(base.wanderers, p.wanderers, 'Wanderer', xy, (x, to) => ({ ...x, ...to }), canonicalWanderer)

  if (p.spawn) note('Spawn', p.spawn.from, arrival(base.spawn))
  if (missing.length) return { ok: false, errors: missing }
  return {
    ok: true,
    conflicts,
    city: {
      terrain: rows.map(r => r.join('')),
      props,
      buildings: editedBuildings,
      fountains,
      gates,
      spawn: p.spawn ? arrival(p.spawn.to) : base.spawn,
      residents,
      wanderers,
    },
  }
}

export function parsePatch(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    return { ok: false, error: `JSON inválido: ${(error as Error).message}` }
  }
}

/** Fills the lists a v1 patch did not have, so the rest of the code sees one shape. */
function upgrade(p: CityPatch): CityPatch {
  const fill = <G extends object>(g: G | undefined) => ({ added: [], removed: [], moved: [], ...(g ?? {}) })
  return { ...p, buildings: { modified: [], ...fill(p.buildings) }, fountains: fill(p.fountains), gates: fill(p.gates) }
}

function checkShape(input: unknown): string[] {
  const p = input as Partial<CityPatch> | null
  if (!p || typeof p !== 'object') return ['El patch no es un objeto JSON.']
  if (p.format !== PATCH_FORMAT) return [`Formato desconocido: se esperaba "${PATCH_FORMAT}".`]
  if (typeof p.version !== 'number' || p.version < OLDEST_VERSION || p.version > PATCH_VERSION) {
    return [`Versión ${String(p.version)} no soportada (se esperaba ${OLDEST_VERSION}–${PATCH_VERSION}).`]
  }
  const v2 = p.version >= 2
  const errors: string[] = []
  const lists: [unknown, string][] = [
    [p.props?.added, 'props.added'], [p.props?.removed, 'props.removed'], [p.props?.moved, 'props.moved'], [p.props?.modified, 'props.modified'],
    [p.terrain, 'terrain'], [p.buildings?.moved, 'buildings.moved'], [p.fountains?.moved, 'fountains.moved'], [p.gates?.moved, 'gates.moved'],
    ...(v2 ? [
      [p.buildings?.added, 'buildings.added'], [p.buildings?.removed, 'buildings.removed'],
      [p.fountains?.added, 'fountains.added'], [p.fountains?.removed, 'fountains.removed'],
      [p.gates?.added, 'gates.added'], [p.gates?.removed, 'gates.removed'],
    ] as [unknown, string][] : []),
    ...(p.version >= 3 ? [[p.buildings?.modified, 'buildings.modified']] as [unknown, string][] : []),
    [p.residents?.added, 'residents.added'], [p.residents?.removed, 'residents.removed'], [p.residents?.moved, 'residents.moved'],
    [p.wanderers?.added, 'wanderers.added'], [p.wanderers?.removed, 'wanderers.removed'], [p.wanderers?.moved, 'wanderers.moved'],
  ]
  for (const [value, name] of lists) if (!Array.isArray(value)) errors.push(`Falta la lista "${name}".`)
  for (const c of Array.isArray(p.terrain) ? p.terrain : []) {
    if (!(TERRAIN_KINDS as readonly string[]).includes(c?.to)) errors.push(`Terreno "${String(c?.to)}" desconocido en (${c?.tx}, ${c?.ty}).`)
  }
  return errors
}
