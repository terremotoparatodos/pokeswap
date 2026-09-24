// Building doors — WildLands lobby (R25)
//
// Buildings that host a PokeSwap feature get a door: a threshold tile on the
// bottom row of their footprint that stays walkable. Stepping onto it (by
// keyboard, or walking there after tapping the building) enters the building;
// the view then opens the feature panel. When the panel closes the player
// stands just outside, facing away from the building.
//
// The threshold sits inside the footprint on purpose: walking along the street
// in front of a building never enters it by accident.

import type { Area, Arrival } from './area'
import type { Tile } from './pathfinding'
import type { Pick } from './renderer'
import type { LobbyFeature } from '../lobby/features'

/** Rows of façade and roof drawn above a footprint that still count as tapping the building. */
const TAP_REACH_ROWS = 2

export interface DoorSpec {
  id: string
  x: number
  y: number
  w: number
  d: number
  /** Threshold tile (bottom row of the footprint). */
  door?: Tile
  feature?: LobbyFeature
}

export interface BuildingDoor {
  buildingId: string
  feature: LobbyFeature
  door: Tile
  /** Where the player stands after leaving. */
  exit: Arrival
  footprint: { x: number; y: number; w: number; d: number }
}

export function buildingDoors(buildings: readonly DoorSpec[]): BuildingDoor[] {
  const doors: BuildingDoor[] = []
  for (const b of buildings) {
    if (!b.door || !b.feature) continue
    doors.push({
      buildingId: b.id,
      feature: b.feature,
      door: b.door,
      exit: { tx: b.door.tx, ty: b.door.ty + 1, dir: 'down' },
      footprint: { x: b.x, y: b.y, w: b.w, d: b.d },
    })
  }
  return doors
}

export function doorAt(doors: readonly BuildingDoor[], tx: number, ty: number): BuildingDoor | null {
  return doors.find(d => d.door.tx === tx && d.door.ty === ty) ?? null
}

/** The door of the building drawn over a tapped ground tile, if it has one. */
export function doorForTap(doors: readonly BuildingDoor[], tile: Tile): BuildingDoor | null {
  return doors.find(({ footprint: f }) =>
    tile.tx >= f.x && tile.tx < f.x + f.w && tile.ty >= f.y - TAP_REACH_ROWS && tile.ty < f.y + f.d) ?? null
}

/**
 * Door handling for the game loop: turns taps on buildings into walks to their
 * door and reports entries. Holds no state of its own besides the callback.
 */
export class Entrances {
  constructor(private readonly onEnter?: (door: BuildingDoor) => void) {}

  /** Tapping a building (not a character in front of it) walks to its door. */
  retarget(area: Area, pick: Pick): Pick {
    if (pick.actor || !pick.tile) return pick
    const door = doorForTap(area.doors ?? [], pick.tile)
    return door ? { tile: door.door, actor: null } : pick
  }

  /** Call when the player steps onto a tile; returns true when that entered a building. */
  arrive(area: Area, tx: number, ty: number): boolean {
    const door = doorAt(area.doors ?? [], tx, ty)
    if (!door) return false
    this.onEnter?.(door)
    return true
  }

  isDoor(area: Area, tx: number, ty: number): boolean {
    return doorAt(area.doors ?? [], tx, ty) !== null
  }

  exitFor(area: Area, feature: LobbyFeature): Arrival | null {
    return this.doorFor(area, feature)?.exit ?? null
  }

  doorFor(area: Area, feature: LobbyFeature): BuildingDoor | null {
    return area.doors?.find(d => d.feature === feature) ?? null
  }
}
