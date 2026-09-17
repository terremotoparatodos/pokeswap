// D1.2.4 §1, §4 — the walls you break instead of walk around.
//
// The promise: an obstacle is a detour worth a tool, never the reason a floor
// cannot be finished. And clearing one gives nothing but the tile.

import { describe, expect, it } from 'vitest'
import { generateFloor } from './floorPlan'
import { buildFloorTiles, isWalkable, type FloorTiles } from './floorTiles'
import {
  blockedByObstacles, exitReachableWithout, isObstacleTile, MAX_BARRIER, OBSTACLES, placeObstacles,
  reachableFrom,
} from './obstacles'
import { dungeonProfile, DUNGEON_THEMES, type DungeonTheme } from './tiers'

const POOL = [4, 7, 25]
const SEEDS = [11, 909, 2024, 55501, 31337]

const floor = (seed: number, theme: DungeonTheme = 'cave'): FloorTiles =>
  buildFloorTiles(generateFloor(dungeonProfile(seed, 'B', theme), 3, POOL), theme, seed)

describe('an obstacle never closes a floor (§1)', () => {
  it.each(SEEDS)('seed %i: the exit is reachable with every obstacle still in place', seed => {
    const tiles = floor(seed)
    const obstacles = placeObstacles(tiles, seed, 3)
    expect(exitReachableWithout(tiles, obstacles)).toBe(true)
  })

  it.each(SEEDS)('seed %i: an obstacle never sits on the spawn or the way out', seed => {
    const tiles = floor(seed)
    for (const obstacle of placeObstacles(tiles, seed, 3)) {
      for (const at of obstacle.tiles) {
        expect(at).not.toEqual(tiles.entrance)
        expect(at).not.toEqual(tiles.exit)
        expect(isWalkable(tiles, at.x, at.y)).toBe(true)
      }
      expect(obstacle.tiles).toContainEqual(obstacle.at)
    }
  })

  it.each(SEEDS)('seed %i: it seals a pocket, not the map', seed => {
    const tiles = floor(seed)
    const obstacles = placeObstacles(tiles, seed, 3)
    const open = reachableFrom(tiles, tiles.entrance, new Set())
    const sealed = reachableFrom(tiles, tiles.entrance, blockedByObstacles(obstacles))
    // Whatever they lock away is a minority of the floor.
    expect(sealed.size).toBeGreaterThan(open.size * 0.6)
  })

  it.each(SEEDS)('seed %i: clearing them all gives the whole floor back', seed => {
    const tiles = floor(seed)
    const obstacles = placeObstacles(tiles, seed, 3)
    for (const obstacle of obstacles) obstacle.cleared = true
    const open = reachableFrom(tiles, tiles.entrance, new Set())
    const after = reachableFrom(tiles, tiles.entrance, blockedByObstacles(obstacles))
    expect(after.size).toBe(open.size)
  })
})

describe('what they are made of', () => {
  it.each(DUNGEON_THEMES)('%s: uses obstacles that belong to its biome', theme => {
    const tiles = floor(4242, theme)
    for (const obstacle of placeObstacles(tiles, 4242, 3)) {
      const definition = OBSTACLES[obstacle.kind]
      expect(['mine', 'chop']).toContain(definition.skill)
      expect(definition.seconds).toBeGreaterThan(0)
      // A glacier has no roots to chop and a forest no seam to mine into.
      if (theme === 'glacier') expect(obstacle.kind).not.toBe('roots')
      if (theme === 'forest') expect(obstacle.kind).not.toBe('crystal')
    }
  })

  it('blocks every tile of the barrier until it is cleared, then none', () => {
    const tiles = floor(909)
    const obstacles = placeObstacles(tiles, 909, 3)
    expect(obstacles.length).toBeGreaterThan(0)
    const first = obstacles[0]
    for (const at of first.tiles) expect(isObstacleTile(obstacles, at.x, at.y)).toBe(true)
    first.cleared = true
    for (const at of first.tiles) expect(isObstacleTile(obstacles, at.x, at.y)).toBe(false)
  })

  it.each(SEEDS)('seed %i: the same seed places the same obstacles', seed => {
    const tiles = floor(seed)
    expect(placeObstacles(tiles, seed, 3)).toEqual(placeObstacles(tiles, seed, 3))
  })
})

// D1.2.4 §1 — a pebble in a five-tile gallery is not an obstacle: you walk past
// it. These are the properties that make one worth a tool.
describe('a barrier, not a pebble', () => {
  it.each(SEEDS)('seed %i: it spans the throat from wall to wall', seed => {
    const tiles = floor(seed)
    for (const obstacle of placeObstacles(tiles, seed, 3)) {
      const acrossX = obstacle.axis === 'x'
      const line = [...obstacle.tiles].sort((a, b) => (a.x - b.x) || (a.y - b.y))
      const first = line[0]
      const last = line[line.length - 1]
      const before = acrossX ? { x: first.x - 1, y: first.y } : { x: first.x, y: first.y - 1 }
      const after = acrossX ? { x: last.x + 1, y: last.y } : { x: last.x, y: last.y + 1 }
      expect(isWalkable(tiles, before.x, before.y)).toBe(false)
      expect(isWalkable(tiles, after.x, after.y)).toBe(false)
      expect(obstacle.tiles.length).toBeLessThanOrEqual(MAX_BARRIER)
    }
  })

  it.each(SEEDS)('seed %i: each one really closes a way, not just its own tiles', seed => {
    const tiles = floor(seed)
    const obstacles = placeObstacles(tiles, seed, 3)
    const open = reachableFrom(tiles, tiles.entrance, new Set())
    for (const obstacle of obstacles) {
      const alone = obstacles.map(other => ({ ...other, cleared: other !== obstacle }))
      const sealed = reachableFrom(tiles, tiles.entrance, blockedByObstacles(alone))
      // More ground is lost than the barrier itself covers: there is something
      // behind it, which is the whole point of carrying a tool.
      expect(open.size - sealed.size).toBeGreaterThan(obstacle.tiles.length)
    }
  })

  it('puts them on nearly every floor, so they are actually met', () => {
    let floors = 0
    let empty = 0
    for (const seed of [11, 909, 2024, 55501, 31337, 4242, 77, 5150]) {
      for (let level = 1; level <= 3; level++) {
        const tiles = floor(seed)
        floors++
        if (!placeObstacles(tiles, seed, level).length) empty++
      }
    }
    expect(empty / floors).toBeLessThan(0.1)
  })
})
