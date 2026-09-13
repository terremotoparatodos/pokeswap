// Tap-to-move pathfinding — WildLands prototype
//
// A* over the 4-connected tile grid. The search is bounded (radius and node
// budget) because the world is infinite: an unreachable tap must fail fast
// instead of flooding the map.

import { DIRS } from './actors'
import type { Dir } from './characters'

export interface Tile {
  tx: number
  ty: number
}

export interface PathQuery {
  start: Tile
  /** Tile the heuristic aims at (the tapped tile). */
  target: Tile
  /** Accepts a tile as a destination. */
  isGoal(tx: number, ty: number): boolean
  blocked(tx: number, ty: number): boolean
  /** Max Manhattan distance from start a path may wander. */
  radius?: number
  maxNodes?: number
}

const ORDER: Dir[] = ['up', 'down', 'left', 'right']

class MinHeap {
  private readonly items: { key: number; f: number }[] = []

  get size(): number {
    return this.items.length
  }

  push(key: number, f: number): void {
    const items = this.items
    items.push({ key, f })
    let i = items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (items[parent].f <= items[i].f) break
      ;[items[parent], items[i]] = [items[i], items[parent]]
      i = parent
    }
  }

  pop(): number {
    const items = this.items
    const top = items[0].key
    const last = items.pop()!
    if (items.length) {
      items[0] = last
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < items.length && items[l].f < items[m].f) m = l
        if (r < items.length && items[r].f < items[m].f) m = r
        if (m === i) break
        ;[items[m], items[i]] = [items[i], items[m]]
        i = m
      }
    }
    return top
  }
}

/** Returns the directions to walk, [] when already at a goal, or null if unreachable. */
export function findPath(query: PathQuery): Dir[] | null {
  const { start, target, isGoal, blocked } = query
  const radius = query.radius ?? 40
  const maxNodes = query.maxNodes ?? 5000
  if (isGoal(start.tx, start.ty)) return []

  // Tiles are keyed relative to start so the key stays a small integer.
  const span = radius * 2 + 1
  const keyOf = (tx: number, ty: number) => (ty - start.ty + radius) * span + (tx - start.tx + radius)
  const g = new Map<number, number>()
  const came = new Map<number, { from: number; dir: Dir }>()
  const open = new MinHeap()
  const h = (tx: number, ty: number) => Math.abs(tx - target.tx) + Math.abs(ty - target.ty)

  const startKey = keyOf(start.tx, start.ty)
  g.set(startKey, 0)
  open.push(startKey, h(start.tx, start.ty))
  let expanded = 0

  while (open.size && expanded < maxNodes) {
    const key = open.pop()
    const tx = (key % span) - radius + start.tx
    const ty = Math.floor(key / span) - radius + start.ty
    if (isGoal(tx, ty)) return unwind(came, key, startKey)
    expanded++
    const cost = g.get(key)! + 1
    for (const dir of ORDER) {
      const [dx, dy] = DIRS[dir]
      const nx = tx + dx
      const ny = ty + dy
      if (Math.abs(nx - start.tx) > radius || Math.abs(ny - start.ty) > radius) continue
      if (blocked(nx, ny)) continue
      const next = keyOf(nx, ny)
      if (cost >= (g.get(next) ?? Infinity)) continue
      g.set(next, cost)
      came.set(next, { from: key, dir })
      // Tiny tie-break toward the target keeps paths straight instead of zig-zagging.
      open.push(next, cost + h(nx, ny) * 1.001)
    }
  }
  return null
}

function unwind(came: Map<number, { from: number; dir: Dir }>, key: number, startKey: number): Dir[] {
  const dirs: Dir[] = []
  let k = key
  while (k !== startKey) {
    const step = came.get(k)!
    dirs.push(step.dir)
    k = step.from
  }
  return dirs.reverse()
}

/** Tiles visited by following `dirs` from `start` (excluding start). */
export function pathTiles(start: Tile, dirs: readonly Dir[]): Tile[] {
  const tiles: Tile[] = []
  let { tx, ty } = start
  for (const dir of dirs) {
    tx += DIRS[dir][0]
    ty += DIRS[dir][1]
    tiles.push({ tx, ty })
  }
  return tiles
}
