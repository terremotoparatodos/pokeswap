// Obstacles you have to break to get past (D1.2.4 §1, §4).
//
// A cave should have places you cannot simply walk into. These are them: a
// rockfall you mine through, a crystal seam you break, a barricade of roots you
// chop. They are **not** a resource: clearing one gives nothing but the way
// through, and the tools exist here only for that. Professions are untouched.
//
// An obstacle is a **barrier**, not a pebble. The routes of this dungeon are
// four and five tiles wide (D1.2.1 §6), so a single blocked tile is something
// you walk around without noticing. A barrier spans the whole throat of a
// gallery, wall to wall, and the tiles of one clear together.
//
// The contract that keeps a floor playable: a barrier never sits on the only
// way to the exit. They seal side pockets and second routes — the places worth
// a detour — so a player without the right tool loses a shortcut and a
// treasure, never the floor.
//
// Pure: tiles in, obstacles out, deterministic from the seed.

import { streamFor } from './rng'
import { isWalkable, tileAt, WALKABLE, type FloorTiles, type TilePoint } from './tileKinds'
import type { DungeonTheme } from './tiers'

/** What it takes to clear one. */
export type ObstacleSkill = 'mine' | 'chop'

export type ObstacleKind = 'rockfall' | 'crystal' | 'roots' | 'timber'

export interface ObstacleDefinition {
  readonly kind: ObstacleKind
  readonly skill: ObstacleSkill
  readonly label: string
  /** Seconds of work. PLAYTEST PARAMETER. */
  readonly seconds: number
  /** What the prompt says you need. */
  readonly tool: string
}

export const OBSTACLES: Readonly<Record<ObstacleKind, ObstacleDefinition>> = {
  rockfall: { kind: 'rockfall', skill: 'mine', label: 'Derrumbe', seconds: 2.2, tool: 'Pico' },
  crystal: { kind: 'crystal', skill: 'mine', label: 'Veta de cristal', seconds: 2.8, tool: 'Pico' },
  roots: { kind: 'roots', skill: 'chop', label: 'Raíces', seconds: 2, tool: 'Hacha' },
  timber: { kind: 'timber', skill: 'chop', label: 'Tranca de madera', seconds: 2.4, tool: 'Hacha' },
}

/** Which two a biome uses, so a glacier is not full of roots. */
const THEME_OBSTACLES: Readonly<Record<DungeonTheme, readonly ObstacleKind[]>> = {
  cave: ['rockfall', 'crystal'],
  mine: ['rockfall', 'timber'],
  glacier: ['crystal', 'rockfall'],
  forest: ['roots', 'timber'],
  volcano: ['rockfall', 'crystal'],
  ruin: ['rockfall', 'timber'],
  tower: ['crystal', 'rockfall'],
}

/** The widest throat a barrier is allowed to close: wider than this is a hall. */
export const MAX_BARRIER = 6

export interface FloorObstacle {
  readonly id: string
  readonly kind: ObstacleKind
  /** The middle of the barrier: what the prompt and the effects point at. */
  readonly at: TilePoint
  /** Every tile it blocks, wall to wall. They clear together. */
  readonly tiles: readonly TilePoint[]
  /** Which way it runs: across x is a wall you meet walking up or down. */
  readonly axis: 'x' | 'y'
  /** Cleared: the tiles are open from here on. */
  cleared: boolean
}

const key = (point: TilePoint): string => `${point.x}:${point.y}`

/** Walkable tiles reachable on foot from `start`, treating `blocked` as rock. */
export function reachableFrom(tiles: FloorTiles, start: TilePoint, blocked: ReadonlySet<string>): Set<string> {
  const seen = new Set<string>([key(start)])
  const queue: TilePoint[] = [start]
  while (queue.length) {
    const at = queue.shift()!
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const next = { x: at.x + dx, y: at.y + dy }
      const id = key(next)
      if (seen.has(id) || blocked.has(id) || !isWalkable(tiles, next.x, next.y)) continue
      seen.add(id)
      queue.push(next)
    }
  }
  return seen
}

/**
 * The barrier through `x,y` across `axis`: every walkable tile from wall to
 * wall. Null when the throat is wider than a barrier may close, which is the
 * open middle of a chamber rather than the neck of a gallery.
 */
export function barrierAcross(
  tiles: FloorTiles, x: number, y: number, axis: 'x' | 'y',
): TilePoint[] | null {
  if (!isWalkable(tiles, x, y)) return null
  const step = axis === 'x' ? { dx: 1, dy: 0 } : { dx: 0, dy: 1 }
  const line: TilePoint[] = [{ x, y }]
  for (const sign of [1, -1]) {
    for (let i = 1; i <= MAX_BARRIER; i++) {
      const at = { x: x + step.dx * i * sign, y: y + step.dy * i * sign }
      if (!isWalkable(tiles, at.x, at.y)) break
      line.push(at)
      if (line.length > MAX_BARRIER) return null
    }
  }
  return line.sort((a, b) => (a.x - b.x) || (a.y - b.y))
}

const centreOf = (line: readonly TilePoint[]): TilePoint => line[Math.floor(line.length / 2)]

/**
 * Places up to `wanted` barriers, each one verified to actually block something
 * and never to cut the exit — or most of the floor — off from the entrance.
 */
export function placeObstacles(tiles: FloorTiles, seed: number, floor: number, wanted = 4): FloorObstacle[] {
  const rng = streamFor(seed, 'obstacles', tiles.theme, floor)
  const kinds = THEME_OBSTACLES[tiles.theme]
  const out: FloorObstacle[] = []
  const blocked = new Set<string>()

  // Every throat on the floor, once: two tiles of the same gallery describe the
  // same barrier, so they collapse into the line they produce.
  const candidates = new Map<string, { line: TilePoint[]; axis: 'x' | 'y' }>()
  for (let y = 1; y < tiles.height - 1; y++) {
    for (let x = 1; x < tiles.width - 1; x++) {
      if (tileAt(tiles, x, y) !== 'floor') continue
      for (const axis of ['x', 'y'] as const) {
        const line = barrierAcross(tiles, x, y, axis)
        if (!line) continue
        const touchesWay = line.some(at => (at.x === tiles.entrance.x && at.y === tiles.entrance.y)
          || (at.x === tiles.exit.x && at.y === tiles.exit.y))
        if (touchesWay) continue
        candidates.set(line.map(key).join(','), { line, axis })
      }
    }
  }

  const everywhere = reachableFrom(tiles, tiles.entrance, blocked)
  const taken: TilePoint[] = []
  for (const { line, axis } of rng.shuffle([...candidates.values()])) {
    if (out.length >= wanted) break
    // Barriers stand apart: two in the same gallery read as one long wall.
    const centre = centreOf(line)
    if (taken.some(other => Math.hypot(other.x - centre.x, other.y - centre.y) < 6)) continue
    if (line.some(at => blocked.has(key(at)))) continue

    // On its own it has to close a way: a barrier the others make redundant is
    // scenery you walk around, which is exactly what §1 is not asking for.
    const alone = reachableFrom(tiles, tiles.entrance, new Set(line.map(key)))
    if (everywhere.size - alone.size <= line.length) continue

    for (const at of line) blocked.add(key(at))
    const still = reachableFrom(tiles, tiles.entrance, blocked)
    const strandsExit = !still.has(key(tiles.exit))
    const lost = everywhere.size - still.size
    // And together they have to leave the floor finishable: the exit reachable
    // and most of the ground still open.
    if (strandsExit || lost > everywhere.size * 0.3) {
      for (const at of line) blocked.delete(key(at))
      continue
    }
    taken.push(centre)
    out.push({
      id: `f${floor}-obs${out.length}`,
      kind: kinds[rng.int(0, kinds.length - 1)],
      at: centre,
      tiles: line,
      axis,
      cleared: false,
    })
  }
  return out
}

/** The tiles still sealed, for collision and for pathfinding. */
export const blockedByObstacles = (obstacles: readonly FloorObstacle[]): Set<string> =>
  new Set(obstacles.filter(obstacle => !obstacle.cleared).flatMap(obstacle => obstacle.tiles.map(key)))

/** True when the exit can still be walked to with every obstacle left in place. */
export function exitReachableWithout(tiles: FloorTiles, obstacles: readonly FloorObstacle[]): boolean {
  const reached = reachableFrom(tiles, tiles.entrance, blockedByObstacles(obstacles))
  return reached.has(key(tiles.exit))
}

export const isObstacleTile = (obstacles: readonly FloorObstacle[], x: number, y: number): boolean =>
  obstacles.some(obstacle => !obstacle.cleared && obstacle.tiles.some(at => at.x === x && at.y === y))

export { WALKABLE }
