// D1.2 §15, §33 — where a fight puts everybody.
//
// These are the invariants the visual pass is built on: the foe keeps its tile
// and is never duplicated, our Pokémon land on real ground, nobody shares a
// tile with anybody else, and the trainer stays where they are.

import { describe, expect, it } from 'vitest'
import { generateFloor } from '../domain/floorPlan'
import { buildFloorTiles, isWalkable, type FloorTiles, type TilePoint } from '../domain/floorTiles'
import { dungeonProfile } from '../domain/tiers'
import { facingBetween, openGround, stageCombat } from './combatStaging'

function floor(seed = 909): FloorTiles {
  const plan = generateFloor(dungeonProfile(seed, 'B', 'cave'), 3, [4, 7, 25])
  return buildFloorTiles(plan, 'cave', seed)
}

/** A walkable tile with at least two walkable neighbours, so staging has room. */
function roomyTile(tiles: FloorTiles): TilePoint {
  for (let y = 1; y < tiles.height - 1; y++) {
    for (let x = 1; x < tiles.width - 1; x++) {
      if (!isWalkable(tiles, x, y)) continue
      const open = [[0, 1], [0, -1], [1, 0], [-1, 0]].filter(([dx, dy]) => isWalkable(tiles, x + dx, y + dy))
      if (open.length >= 3) return { x, y }
    }
  }
  throw new Error('no roomy tile on this floor')
}

const same = (a: TilePoint, b: TilePoint): boolean => a.x === b.x && a.y === b.y

describe('open ground', () => {
  it('only ever offers walkable tiles', () => {
    const tiles = floor()
    const centre = roomyTile(tiles)
    for (const spot of openGround(tiles, centre, [])) {
      expect(isWalkable(tiles, spot.x, spot.y), `${spot.x},${spot.y}`).toBe(true)
    }
  })

  it('never offers a tile somebody is already on', () => {
    const tiles = floor()
    const centre = roomyTile(tiles)
    const taken = openGround(tiles, centre, [])[0]
    expect(openGround(tiles, centre, [taken]).some(spot => same(spot, taken))).toBe(false)
  })

  it('offers the tile closest to what we prefer first', () => {
    const tiles = floor()
    const centre = roomyTile(tiles)
    const prefer = { x: centre.x - 4, y: centre.y }
    const spots = openGround(tiles, centre, [], prefer)
    const distances = spots.map(spot => Math.hypot(spot.x - prefer.x, spot.y - prefer.y))
    expect([...distances].sort((a, b) => a - b)).toEqual(distances)
  })
})

describe('staging a fight', () => {
  it('leaves the foe on its own tile and keeps the trainer on theirs', () => {
    const tiles = floor()
    const foe = roomyTile(tiles)
    const trainer = openGround(tiles, foe, [])[0]
    const staged = stageCombat(tiles, foe, trainer, [])
    expect(staged.foe).toEqual(foe)
    // Nothing in the result moves the trainer: the caller keeps their tile.
    expect(staged.allies.every(spot => !same(spot, trainer))).toBe(true)
  })

  it('never puts our Pokémon in a wall, in water or on the foe', () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const foe = roomyTile(floor(900 + attempt))
      const board = floor(900 + attempt)
      if (!isWalkable(board, foe.x, foe.y)) continue
      const trainer = openGround(board, foe, [])[0]
      const staged = stageCombat(board, foe, trainer, [], 2)
      for (const spot of staged.allies) {
        expect(isWalkable(board, spot.x, spot.y)).toBe(true)
        expect(same(spot, foe)).toBe(false)
      }
    }
  })

  it('gives two Pokémon two different tiles', () => {
    const tiles = floor()
    const foe = roomyTile(tiles)
    const trainer = openGround(tiles, foe, [])[0]
    const staged = stageCombat(tiles, foe, trainer, [], 2)
    expect(staged.allies).toHaveLength(2)
    expect(same(staged.allies[0], staged.allies[1])).toBe(false)
  })

  it('keeps away from a Pokémon that is standing there already', () => {
    const tiles = floor()
    const foe = roomyTile(tiles)
    const trainer = openGround(tiles, foe, [])[0]
    const bystander = openGround(tiles, foe, [trainer])[0]
    const staged = stageCombat(tiles, foe, trainer, [bystander])
    expect(staged.allies.some(spot => same(spot, bystander))).toBe(false)
  })

  it('turns the trainer and the foe to face the fight', () => {
    const tiles = floor()
    const foe = roomyTile(tiles)
    const trainer = openGround(tiles, foe, [])[0]
    const staged = stageCombat(tiles, foe, trainer, [])
    expect(staged.trainerFacing).toBe(facingBetween(trainer, foe))
    expect(['up', 'down', 'left', 'right']).toContain(staged.foeFacing)
  })
})

describe('facing', () => {
  it('reads the dominant axis', () => {
    expect(facingBetween({ x: 0, y: 0 }, { x: 3, y: 1 })).toBe('right')
    expect(facingBetween({ x: 0, y: 0 }, { x: -3, y: 1 })).toBe('left')
    expect(facingBetween({ x: 0, y: 0 }, { x: 1, y: 4 })).toBe('down')
    expect(facingBetween({ x: 0, y: 0 }, { x: 1, y: -4 })).toBe('up')
  })
})
