// D1.2.4 §1, §4 · D1.2.4ter §1, §2, §4 — what blocks, and what opens it.
//
// The promise: a block is one tile, it only ever closes an **optional** side
// room, the floor can always be finished without touching it, and clearing one
// gives nothing but the ground. The levels it quotes are the production
// catalog's, not numbers invented here.

import { describe, expect, it } from 'vitest'
import { GATHERING_NODES } from '../../professions/domain/catalog/nodes'
import { planDecor } from './decorPlan'
import { generateFloor } from './floorPlan'
import { buildFloorTiles, isWalkable, type FloorTiles } from './floorTiles'
import {
  blockedByObstacles, blockedByProps, exitReachableWithout, floorRequirements, isObstacleTile,
  minableProps, OBSTACLES, placeObstacles, QUOTED_NODES, reachableFrom, requirementForObstacle,
  requirementForProp, skillForProp,
} from './obstacles'
import { dungeonProfile, DUNGEON_THEMES, type DungeonTheme } from './tiers'

const POOL = [4, 7, 25]
const SEEDS = [11, 909, 2024, 55501, 31337]

const floor = (seed: number, theme: DungeonTheme = 'cave'): FloorTiles =>
  buildFloorTiles(generateFloor(dungeonProfile(seed, 'B', theme), 3, POOL), theme, seed)

describe('a block never closes a floor (§2)', () => {
  it.each(SEEDS)('seed %i: the exit is reachable with every block still in place', seed => {
    const tiles = floor(seed)
    expect(exitReachableWithout(tiles, placeObstacles(tiles, seed, 3))).toBe(true)
  })

  it.each(SEEDS)('seed %i: a block is one tile, and never the spawn or the stairs', seed => {
    const tiles = floor(seed)
    for (const obstacle of placeObstacles(tiles, seed, 3)) {
      expect(obstacle.at).not.toEqual(tiles.entrance)
      expect(obstacle.at).not.toEqual(tiles.exit)
      expect(isWalkable(tiles, obstacle.at.x, obstacle.at.y)).toBe(true)
    }
  })

  it.each(SEEDS)('seed %i: it stands in the mouth of an optional room', seed => {
    const tiles = floor(seed)
    const mouths = new Set((tiles.alcoves ?? []).map(alcove => `${alcove.mouth.x}:${alcove.mouth.y}`))
    for (const obstacle of placeObstacles(tiles, seed, 3)) {
      expect(mouths.has(`${obstacle.at.x}:${obstacle.at.y}`)).toBe(true)
      // And there is something worth coming back for behind it.
      expect(obstacle.opens).toBeGreaterThan(0)
    }
  })

  it.each(SEEDS)('seed %i: what it seals is a pocket, never the map', seed => {
    const tiles = floor(seed)
    const obstacles = placeObstacles(tiles, seed, 3)
    const open = reachableFrom(tiles, tiles.entrance, new Set())
    const sealed = reachableFrom(tiles, tiles.entrance, blockedByObstacles(obstacles))
    expect(sealed.size).toBeGreaterThan(open.size * 0.8)
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

describe('optional side rooms (§2)', () => {
  it.each(SEEDS)('seed %i: the floor carries at least one, with a one-tile mouth', seed => {
    const tiles = floor(seed)
    const alcoves = tiles.alcoves ?? []
    expect(alcoves.length).toBeGreaterThan(0)
    for (const alcove of alcoves) {
      expect(isWalkable(tiles, alcove.mouth.x, alcove.mouth.y)).toBe(true)
      expect(alcove.tiles.length).toBeGreaterThan(0)
    }
  })

  it.each(SEEDS)('seed %i: sealing the mouth cuts the room off, and only it', seed => {
    const tiles = floor(seed)
    for (const alcove of tiles.alcoves ?? []) {
      const sealed = reachableFrom(tiles, tiles.entrance, new Set([`${alcove.mouth.x}:${alcove.mouth.y}`]))
      // Nothing behind the mouth is reachable any more...
      const behind = alcove.tiles.filter(at => sealed.has(`${at.x}:${at.y}`))
      expect(behind).toHaveLength(0)
      // ...and the stairs still are.
      expect(sealed.has(`${tiles.exit.x}:${tiles.exit.y}`)).toBe(true)
    }
  })
})

describe('what they are made of', () => {
  it.each(DUNGEON_THEMES)('%s: uses blocks that belong to its biome', theme => {
    const tiles = floor(4242, theme)
    for (const obstacle of placeObstacles(tiles, 4242, 3)) {
      const definition = OBSTACLES[obstacle.kind]
      expect(['mine', 'chop']).toContain(definition.skill)
      expect(definition.seconds).toBeGreaterThan(0)
      if (theme === 'glacier') expect(obstacle.kind).not.toBe('roots')
      if (theme === 'forest') expect(obstacle.kind).not.toBe('crystal')
    }
  })

  it('blocks its tile until it is cleared, then stops', () => {
    const tiles = floor(909)
    const obstacles = placeObstacles(tiles, 909, 3)
    expect(obstacles.length).toBeGreaterThan(0)
    const first = obstacles[0]
    expect(isObstacleTile(obstacles, first.at.x, first.at.y)).toBe(true)
    first.cleared = true
    expect(isObstacleTile(obstacles, first.at.x, first.at.y)).toBe(false)
  })

  it.each(SEEDS)('seed %i: the same seed places the same blocks', seed => {
    const tiles = floor(seed)
    expect(placeObstacles(tiles, seed, 3)).toEqual(placeObstacles(tiles, seed, 3))
  })
})

// D1.2.4bis §1 — the scenery that shuts a way can be worked through too.
describe('the rocks and trees already lying around', () => {
  it.each(SEEDS)('seed %i: offers every solid prop standing on the ground', seed => {
    const tiles = floor(seed)
    const props = minableProps(tiles, seed, 3)
    const solidOnGround = planDecor(tiles, seed + 3 * 97)
      .filter(prop => prop.solid && isWalkable(tiles, prop.tx, prop.ty))
    expect(props).toHaveLength(solidOnGround.length)
    expect(props.length).toBeGreaterThan(0)
  })

  it.each(SEEDS)('seed %i: never offers one that is part of a wall', seed => {
    const tiles = floor(seed)
    for (const prop of minableProps(tiles, seed, 3)) {
      expect(isWalkable(tiles, prop.at.x, prop.at.y)).toBe(true)
    }
  })

  it('asks for the pick on stone and the axe on wood', () => {
    expect(skillForProp('boulder')).toBe('mine')
    expect(skillForProp('crystal')).toBe('mine')
    expect(skillForProp('tree')).toBe('chop')
    expect(skillForProp('bush')).toBe('chop')
    // Decoration stays decoration: there is nothing to break.
    expect(skillForProp('torch')).toBeNull()
    expect(skillForProp('shell')).toBeNull()
  })

  it('stops blocking once it is cleared', () => {
    const tiles = floor(909)
    const props = minableProps(tiles, 909, 3)
    const first = props[0]
    expect(blockedByProps(props).has(`${first.at.x}:${first.at.y}`)).toBe(true)
    first.cleared = true
    expect(blockedByProps(props).has(`${first.at.x}:${first.at.y}`)).toBe(false)
  })
})

// D1.2.4ter §1 — the level the dungeon quotes has to be the real one.
describe('the profession level it asks for', () => {
  const nodeOf = (id: string) => GATHERING_NODES.find(node => node.id === id)!

  it('quotes the production catalog exactly', () => {
    // R31 keeps professions isolated, so the prototype copies these numbers
    // instead of importing them. This is the test that keeps the copy honest:
    // it reads the real catalog and fails the day the two drift apart.
    for (const quoted of QUOTED_NODES) {
      const node = nodeOf(quoted.id)
      expect(node, quoted.id).toBeDefined()
      expect(node.requiredLevel, quoted.id).toBe(quoted.requiredLevel)
      expect(node.minToolTier, quoted.id).toBe(quoted.minToolTier)
      expect(node.profession).toBe(quoted.profession === 'mine' ? 'mining' : 'woodcutting')
      for (const anchor of quoted.anchors) expect(node.anchors).toContain(anchor)
    }
  })

  it('lands on a real node for everything it can block with', () => {
    for (const kind of ['rockfall', 'crystal', 'roots', 'timber'] as const) {
      const requirement = requirementForObstacle(kind)
      const node = nodeOf(requirement.nodeId)
      expect(node, kind).toBeDefined()
      expect(requirement.level).toBe(node.requiredLevel)
      expect(requirement.toolTier).toBe(node.minToolTier)
    }
  })

  it('names the profession behind the tool', () => {
    expect(requirementForObstacle('rockfall').profession).toBe('Minería')
    expect(requirementForObstacle('timber').profession).toBe('Tala')
    expect(requirementForProp('crystal')?.profession).toBe('Minería')
    expect(requirementForProp('torch')).toBeNull()
  })

  it('asks more for crystal than for plain rock', () => {
    expect(requirementForProp('crystal')!.level).toBeGreaterThan(requirementForProp('rock')!.level)
  })

  it.each(SEEDS)('seed %i: a floor quotes the hardest thing on it, per skill', seed => {
    const tiles = floor(seed)
    const obstacles = placeObstacles(tiles, seed, 3)
    const props = minableProps(tiles, seed, 3)
    const quoted = floorRequirements(obstacles, props)
    expect(quoted.length).toBeGreaterThan(0)
    for (const requirement of quoted) {
      const everything = [
        ...obstacles.map(obstacle => requirementForObstacle(obstacle.kind)),
        ...props.map(prop => prop.requirement),
      ].filter(candidate => candidate.skill === requirement.skill)
      expect(requirement.level).toBe(Math.max(...everything.map(candidate => candidate.level)))
    }
    // Sorted hardest first: that is the order it reads in.
    expect([...quoted].sort((a, b) => b.level - a.level)).toEqual(quoted)
  })
})
