// D1.2.1 §19 — is there room to play in here?
//
// The phase's promise is spatial: a dungeon floor is WildLands underground, so
// a party of four with a Pokémon each has to be able to walk it. These tests
// measure the floor instead of looking at it: how wide the ground is, whether
// everything is reachable, whether the exit can be got to, and whether a
// Pokémon standing in a passage can be walked around.

import { describe, expect, it } from 'vitest'
import { generateFloor } from './floorPlan'
import {
  buildFloorTiles, isWalkable, openWidth, PATH_WIDTH, placeEntities, tileAt, WALKABLE,
  type FloorTiles, type TilePoint,
} from './floorTiles'
import { dungeonProfile, DUNGEON_THEMES, type DungeonTheme } from './tiers'

const POOL = [4, 7, 25, 133]

function floor(seed: number, theme: DungeonTheme = 'cave', level = 3): FloorTiles {
  const plan = generateFloor(dungeonProfile(seed, 'B', theme), level, POOL)
  return buildFloorTiles(plan, theme, seed)
}

const SEEDS = [11, 2024, 77771, 90210, 4242]

/** Every tile reachable from `start` by walking. */
function flood(tiles: FloorTiles, start: TilePoint): Set<string> {
  const seen = new Set<string>([`${start.x}:${start.y}`])
  const queue: TilePoint[] = [start]
  while (queue.length) {
    const at = queue.shift()!
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const next = { x: at.x + dx, y: at.y + dy }
      const key = `${next.x}:${next.y}`
      if (seen.has(key) || !isWalkable(tiles, next.x, next.y)) continue
      seen.add(key)
      queue.push(next)
    }
  }
  return seen
}

describe('room to walk (§6, §7)', () => {
  it.each(SEEDS)('seed %i: almost no ground is narrower than a branch route', seed => {
    const tiles = floor(seed)
    let narrow = 0
    let total = 0
    for (let y = 0; y < tiles.height; y++) {
      for (let x = 0; x < tiles.width; x++) {
        if (!isWalkable(tiles, x, y)) continue
        total++
        // A bridge is a deliberate pinch point and does not count against us.
        if (tileAt(tiles, x, y) === 'bridge') continue
        if (openWidth(tiles, x, y) < PATH_WIDTH.side) narrow++
      }
    }
    expect(total).toBeGreaterThan(400)
    expect(narrow / total, `${narrow}/${total} tiles too narrow`).toBeLessThan(0.05)
  })

  it.each(SEEDS)('seed %i: the typical tile fits a party abreast', seed => {
    const tiles = floor(seed)
    const widths: number[] = []
    for (let y = 0; y < tiles.height; y += 2) {
      for (let x = 0; x < tiles.width; x += 2) {
        if (isWalkable(tiles, x, y)) widths.push(openWidth(tiles, x, y))
      }
    }
    widths.sort((a, b) => a - b)
    expect(widths[Math.floor(widths.length / 2)]).toBeGreaterThanOrEqual(PATH_WIDTH.main)
  })

  it('is still a cave, not an arena: most of the map is rock', () => {
    for (const seed of SEEDS) {
      const tiles = floor(seed)
      const walkable = tiles.tiles.filter(kind => WALKABLE.has(kind)).length
      expect(walkable / tiles.tiles.length).toBeLessThan(0.5)
    }
  })
})

describe('getting around (§19)', () => {
  it.each(SEEDS)('seed %i: the player starts on ground and can reach the exit', seed => {
    const tiles = floor(seed)
    expect(isWalkable(tiles, tiles.entrance.x, tiles.entrance.y)).toBe(true)
    expect(tileAt(tiles, tiles.exit.x, tiles.exit.y)).toBe('stairs')
    expect(flood(tiles, tiles.entrance).has(`${tiles.exit.x}:${tiles.exit.y}`)).toBe(true)
  })

  it.each(SEEDS)('seed %i: every room the plan made is connected to the entrance', seed => {
    const plan = generateFloor(dungeonProfile(seed, 'B', 'cave'), 3, POOL)
    const tiles = buildFloorTiles(plan, 'cave', seed)
    const reached = flood(tiles, tiles.entrance)
    for (const room of plan.rooms) {
      const centre = tiles.roomCentres[room.id]
      // The centre may land on a lake; its chamber still has to be reachable.
      const near = [[0, 0], [0, 3], [0, -3], [3, 0], [-3, 0], [5, 0], [-5, 0]]
        .some(([dx, dy]) => reached.has(`${centre.x + dx}:${centre.y + dy}`))
      expect(near, `room ${room.id} is cut off`).toBe(true)
    }
  })

  it.each(SEEDS)('seed %i: everything placed on the floor can be walked to', seed => {
    const plan = generateFloor(dungeonProfile(seed, 'B', 'cave'), 3, POOL)
    const tiles = buildFloorTiles(plan, 'cave', seed)
    const reached = flood(tiles, tiles.entrance)
    for (const entity of placeEntities(plan, tiles, seed)) {
      expect(isWalkable(tiles, entity.at.x, entity.at.y)).toBe(true)
      expect(reached.has(`${entity.at.x}:${entity.at.y}`), `${entity.id} is unreachable`).toBe(true)
    }
  })

  it.each(SEEDS)('seed %i: a Pokémon never plugs the only way past', seed => {
    const plan = generateFloor(dungeonProfile(seed, 'B', 'cave'), 3, POOL)
    const tiles = buildFloorTiles(plan, 'cave', seed)
    for (const entity of placeEntities(plan, tiles, seed)) {
      if (entity.kind === 'chest' || entity.isAlpha) continue
      // Standing here still leaves ground on both sides of the party.
      expect(openWidth(tiles, entity.at.x, entity.at.y), `${entity.id} blocks a pinch`)
        .toBeGreaterThan(PATH_WIDTH.pinch)
    }
  })
})

describe('where things are put (§13)', () => {
  it.each(SEEDS)('seed %i: a chest is against something, not in the middle of the road', seed => {
    const plan = generateFloor(dungeonProfile(seed, 'B', 'cave'), 3, POOL)
    const tiles = buildFloorTiles(plan, 'cave', seed)
    const chests = placeEntities(plan, tiles, seed).filter(entity => entity.kind === 'chest')
    for (const chest of chests) {
      const walls = [[0, -1], [0, 1], [-1, 0], [1, 0]]
        .filter(([dx, dy]) => !isWalkable(tiles, chest.at.x + dx, chest.at.y + dy)).length
      expect(walls, `${chest.id} is standing in the open`).toBeGreaterThan(0)
    }
  })

  it.each(SEEDS)('seed %i: the stairs have room in front of them', seed => {
    const tiles = floor(seed)
    let open = 0
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) if (isWalkable(tiles, tiles.exit.x + dx, tiles.exit.y + dy)) open++
    }
    expect(open).toBeGreaterThanOrEqual(18)
  })
})

describe('still deterministic (§14)', () => {
  it.each(DUNGEON_THEMES)('%s: the same seed builds the same floor', theme => {
    const plan = generateFloor(dungeonProfile(31337, 'B', theme), 4, POOL)
    const a = buildFloorTiles(plan, theme, 31337)
    const b = buildFloorTiles(plan, theme, 31337)
    expect(a.tiles).toEqual(b.tiles)
    expect(a.entrance).toEqual(b.entrance)
    expect(a.exit).toEqual(b.exit)
  })
})
