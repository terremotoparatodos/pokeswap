// City Mapping Lab — is this entity allowed where it now stands? (DEV only)
//
// Checked on the *candidate* city (after the edit), so every rule reads the
// same state the game would see. Errors reject the edit; warnings let it
// through but are shown to the person editing.

import type { Tile } from '../../wildlands/engine/pathfinding'
import type { CityGrid } from './cityGrid'
import { isSolidKind } from './labCatalog'
import { collisionTilesOf, isTreeProp, terrainAt, tilesOf, type EntityRef, type LabCity } from './labCity'

export interface PlacementIssues {
  readonly errors: string[]
  readonly warnings: string[]
}

const at = (t: Tile) => `(${t.tx}, ${t.ty})`

export function placementIssues(grid: CityGrid, ref: EntityRef): PlacementIssues {
  const city = grid.city
  const errors: string[] = []
  const warnings: string[] = []
  const tiles = tilesOf(city, ref)
  if (!tiles.length) return { errors: ['La entidad no existe en la working copy.'], warnings }
  const outside = tiles.find(t => !grid.inBounds(t.tx, t.ty))
  if (outside) return { errors: [`Fuera de los límites del mapa en ${at(outside)}.`], warnings }

  switch (ref.type) {
    case 'prop': checkProp(grid, city, ref.id, collisionTilesOf(city, ref), tiles, errors, warnings); break
    case 'building': checkBuilding(grid, city, ref.id, tiles, errors, warnings); break
    case 'fountain': checkFountain(grid, city, ref.id, tiles, errors); break
    case 'spawn': checkStandingSpot(grid, tiles[0], 'El spawn', errors, warnings, true); break
    case 'arrival': checkStandingSpot(grid, tiles[0], 'La llegada del portal', errors, warnings, false); break
    case 'resident':
    case 'wanderer': checkActor(grid, city, ref, tiles[0], errors, warnings); break
    case 'gate': checkGate(grid, tiles, errors, warnings); break
  }
  return { errors, warnings }
}

/**
 * `base` is where the prop stands (a tree: its trunk row); `cell` is all it
 * covers (a tree: its 2×2 crown cell). Hard rules apply to the base only:
 * crowns may overlap each other, buildings and props.
 */
function checkProp(grid: CityGrid, city: LabCity, id: string, base: Tile[], cell: Tile[], errors: string[], warnings: string[]): void {
  const prop = city.props.find(p => p.id === id)!
  for (const t of base) checkPropTile(grid, city, id, t, errors, warnings)
  if (isTreeProp(prop.kind) && cell.every(t => terrainAt(city, t.tx, t.ty) === 't')) {
    warnings.push('El árbol queda entero dentro del bosque: no se distingue de los árboles generados.')
  }
}

function checkPropTile(grid: CityGrid, city: LabCity, id: string, t: Tile, errors: string[], warnings: string[]): void {
  const prop = city.props.find(p => p.id === id)!
  const solid = isSolidKind(prop.kind)
  const building = grid.building(t.tx, t.ty)
  if (building) errors.push(`${at(t)} está dentro del edificio "${building}".`)
  const fountain = grid.fountain(t.tx, t.ty)
  if (fountain) errors.push(`${at(t)} está dentro de la fuente "${fountain}".`)
  const others = grid.props(t.tx, t.ty).filter(other => other !== id)
  if (others.length) errors.push(`${at(t)} ya tiene otro objeto: ${others.join(', ')}.`)
  if (grid.portal(t.tx, t.ty)) errors.push(`${at(t)} es un tile de portal (${grid.portal(t.tx, t.ty)}).`)
  if (grid.door(t.tx, t.ty)) errors.push(`${at(t)} es la puerta de "${grid.door(t.tx, t.ty)!.buildingId}".`)
  if (solid) {
    const exit = grid.doorExit(t.tx, t.ty)
    if (exit) errors.push(`${at(t)} bloquea la salida de "${exit.buildingId}".`)
    if (city.spawn.tx === t.tx && city.spawn.ty === t.ty) errors.push(`${at(t)} es el PLAYER SPAWN.`)
    const arrival = city.gates.find(g => g.arrival.tx === t.tx && g.arrival.ty === t.ty)
    if (arrival) errors.push(`${at(t)} es la llegada del portal "${arrival.id}".`)
    const npc = [...city.residents, ...city.wanderers].find(n => n.tx === t.tx && n.ty === t.ty)
    if (npc) warnings.push(`${at(t)} tapa a "${npc.id}"; el juego lo reubicará en el tile libre más cercano.`)
  }
  if (terrainAt(city, t.tx, t.ty) === 't') warnings.push(`${at(t)} es bosque: el objeto queda escondido entre los árboles.`)
}

function checkBuilding(grid: CityGrid, city: LabCity, id: string, tiles: Tile[], errors: string[], warnings: string[]): void {
  const clash = new Set<string>()
  for (const t of tiles) {
    const other = city.buildings.find(b => b.id !== id && t.tx >= b.x && t.tx < b.x + b.w && t.ty >= b.y && t.ty < b.y + b.d)
    if (other) clash.add(`se superpone con "${other.id}"`)
    const fountain = grid.fountain(t.tx, t.ty)
    if (fountain) clash.add(`se superpone con la fuente "${fountain}"`)
    const props = grid.props(t.tx, t.ty)
    if (props.length) clash.add(`tapa ${props.join(', ')}`)
    if (city.spawn.tx === t.tx && city.spawn.ty === t.ty) clash.add('tapa el PLAYER SPAWN')
    const arrival = city.gates.find(g => g.arrival.tx === t.tx && g.arrival.ty === t.ty)
    if (arrival) clash.add(`tapa la llegada del portal "${arrival.id}"`)
    const npc = [...city.residents, ...city.wanderers].find(n => n.tx === t.tx && n.ty === t.ty)
    if (npc) warnings.push(`Tapa a "${npc.id}"; el juego lo reubicará.`)
    if (terrainAt(city, t.tx, t.ty) === 't') clash.add('pisa bosque')
  }
  for (const c of clash) (c === 'pisa bosque' ? warnings : errors).push(`El edificio ${c}.`)
  const door = grid.doors.find(d => d.buildingId === id)
  if (door && grid.solid(door.exit.tx, door.exit.ty)) errors.push(`La salida de la puerta ${at(door.exit)} queda bloqueada.`)
}

function checkFountain(grid: CityGrid, city: LabCity, id: string, tiles: Tile[], errors: string[]): void {
  const clash = new Set<string>()
  for (const t of tiles) {
    const building = grid.building(t.tx, t.ty)
    if (building) clash.add(`se superpone con "${building}"`)
    const fountain = grid.fountain(t.tx, t.ty)
    if (fountain && fountain !== id) clash.add(`se superpone con la fuente "${fountain}"`)
    const props = grid.props(t.tx, t.ty)
    if (props.length) clash.add(`tapa ${props.join(', ')}`)
    if (city.spawn.tx === t.tx && city.spawn.ty === t.ty) clash.add('tapa el PLAYER SPAWN')
    if (grid.portal(t.tx, t.ty)) clash.add('tapa un portal')
  }
  for (const c of clash) errors.push(`La fuente ${c}.`)
}

function checkStandingSpot(grid: CityGrid, t: Tile, what: string, errors: string[], warnings: string[], spawn: boolean): void {
  if (grid.solid(t.tx, t.ty)) errors.push(`${what} ${at(t)} está dentro de algo sólido.`)
  if (grid.portal(t.tx, t.ty)) errors.push(`${what} ${at(t)} está sobre un portal: el jugador viajaría al llegar.`)
  if (grid.door(t.tx, t.ty)) errors.push(`${what} ${at(t)} está sobre una puerta.`)
  const open = grid.openNeighbours(t.tx, t.ty)
  if (open === 0) errors.push(`${what} ${at(t)} no tiene ningún vecino caminable.`)
  else if (open < (spawn ? 3 : 2)) warnings.push(`${what} ${at(t)} tiene poco espacio alrededor (${open} vecinos caminables).`)
}

function checkActor(grid: CityGrid, city: LabCity, ref: EntityRef, t: Tile, errors: string[], warnings: string[]): void {
  if (grid.solid(t.tx, t.ty)) errors.push(`${ref.id} ${at(t)} está dentro de algo sólido.`)
  if (grid.portal(t.tx, t.ty)) errors.push(`${ref.id} ${at(t)} está sobre un portal.`)
  if (grid.door(t.tx, t.ty)) errors.push(`${ref.id} ${at(t)} está sobre una puerta.`)
  if (grid.doorExit(t.tx, t.ty)) warnings.push(`${ref.id} ${at(t)} está parado en la salida de "${grid.doorExit(t.tx, t.ty)!.buildingId}".`)
  if (city.spawn.tx === t.tx && city.spawn.ty === t.ty) warnings.push(`${ref.id} ${at(t)} está sobre el PLAYER SPAWN.`)
  const twin = [...city.residents, ...city.wanderers].find(n => n.id !== ref.id && n.tx === t.tx && n.ty === t.ty)
  if (twin) warnings.push(`${ref.id} comparte tile con "${twin.id}".`)
}

function checkGate(grid: CityGrid, tiles: Tile[], errors: string[], warnings: string[]): void {
  for (const t of tiles) {
    // Collision forces gate tiles walkable, so a prop there would silently vanish from physics.
    const props = grid.props(t.tx, t.ty)
    if (props.length) errors.push(`El portal ${at(t)} tapa ${props.join(', ')}.`)
    if (grid.fountain(t.tx, t.ty)) errors.push(`El portal ${at(t)} está dentro de una fuente.`)
    if (grid.door(t.tx, t.ty)) errors.push(`El portal ${at(t)} está sobre una puerta.`)
    if (terrainAt(grid.city, t.tx, t.ty) === 't') warnings.push(`El portal ${at(t)} está en bosque: se abre un hueco caminable.`)
  }
}
