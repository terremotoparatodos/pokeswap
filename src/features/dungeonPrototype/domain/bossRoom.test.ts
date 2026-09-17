// D1.2.2 §17 — the Boss Room is a designed space, so it can be measured.
//
// Everything a boss fight needs has a spot, every spot is on ground, the middle
// is clear, the decor stays out of it, and four players fit with their Pokémon.

import { describe, expect, it } from 'vitest'
import { BOSS_ROOM, bossOccupancy, isBossDecorSpot, isBossFloor } from './bossRoom'
import { planDecor, solidPropTiles } from './decorPlan'
import { generateFloor } from './floorPlan'
import { buildFloorTiles, isWalkable, openWidth, PATH_WIDTH, placeEntities, tileAt } from './floorTiles'
import { dungeonProfile, DUNGEON_THEMES, type DungeonTheme } from './tiers'
import type { TilePoint } from './tileKinds'

const POOL = [4, 7, 25, 133]

/** The last floor of a dungeon: the one the generator sends to the Boss Room. */
function bossFloorOf(seed: number, theme: DungeonTheme = 'cave') {
  const profile = dungeonProfile(seed, 'B', theme)
  const plan = generateFloor(profile, profile.floors, POOL)
  const tiles = buildFloorTiles(plan, theme, seed)
  return { profile, plan, tiles }
}

function flood(tiles: ReturnType<typeof buildFloorTiles>, start: TilePoint): Set<string> {
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

const SEEDS = [7, 2024, 55501]

describe('the last floor is a room, not a floor (§9)', () => {
  it.each(SEEDS)('seed %i: the boss floor carries its layout and the others do not', seed => {
    const { tiles } = bossFloorOf(seed)
    expect(isBossFloor(tiles)).toBe(true)

    const plan = generateFloor(dungeonProfile(seed, 'B', 'cave'), 2, POOL)
    expect(isBossFloor(buildFloorTiles(plan, 'cave', seed))).toBe(false)
  })

  it.each(DUNGEON_THEMES)('%s: the room inherits the dungeon biome (§11)', theme => {
    const { tiles } = bossFloorOf(4242, theme)
    expect(tiles.theme).toBe(theme)
    // The hall is dressed with that biome's own patches, not bare floor.
    expect(tiles.tiles.filter(kind => kind === 'accent').length).toBeGreaterThan(10)
  })

  it.each(SEEDS)('seed %i: the same seed builds the same room', seed => {
    const a = bossFloorOf(seed).tiles
    const b = bossFloorOf(seed).tiles
    expect(a.tiles).toEqual(b.tiles)
    expect(isBossFloor(a) && isBossFloor(b) && a.boss).toEqual(isBossFloor(b) ? b.boss : null)
  })
})

describe('room to fight in (§10)', () => {
  it.each(SEEDS)('seed %i: every slot the fight needs is on walkable ground', seed => {
    const { tiles } = bossFloorOf(seed)
    if (!isBossFloor(tiles)) throw new Error('not a boss floor')
    for (const spot of bossOccupancy(tiles.boss)) {
      expect(isWalkable(tiles, spot.x, spot.y), `${spot.x},${spot.y}`).toBe(true)
    }
  })

  it.each(SEEDS)('seed %i: no two slots share a tile', seed => {
    const { tiles } = bossFloorOf(seed)
    if (!isBossFloor(tiles)) throw new Error('not a boss floor')
    const spots = [tiles.boss.alpha, ...tiles.boss.trainers, ...tiles.boss.allies]
    expect(new Set(spots.map(spot => `${spot.x}:${spot.y}`)).size).toBe(spots.length)
  })

  it.each(SEEDS)('seed %i: the Alpha is never on the way in or on a spawn (§14)', seed => {
    const { tiles } = bossFloorOf(seed)
    if (!isBossFloor(tiles)) throw new Error('not a boss floor')
    const { alpha, door, approach, trainers } = tiles.boss
    expect(alpha).not.toEqual(door)
    expect(alpha).not.toEqual(approach)
    expect(alpha).not.toEqual(tiles.entrance)
    for (const slot of trainers) expect(alpha).not.toEqual(slot)
    // And the entity the rules place really is on that slot.
    const plan = generateFloor(dungeonProfile(seed, 'B', 'cave'), dungeonProfile(seed, 'B', 'cave').floors, POOL)
    const boss = placeEntities(plan, tiles, seed).find(entity => entity.isAlpha)
    expect(boss?.at).toEqual(alpha)
  })

  it.each(SEEDS)('seed %i: the middle is wide open, with no pinch inside it', seed => {
    const { tiles } = bossFloorOf(seed)
    if (!isBossFloor(tiles)) throw new Error('not a boss floor')
    const { centre } = tiles.boss
    for (let dy = -6; dy <= 6; dy++) {
      for (let dx = -8; dx <= 8; dx++) {
        const x = centre.x + dx
        const y = centre.y + dy
        expect(isWalkable(tiles, x, y), `${x},${y} is not floor`).toBe(true)
        expect(openWidth(tiles, x, y)).toBeGreaterThan(PATH_WIDTH.main)
      }
    }
  })

  it.each(SEEDS)('seed %i: four trainers and four Pokémon all fit inside the hall', seed => {
    const { tiles } = bossFloorOf(seed)
    if (!isBossFloor(tiles)) throw new Error('not a boss floor')
    expect(tiles.boss.trainers).toHaveLength(4)
    expect(tiles.boss.allies).toHaveLength(4)
    const reached = flood(tiles, tiles.entrance)
    for (const spot of [...tiles.boss.trainers, ...tiles.boss.allies]) {
      expect(reached.has(`${spot.x}:${spot.y}`), `${spot.x},${spot.y} unreachable`).toBe(true)
    }
  })

  it.each(SEEDS)('seed %i: nothing solid is ever placed in the arena', seed => {
    const { tiles } = bossFloorOf(seed)
    if (!isBossFloor(tiles)) throw new Error('not a boss floor')
    const solid = solidPropTiles(planDecor(tiles, seed, 'B'))
    for (const key of solid) {
      const [x, y] = key.split(':').map(Number)
      expect(isBossDecorSpot(tiles.boss, x, y), `prop at ${key} is in the middle`).toBe(true)
    }
  })
})

describe('the way in (§12, §13)', () => {
  it.each(SEEDS)('seed %i: the player lands in the antechamber and can walk to the door', seed => {
    const { tiles } = bossFloorOf(seed)
    if (!isBossFloor(tiles)) throw new Error('not a boss floor')
    expect(isWalkable(tiles, tiles.entrance.x, tiles.entrance.y)).toBe(true)
    const reached = flood(tiles, tiles.entrance)
    expect(reached.has(`${tiles.boss.approach.x}:${tiles.boss.approach.y}`)).toBe(true)
    expect(reached.has(`${tiles.boss.door.x}:${tiles.boss.door.y}`)).toBe(true)
  })

  it.each(SEEDS)('seed %i: the prompt tile is the one in front of the door', seed => {
    const { tiles } = bossFloorOf(seed)
    if (!isBossFloor(tiles)) throw new Error('not a boss floor')
    // `exit` is what the rules watch for the antechamber prompt.
    expect(tiles.exit).toEqual(tiles.boss.approach)
    expect(tileAt(tiles, tiles.exit.x, tiles.exit.y)).not.toBe('rock')
  })

  it.each(SEEDS)('seed %i: the passage in is as wide as a main route', seed => {
    const { tiles } = bossFloorOf(seed)
    if (!isBossFloor(tiles)) throw new Error('not a boss floor')
    expect(openWidth(tiles, tiles.boss.approach.x, tiles.boss.approach.y)).toBeGreaterThanOrEqual(BOSS_ROOM.corridorWidth)
  })
})

// D1.2.4bis §2 — close quarters: two tiles to the Alpha, three behind our own.
describe('how close the fight stands', () => {
  it.each(SEEDS)('seed %i: our Pokémon are two tiles off the Alpha', seed => {
    const { tiles } = bossFloorOf(seed)
    if (!isBossFloor(tiles)) throw new Error('not a boss floor')
    const boss = tiles.boss
    for (const ally of boss.allies) {
      expect(ally.y - boss.alpha.y).toBe(2)
      expect(Math.abs(ally.x - boss.alpha.x)).toBeLessThanOrEqual(3)
    }
  })

  it.each(SEEDS)('seed %i: the trainer stands three tiles behind their Pokémon', seed => {
    const { tiles } = bossFloorOf(seed)
    if (!isBossFloor(tiles)) throw new Error('not a boss floor')
    const boss = tiles.boss
    for (let i = 0; i < boss.trainers.length; i++) {
      expect(boss.trainers[i].y - boss.allies[i].y).toBe(3)
      expect(boss.trainers[i].x).toBe(boss.allies[i].x)
    }
  })

  it('fills the middle slots first, which is what a solo run sees', () => {
    const { tiles } = bossFloorOf(SEEDS[0])
    if (!isBossFloor(tiles)) throw new Error('not a boss floor')
    const boss = tiles.boss
    const offsets = boss.allies.map(ally => Math.abs(ally.x - boss.alpha.x))
    expect(offsets[0]).toBeLessThan(offsets[2])
    expect(offsets[1]).toBeLessThan(offsets[3])
  })
})
