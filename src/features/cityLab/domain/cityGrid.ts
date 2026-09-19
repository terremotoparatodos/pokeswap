// City Mapping Lab — what occupies each tile of a working copy (DEV only).
//
// Solidity comes from the real `TownArea` built for the copy (via
// `LabTownArea`), so the lab answers "can I walk here?" exactly as the game
// would. The rest is bookkeeping: which building, fountain, prop, door or gate
// sits on a tile, which the placement rules and Validate Map both read.

import type { TownDef } from '../../wildlands/areas/townArea'
import type { Tile } from '../../wildlands/engine/pathfinding'
import { labArea, type LabTownArea } from '../world/labTownArea'
import { cityHeight, cityWidth, collisionTilesOf, inBounds, type LabCity } from './labCity'

export interface DoorInfo {
  readonly buildingId: string
  readonly door: Tile
  /** Where the game stands the player after leaving (doors.ts: one tile below). */
  readonly exit: Tile
  readonly feature: string | null
}

export class CityGrid {
  readonly width: number
  readonly height: number
  readonly area: LabTownArea
  private readonly buildingAt = new Map<string, string>()
  private readonly fountainAt = new Map<string, string>()
  private readonly propsAt = new Map<string, string[]>()
  private readonly portalAt = new Map<string, string>()
  readonly doors: readonly DoorInfo[]

  constructor(readonly city: LabCity, base: TownDef) {
    this.width = cityWidth(city)
    this.height = cityHeight(city)
    this.area = labArea(city, base)
    for (const b of city.buildings) {
      for (let ty = b.y; ty < b.y + b.d; ty++) for (let tx = b.x; tx < b.x + b.w; tx++) this.buildingAt.set(key(tx, ty), b.id)
    }
    for (const f of city.fountains) {
      for (let ty = f.y0; ty <= f.y1; ty++) for (let tx = f.x0; tx <= f.x1; tx++) this.fountainAt.set(key(tx, ty), f.id)
    }
    // A prop claims the tiles it stands on: a tree only its trunk row, so crowns may overlap.
    for (const p of city.props) {
      for (const t of collisionTilesOf(city, { type: 'prop', id: p.id })) {
        const k = key(t.tx, t.ty)
        const list = this.propsAt.get(k)
        if (list) list.push(p.id)
        else this.propsAt.set(k, [p.id])
      }
    }
    for (const g of city.gates) for (const t of g.tiles) this.portalAt.set(key(t.tx, t.ty), g.id)
    this.doors = city.buildings.filter(b => b.door).map(b => ({
      buildingId: b.id,
      door: { ...b.door! },
      exit: { tx: b.door!.tx, ty: b.door!.ty + 1 },
      feature: b.feature ?? null,
    }))
  }

  inBounds(tx: number, ty: number): boolean {
    return inBounds(this.city, tx, ty)
  }

  /** The real engine's answer (out of bounds is solid, like `TownArea`). */
  solid(tx: number, ty: number): boolean {
    return this.area.isSolid(tx, ty)
  }

  walkable(tx: number, ty: number): boolean {
    return !this.solid(tx, ty)
  }

  building(tx: number, ty: number): string | null {
    return this.buildingAt.get(key(tx, ty)) ?? null
  }

  fountain(tx: number, ty: number): string | null {
    return this.fountainAt.get(key(tx, ty)) ?? null
  }

  props(tx: number, ty: number): readonly string[] {
    return this.propsAt.get(key(tx, ty)) ?? []
  }

  portal(tx: number, ty: number): string | null {
    return this.portalAt.get(key(tx, ty)) ?? null
  }

  door(tx: number, ty: number): DoorInfo | null {
    return this.doors.find(d => d.door.tx === tx && d.door.ty === ty) ?? null
  }

  doorExit(tx: number, ty: number): DoorInfo | null {
    return this.doors.find(d => d.exit.tx === tx && d.exit.ty === ty) ?? null
  }

  /** Walkable 4-neighbours of a tile. */
  openNeighbours(tx: number, ty: number): number {
    let n = 0
    for (const [dx, dy] of STEPS) if (this.walkable(tx + dx, ty + dy)) n++
    return n
  }

  /**
   * Flood fill over walkable tiles from `start`. Returns the region id of
   * every tile (-1 = solid) and the region sizes.
   */
  regions(): { id: Int32Array; sizes: number[] } {
    const id = new Int32Array(this.width * this.height).fill(-1)
    const sizes: number[] = []
    const queue: number[] = []
    for (let i = 0; i < id.length; i++) {
      const tx = i % this.width
      const ty = Math.floor(i / this.width)
      if (id[i] !== -1 || this.solid(tx, ty)) continue
      const region = sizes.length
      let size = 0
      id[i] = region
      queue.push(i)
      while (queue.length) {
        const cur = queue.pop()!
        size++
        const cx = cur % this.width
        const cy = Math.floor(cur / this.width)
        for (const [dx, dy] of STEPS) {
          const nx = cx + dx
          const ny = cy + dy
          if (!this.inBounds(nx, ny)) continue
          const ni = ny * this.width + nx
          if (id[ni] !== -1 || this.solid(nx, ny)) continue
          id[ni] = region
          queue.push(ni)
        }
      }
      sizes.push(size)
    }
    return { id, sizes }
  }

  /** Shortest walkable path (4-connected BFS), or null. Includes both ends. */
  path(from: Tile, to: Tile): Tile[] | null {
    if (!this.inBounds(from.tx, from.ty) || !this.inBounds(to.tx, to.ty)) return null
    const prev = new Int32Array(this.width * this.height).fill(-2)
    const start = from.ty * this.width + from.tx
    const goal = to.ty * this.width + to.tx
    prev[start] = -1
    const queue = [start]
    for (let head = 0; head < queue.length; head++) {
      const cur = queue[head]
      if (cur === goal) break
      const cx = cur % this.width
      const cy = Math.floor(cur / this.width)
      for (const [dx, dy] of STEPS) {
        const nx = cx + dx
        const ny = cy + dy
        if (!this.inBounds(nx, ny) || this.solid(nx, ny)) continue
        const ni = ny * this.width + nx
        if (prev[ni] !== -2) continue
        prev[ni] = cur
        queue.push(ni)
      }
    }
    if (prev[goal] === -2) return null
    const out: Tile[] = []
    for (let cur = goal; cur !== -1; cur = prev[cur]) out.push({ tx: cur % this.width, ty: Math.floor(cur / this.width) })
    return out.reverse()
  }
}

export const STEPS: readonly (readonly [number, number])[] = [[0, -1], [0, 1], [-1, 0], [1, 0]]

export const key = (tx: number, ty: number) => `${tx},${ty}`
