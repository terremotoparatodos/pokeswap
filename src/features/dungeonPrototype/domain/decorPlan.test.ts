// D1.2.2 §5, §17 — what looks like it blocks, blocks.
//
// The bug this pins down: props were drawn but never told the collision layer
// they existed, so a boulder was scenery you could walk through. The plan is now
// the single source for both, and these tests read it.

import { describe, expect, it } from 'vitest'
import { isSolidProp, planDecor, solidPropTiles, THEME_PROPS, type PropKind } from './decorPlan'
import { generateFloor } from './floorPlan'
import { buildFloorTiles, isWalkable, openWidth, PATH_WIDTH, type FloorTiles } from './floorTiles'
import { dungeonProfile, DUNGEON_THEMES, type DungeonTheme } from './tiers'

const POOL = [4, 7, 25]
const SEEDS = [13, 909, 31337]

const floor = (seed: number, theme: DungeonTheme = 'cave'): FloorTiles =>
  buildFloorTiles(generateFloor(dungeonProfile(seed, 'B', theme), 3, POOL), theme, seed)

describe('solid or decor (§5)', () => {
  const solid: PropKind[] = ['rock', 'boulder', 'tree', 'pine', 'snowpine', 'palm', 'cactus', 'bush', 'icerock', 'crystal']
  const decor: PropKind[] = ['torch', 'shell', 'coral']

  it.each(solid)('%s blocks, because it looks like it blocks', kind => {
    expect(isSolidProp(kind)).toBe(true)
  })

  it.each(decor)('%s does not block, because it does not look like it would', kind => {
    expect(isSolidProp(kind)).toBe(false)
  })

  it('every prop a biome can scatter has been classified one way or the other', () => {
    for (const theme of DUNGEON_THEMES) {
      for (const kind of [...THEME_PROPS[theme].wall, ...THEME_PROPS[theme].accent]) {
        expect(typeof isSolidProp(kind)).toBe('boolean')
      }
    }
  })
})

describe('where props are allowed to stand', () => {
  it.each(SEEDS)('seed %i: nothing solid stands on a tile a party needs', seed => {
    const tiles = floor(seed)
    for (const prop of planDecor(tiles, seed)) {
      if (!prop.solid || !isWalkable(tiles, prop.tx, prop.ty)) continue
      // It is on ground, so that ground has to be wide enough to walk around it.
      expect(openWidth(tiles, prop.tx, prop.ty), `${prop.tx},${prop.ty}`).toBeGreaterThan(PATH_WIDTH.main)
    }
  })

  it.each(SEEDS)('seed %i: nothing is ever placed on the spawn or the exit', seed => {
    const tiles = floor(seed)
    const blocked = solidPropTiles(planDecor(tiles, seed, 'B'))
    expect(blocked.has(`${tiles.entrance.x}:${tiles.entrance.y}`)).toBe(false)
    expect(blocked.has(`${tiles.exit.x}:${tiles.exit.y}`)).toBe(false)
  })

  it.each(SEEDS)('seed %i: a torch is always on rock and never blocks', seed => {
    const tiles = floor(seed)
    for (const prop of planDecor(tiles, seed)) {
      if (prop.kind !== 'torch') continue
      expect(isWalkable(tiles, prop.tx, prop.ty)).toBe(false)
      expect(prop.solid).toBe(false)
      expect(prop.light).toBe(true)
    }
  })
})

describe('Cave Style B dresses the same room (§8)', () => {
  it.each(SEEDS)('seed %i: B adds props but never changes the ground', seed => {
    const tiles = floor(seed)
    const before = [...tiles.tiles]
    const a = planDecor(tiles, seed, 'A')
    const b = planDecor(tiles, seed, 'B')
    expect(tiles.tiles).toEqual(before)
    expect(b.length).toBeGreaterThan(a.length)
  })

  it.each(SEEDS)('seed %i: B never narrows navigable ground below a main route', seed => {
    const tiles = floor(seed)
    for (const prop of planDecor(tiles, seed, 'B')) {
      if (!prop.solid || !isWalkable(tiles, prop.tx, prop.ty)) continue
      expect(openWidth(tiles, prop.tx, prop.ty)).toBeGreaterThan(PATH_WIDTH.main)
    }
  })

  it.each(SEEDS)('seed %i: both styles are deterministic', seed => {
    const tiles = floor(seed)
    expect(planDecor(tiles, seed, 'A')).toEqual(planDecor(tiles, seed, 'A'))
    expect(planDecor(tiles, seed, 'B')).toEqual(planDecor(tiles, seed, 'B'))
  })
})
