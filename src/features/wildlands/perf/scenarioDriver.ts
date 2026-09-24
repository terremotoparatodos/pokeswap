// Deterministic scripted walks for PERF-1 captures (VITE_PERF builds only).
//
// The driver steers the local player through the same input the keyboard
// uses (virtual direction + sprint), so the engine, walker, presence and
// camera run their normal code. Each leg is planned with the engine's own A*
// over the area's real collision. Door tiles are avoided: stepping on one
// opens a panel and pauses the world.

import type { Actor } from '../engine/actors'
import { isPortalTile, type Area } from '../engine/area'
import type { Dir } from '../engine/characters'
import { findPath, pathTiles, type Tile } from '../engine/pathfinding'

export interface DriverControls {
  setVirtualDir(dir: Dir | null): void
  setVirtualSprint(on: boolean): void
}

export type Waypoint =
  | { area: string; tx: number; ty: number; run: boolean }
  /** Step onto a portal tile and wait until the area changes to `to`. */
  | { area: string; tx: number; ty: number; run: boolean; to: string }

export interface ScenarioDef {
  id: string
  title: string
  startArea: string
  start: Tile
  loops: number
  waypoints: Waypoint[]
}

const leg = (area: string, tx: number, ty: number, run: boolean): Waypoint => ({ area, tx, ty, run })
const TOWN = 'ciudad-corazon'
const PRADERA = 'pradera'

export const SCENARIOS: Record<string, ScenarioDef> = {
  'city-loop': {
    id: 'city-loop', title: 'CITY-1: town loop, walking and running', startArea: TOWN, start: { tx: 31, ty: 20 }, loops: 2,
    waypoints: [
      leg(TOWN, 20, 30, false), leg(TOWN, 31, 30, true), leg(TOWN, 44, 30, false), leg(TOWN, 50, 20, true),
      leg(TOWN, 44, 15, false), leg(TOWN, 20, 15, true), leg(TOWN, 31, 20, false),
    ],
  },
  'pradera-line': {
    id: 'pradera-line', title: 'SOLO-1: Pradera, crossing chunk borders and back', startArea: PRADERA, start: { tx: -5, ty: -69 }, loops: 1,
    waypoints: [
      leg(PRADERA, 25, -69, true), leg(PRADERA, 55, -69, false), leg(PRADERA, 85, -69, true), leg(PRADERA, 115, -69, true),
      leg(PRADERA, 85, -40, false), leg(PRADERA, 55, -40, true), leg(PRADERA, 25, -40, true), leg(PRADERA, -5, -69, false),
    ],
  },
  // NPC experiment: laps close to the Pradera spawn, where the synthetic runners are.
  'pradera-loop': {
    id: 'pradera-loop', title: 'Pradera laps around the spawn', startArea: PRADERA, start: { tx: -5, ty: -69 }, loops: 3,
    waypoints: [
      leg(PRADERA, 5, -69, true), leg(PRADERA, 5, -60, false), leg(PRADERA, -12, -60, true), leg(PRADERA, -12, -74, false), leg(PRADERA, -5, -69, true),
    ],
  },
  traversal: {
    id: 'traversal', title: 'TRAVERSAL: town → Pradera → town through the west gate', startArea: TOWN, start: { tx: 31, ty: 20 }, loops: 3,
    waypoints: [
      leg(TOWN, 12, 41, true), { area: TOWN, tx: 6, ty: 41, run: false, to: PRADERA },
      leg(PRADERA, -5, -58, true), leg(PRADERA, 6, -58, true), leg(PRADERA, -5, -68, false),
      { area: PRADERA, tx: -5, ty: -70, run: false, to: TOWN },
      leg(TOWN, 31, 20, true),
    ],
  },
}

const DIRS: Record<string, Dir> = { '1,0': 'right', '-1,0': 'left', '0,1': 'down', '0,-1': 'up' }

export interface DriverEvent { at: number; kind: 'leg' | 'arrived' | 'skipped' | 'travel' | 'done'; detail: string }

export class ScenarioDriver {
  readonly events: DriverEvent[] = []
  private index = 0
  private loop = 0
  private path: Tile[] | null = null
  private stuckSince = -1
  private replans = 0
  /** Tiles the player bumped into on this leg; cleared when the leg ends. */
  private readonly avoid = new Set<string>()
  finished = false

  constructor(readonly def: ScenarioDef, private readonly controls: DriverControls, private readonly now: () => number = () => performance.now()) {}

  private get waypoint(): Waypoint { return this.def.waypoints[this.index] }

  private log(kind: DriverEvent['kind'], detail: string): void {
    this.events.push({ at: Math.round(this.now()), kind, detail })
  }

  private advance(kind: 'arrived' | 'skipped'): void {
    const w = this.waypoint
    this.log(kind, `${w.area} ${w.tx},${w.ty}`)
    this.path = null; this.replans = 0; this.stuckSince = -1; this.avoid.clear()
    this.index++
    if (this.index >= this.def.waypoints.length) {
      this.index = 0
      this.loop++
      if (this.loop >= this.def.loops) {
        this.finished = true
        this.controls.setVirtualDir(null); this.controls.setVirtualSprint(false)
        this.log('done', `${this.loop} loops`)
      }
    }
  }

  /** Call once per frame with the engine's current player and area. */
  step(player: Actor, area: Area): void {
    if (this.finished) return
    const w = this.waypoint
    if (area.id !== w.area) {
      // Waiting for a portal transition to land.
      this.controls.setVirtualDir(null)
      return
    }
    if (!this.path) {
      this.path = this.plan(player, area, w)
      if (!this.path) { this.advance('skipped'); return }
      this.log('leg', `${w.area} → ${w.tx},${w.ty} ${w.run ? 'run' : 'walk'} (${this.path.length - 1} tiles)`)
    }
    this.controls.setVirtualSprint(w.run)
    const path = this.path
    // During a step (tx, ty) is already the destination tile: steer from there.
    const at = path.findIndex(t => t.tx === player.tx && t.ty === player.ty)
    if (at < 0) { this.path = null; return }
    if (at === path.length - 1) {
      this.controls.setVirtualDir(null)
      if (player.progress < 1) return
      if ('to' in w) { this.log('travel', `${w.area} → ${w.to}`); this.path = null; this.index++; this.wrapPortal(); return }
      this.advance('arrived')
      return
    }
    const next = path[at + 1]
    this.controls.setVirtualDir(DIRS[`${next.tx - player.tx},${next.ty - player.ty}`] ?? null)
    // Blocked by something the plan did not know about (an NPC): replan, then give up.
    if (player.progress >= 1 && !player.bumping) this.stuckSince = -1
    else if (player.bumping) {
      if (this.stuckSince < 0) this.stuckSince = this.now()
      else if (this.now() - this.stuckSince > 800) {
        // Whatever stands there (usually a townsperson) is avoided on the next plan.
        this.avoid.add(`${next.tx},${next.ty}`)
        this.stuckSince = -1
        this.path = null
        if (++this.replans > 3) this.advance('skipped')
      }
    }
  }

  private wrapPortal(): void {
    if (this.index >= this.def.waypoints.length) { this.index--; this.advance('arrived') }
  }

  private plan(player: Actor, area: Area, w: Waypoint): Tile[] | null {
    const doors = doorTiles(area)
    const open = (tx: number, ty: number) => !area.isSolid(tx, ty) && !doors.has(`${tx},${ty}`) && !this.avoid.has(`${tx},${ty}`)
      && (area.isReachable?.(tx, ty) ?? true)
    const target = nearestFree(w, (tx, ty) => !open(tx, ty) || isPortalTile(area, tx, ty), 'to' in w)
    if (!target) return null
    // A portal is only walked onto when it is the destination.
    const blocked = (tx: number, ty: number) => !open(tx, ty) || (isPortalTile(area, tx, ty) && (tx !== target.tx || ty !== target.ty))
    const start = { tx: player.tx, ty: player.ty }
    const dirs = findPath({ start, target, isGoal: (tx, ty) => tx === target.tx && ty === target.ty, blocked, radius: 60, maxNodes: 20_000 })
    // pathTiles excludes the start; the driver locates the player on the route, start included.
    return dirs ? [start, ...pathTiles(start, dirs)] : null
  }
}

/** The waypoint itself, or the closest open tile within 5 (portals must be exact). */
function nearestFree(w: Tile, blocked: (tx: number, ty: number) => boolean, exact: boolean): Tile | null {
  if (exact) return { tx: w.tx, ty: w.ty }
  for (let r = 0; r <= 5; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
      if (!blocked(w.tx + dx, w.ty + dy)) return { tx: w.tx + dx, ty: w.ty + dy }
    }
  }
  return null
}

/** Town building doors, read from the area's definition (dev tooling only). */
function doorTiles(area: Area): Set<string> {
  const def = (area as { def?: { buildings?: { door?: Tile }[] } }).def
  return new Set((def?.buildings ?? []).flatMap(b => (b.door ? [`${b.door.tx},${b.door.ty}`] : [])))
}
