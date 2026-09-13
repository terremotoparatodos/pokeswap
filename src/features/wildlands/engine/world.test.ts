import { describe, expect, it } from 'vitest'
import { fbm, hash2, valueNoise } from './noise'
import { isSolidDecor, T, World } from './world'

describe('noise', () => {
  it('is deterministic and bounded', () => {
    expect(hash2(12, -7, 3)).toBe(hash2(12, -7, 3))
    expect(hash2(12, -7, 3)).not.toBe(hash2(12, -7, 4))
    for (let i = 0; i < 200; i++) {
      const v = fbm(i * 1.37, -i * 0.71, 9)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('tiles seamlessly when a period is given', () => {
    expect(valueNoise(0.3, 1.7, 5, 8)).toBeCloseTo(valueNoise(8.3, 9.7, 5, 8), 10)
  })
})

describe('World', () => {
  it('generates the same terrain for the same seed', () => {
    const a = new World(42)
    const b = new World(42)
    for (let i = -50; i < 50; i += 7) {
      expect(a.vertexTerrain(i, i * 2)).toBe(b.vertexTerrain(i, i * 2))
      expect(a.decorAt(i, -i)).toBe(b.decorAt(i, -i))
    }
  })

  it('only places decor on tiles whose corners agree', () => {
    const world = new World(1337)
    expect(world.decorAt(0, 0, [T.SAND, T.SAND, T.WATER, T.SAND])).toBeNull()
  })

  it('spawns the player on an open, dry tile', () => {
    const world = new World(1337)
    const { tx, ty } = world.findSpawn()
    expect(world.isWater(tx, ty)).toBe(false)
    expect(world.isSolid(tx, ty)).toBe(false)
  })

  it('treats flat decor as walkable', () => {
    expect(isSolidDecor('crystal')).toBe(false)
    expect(isSolidDecor('shell')).toBe(false)
    expect(isSolidDecor('cactus')).toBe(true)
  })
})
