// City Mapping Lab — Validate Map (DEV only).
//
// Not a solver: a list of evident, actionable problems in a working copy,
// each pointing at the tiles to look at. Collision is the real engine's
// (`CityGrid` → `TownArea`), so "blocked" here means blocked in the game.

import type { TownDef } from '../../wildlands/areas/townArea'
import type { Tile } from '../../wildlands/engine/pathfinding'
import { clearanceMap } from './clearance'
import { CityGrid } from './cityGrid'
import { isSolidKind, propLabel } from './labCatalog'
import { SPAWN_REF, terrainAt, type EntityRef, type LabCity } from './labCity'
import { placementIssues } from './placement'

export type Severity = 'error' | 'warning' | 'info'
export type FindingCategory =
  | 'spawn' | 'portales' | 'npc' | 'objetos' | 'edificios' | 'conectividad' | 'hitbox' | 'multijugador'

export interface Finding {
  readonly severity: Severity
  readonly category: FindingCategory
  readonly code: string
  readonly message: string
  readonly tiles: readonly Tile[]
  readonly ref?: EntityRef
}

/** Walkable pockets smaller than this are listed together as "info". */
const SMALL_POCKET = 6
const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 }

export function validateMap(city: LabCity, base: TownDef): Finding[] {
  const grid = new CityGrid(city, base)
  const out: Finding[] = []
  const add = (f: Finding) => out.push(f)
  const seen = new Set<string>()
  const addOnce = (f: Finding) => {
    const k = `${f.code}|${f.message}`
    if (!seen.has(k)) { seen.add(k); add(f) }
  }

  // Spawn and arrivals.
  const spawn = placementIssues(grid, SPAWN_REF)
  const spawnTile = { tx: city.spawn.tx, ty: city.spawn.ty }
  for (const e of spawn.errors) add({ severity: 'error', category: 'spawn', code: 'SPAWN_INVALID', message: e, tiles: [spawnTile], ref: SPAWN_REF })
  for (const w of spawn.warnings) add({ severity: 'warning', category: 'spawn', code: 'SPAWN_CRAMPED', message: w, tiles: [spawnTile], ref: SPAWN_REF })
  for (const g of city.gates) {
    const ref: EntityRef = { type: 'arrival', id: g.id }
    for (const e of placementIssues(grid, ref).errors) add({ severity: 'error', category: 'portales', code: 'ARRIVAL_INVALID', message: `${g.label}: ${e}`, tiles: [g.arrival], ref })
    for (const e of placementIssues(grid, { type: 'gate', id: g.id }).errors) add({ severity: 'error', category: 'portales', code: 'GATE_CONFLICT', message: `${g.label}: ${e}`, tiles: g.tiles, ref: { type: 'gate', id: g.id } })
  }

  // NPCs (the game silently moves them to the nearest open tile).
  for (const n of [...city.residents.map(r => ({ ...r, type: 'resident' as const })), ...city.wanderers.map(w => ({ ...w, type: 'wanderer' as const }))]) {
    const ref: EntityRef = { type: n.type, id: n.id }
    const issues = placementIssues(grid, ref)
    for (const e of issues.errors) add({ severity: 'error', category: 'npc', code: 'NPC_INVALID', message: e, tiles: [n], ref })
    for (const w of issues.warnings) add({ severity: 'warning', category: 'npc', code: 'NPC_CROWDED', message: w, tiles: [n], ref })
  }

  // Objects: overlaps and blocked entrances.
  for (const p of city.props) {
    const ref: EntityRef = { type: 'prop', id: p.id }
    const issues = placementIssues(grid, ref)
    for (const e of issues.errors) addOnce({ severity: 'error', category: 'objetos', code: 'PROP_CONFLICT', message: `${propLabel(p.kind)} ${p.id}: ${e}`, tiles: [p], ref })
    for (const w of issues.warnings) addOnce({ severity: 'warning', category: 'objetos', code: 'PROP_HIDDEN', message: `${propLabel(p.kind)} ${p.id}: ${w}`, tiles: [p], ref })
    if (!isSolidKind(p.kind)) {
      add({ severity: 'info', category: 'hitbox', code: 'PROP_NOT_SOLID', message: `${propLabel(p.kind)} ${p.id} se dibuja pero se puede atravesar (no es sólido en el motor).`, tiles: [p], ref })
    }
  }
  for (const b of city.buildings) {
    const ref: EntityRef = { type: 'building', id: b.id }
    for (const e of placementIssues(grid, ref).errors) addOnce({ severity: 'error', category: 'edificios', code: 'BUILDING_CONFLICT', message: `${b.name} (${b.id}): ${e}`, tiles: [{ tx: b.x, ty: b.y }], ref })
  }
  for (const f of city.fountains) {
    const ref: EntityRef = { type: 'fountain', id: f.id }
    for (const e of placementIssues(grid, ref).errors) addOnce({ severity: 'error', category: 'objetos', code: 'FOUNTAIN_CONFLICT', message: `${f.id}: ${e}`, tiles: [{ tx: f.x0, ty: f.y0 }], ref })
  }

  connectivity(grid, city, add)
  canopies(city, add)
  crowding(grid, city, add)

  return out.sort((a, b) =>
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    || a.category.localeCompare(b.category)
    || a.code.localeCompare(b.code)
    || (a.tiles[0]?.ty ?? 0) - (b.tiles[0]?.ty ?? 0)
    || (a.tiles[0]?.tx ?? 0) - (b.tiles[0]?.tx ?? 0)
    || a.message.localeCompare(b.message))
}

function connectivity(grid: CityGrid, city: LabCity, add: (f: Finding) => void): void {
  const { id, sizes } = grid.regions()
  const regionOf = (t: Tile) => (grid.inBounds(t.tx, t.ty) ? id[t.ty * grid.width + t.tx] : -1)
  const home = regionOf(city.spawn)
  if (home < 0) return // The spawn itself is invalid: already reported, and nothing is reachable from it.

  for (const d of grid.doors) {
    const b = city.buildings.find(x => x.id === d.buildingId)!
    const ref: EntityRef = { type: 'building', id: b.id }
    if (regionOf(d.door) !== home) {
      add({ severity: 'error', category: 'edificios', code: 'BUILDING_UNREACHABLE', message: `No se puede llegar a la puerta de ${b.name} (${b.id}) desde el spawn.`, tiles: [d.door], ref })
    } else if (regionOf(d.exit) !== home) {
      add({ severity: 'error', category: 'edificios', code: 'DOOR_EXIT_BLOCKED', message: `Al salir de ${b.name} el jugador queda en ${fmt(d.exit)}, que no conecta con la ciudad.`, tiles: [d.exit], ref })
    }
  }
  for (const b of city.buildings.filter(x => !x.door)) {
    const front: Tile[] = []
    for (let tx = b.x; tx < b.x + b.w; tx++) front.push({ tx, ty: b.y + b.d })
    if (!front.some(t => regionOf(t) === home)) {
      add({ severity: 'warning', category: 'edificios', code: 'BUILDING_ISOLATED', message: `No hay dónde pararse frente a ${b.name} (${b.id}) para leerlo.`, tiles: front, ref: { type: 'building', id: b.id } })
    }
  }
  for (const g of city.gates) {
    if (!g.tiles.some(t => regionOf(t) === home)) {
      add({ severity: 'error', category: 'portales', code: 'GATE_UNREACHABLE', message: `${g.label}: no se puede llegar al portal desde el spawn.`, tiles: g.tiles, ref: { type: 'gate', id: g.id } })
    }
    if (regionOf(g.arrival) >= 0 && regionOf(g.arrival) !== home) {
      add({ severity: 'error', category: 'portales', code: 'ARRIVAL_DISCONNECTED', message: `${g.label}: quien vuelve por este portal queda en una zona aislada.`, tiles: [g.arrival], ref: { type: 'arrival', id: g.id } })
    }
  }

  // Walkable areas cut off from the spawn.
  const pockets: Tile[] = []
  sizes.forEach((size, region) => {
    if (region === home) return
    const first = id.indexOf(region)
    const tile = { tx: first % grid.width, ty: Math.floor(first / grid.width) }
    if (size >= SMALL_POCKET) {
      add({ severity: 'warning', category: 'conectividad', code: 'AREA_DISCONNECTED', message: `Zona caminable de ${size} tiles desconectada del spawn (empieza en ${fmt(tile)}).`, tiles: [tile] })
    } else pockets.push(tile)
  })
  if (pockets.length) {
    add({ severity: 'info', category: 'conectividad', code: 'POCKETS', message: `${pockets.length} huecos caminables chicos (< ${SMALL_POCKET} tiles) sin acceso: suelen ser tiles entre setos o props.`, tiles: pockets })
  }

  // Main routes: spawn → every feature door and every gate, flagging 1-tile squeezes.
  const clearance = clearanceMap(grid)
  const routes = [
    ...grid.doors.filter(d => d.feature).map(d => ({ name: city.buildings.find(b => b.id === d.buildingId)!.name, to: d.door })),
    ...city.gates.map(g => ({ name: g.label, to: g.tiles[0] })),
  ]
  for (const r of routes) {
    const path = grid.path(city.spawn, r.to)
    if (!path) continue
    // Ignore the last tiles: doors and gate stairs are narrow by design.
    const squeeze = path.slice(1, -2).filter(t => clearance[t.ty * grid.width + t.tx] === 1)
    if (squeeze.length) {
      add({ severity: 'warning', category: 'multijugador', code: 'MAIN_PATH_NARROW', message: `Camino spawn → ${r.name} pasa por ${squeeze.length} tile(s) de 1 de ancho (desde ${fmt(squeeze[0])}).`, tiles: squeeze })
    }
  }
}

/** Forest 2×2 blocks with one open tile: the game draws a full tree over walkable ground. */
function canopies(city: LabCity, add: (f: Finding) => void): void {
  const H = city.terrain.length
  const W = city.terrain[0]?.length ?? 0
  for (let by = 0; by < H; by += 2) {
    for (let bx = 0; bx < W; bx += 2) {
      const cells = [[bx, by], [bx + 1, by], [bx, by + 1], [bx + 1, by + 1]]
      const forest = cells.filter(([x, y]) => terrainAt(city, x, y) === 't')
      if (forest.length !== 3) continue
      const open = cells.filter(([x, y]) => terrainAt(city, x, y) !== null && terrainAt(city, x, y) !== 't').map(([tx, ty]) => ({ tx, ty }))
      if (!open.length) continue
      add({ severity: 'warning', category: 'hitbox', code: 'CANOPY_OVER_WALKABLE', message: `Árbol del bosque dibujado sobre ${fmt(open[0])}, que se puede caminar (parece sólido y no lo es).`, tiles: open })
    }
  }
}

/** Spots where players gather: how wide is the ground around them? */
function crowding(grid: CityGrid, city: LabCity, add: (f: Finding) => void): void {
  const clearance = clearanceMap(grid)
  const spots: { name: string; tile: Tile }[] = [
    { name: 'PLAYER SPAWN', tile: city.spawn },
    ...grid.doors.map(d => ({ name: `salida de ${city.buildings.find(b => b.id === d.buildingId)!.name}`, tile: d.exit })),
    ...city.gates.map(g => ({ name: `llegada ${g.label}`, tile: g.arrival })),
  ]
  for (const s of spots) {
    if (grid.solid(s.tile.tx, s.tile.ty)) continue
    // The spot's own tile: a door notch or gate stair right next to it is narrow by design.
    const here = clearance[s.tile.ty * grid.width + s.tile.tx]
    if (here <= 1) add({ severity: 'warning', category: 'multijugador', code: 'HOTSPOT_NARROW', message: `${s.name} ${fmt(s.tile)}: paso de 1 tile; varios jugadores se van a trabar.`, tiles: [s.tile] })
    else if (here === 2) add({ severity: 'info', category: 'multijugador', code: 'HOTSPOT_TIGHT', message: `${s.name} ${fmt(s.tile)}: sólo entran 2 lado a lado.`, tiles: [s.tile] })
  }
}

const fmt = (t: Tile) => `(${t.tx}, ${t.ty})`

export function countBySeverity(findings: readonly Finding[]): Record<Severity, number> {
  const out: Record<Severity, number> = { error: 0, warning: 0, info: 0 }
  for (const f of findings) out[f.severity]++
  return out
}
