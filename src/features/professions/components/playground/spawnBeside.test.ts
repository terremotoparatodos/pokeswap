import { describe, expect, it } from 'vitest'
import { World } from '../../../wildlands/engine/world'
import { PRADERA_LANDMARKS, PRADERA_SEED } from '../../demo/praderaLandmarks'
import { spawnBeside, type SpawnProbe } from './spawnBeside'

const key = (tx: number, ty: number) => `${tx},${ty}`

/** An open field where only the listed tiles are solid (`#`) or water (`~`). */
function field(blocked: Record<string, '#' | '~'> = {}): SpawnProbe {
  return {
    isSolid: (tx, ty) => blocked[key(tx, ty)] === '#',
    isWater: (tx, ty) => blocked[key(tx, ty)] === '~',
  }
}

const NODE = { tx: 10, ty: 10 }

describe('field lab spawn', () => {
  it('in open ground walks up from two tiles south, facing the node', () => {
    expect(spawnBeside(field(), NODE)).toEqual({ tx: 10, ty: 12, dir: 'up' })
  })

  it('needs the step in between to be clear before using the far tile', () => {
    // South step is solid: the far south tile is skipped, the far north one is used.
    expect(spawnBeside(field({ [key(10, 11)]: '#' }), NODE)).toEqual({ tx: 10, ty: 8, dir: 'down' })
  })

  it('tries the sides in a fixed order: south, north, east, west', () => {
    const southAndNorth = field({ [key(10, 11)]: '#', [key(10, 9)]: '~' })
    expect(spawnBeside(southAndNorth, NODE)).toEqual({ tx: 12, ty: 10, dir: 'left' })
    const allButWest = field({ [key(10, 11)]: '#', [key(10, 9)]: '~', [key(11, 10)]: '#' })
    expect(spawnBeside(allButWest, NODE)).toEqual({ tx: 8, ty: 10, dir: 'right' })
  })

  it('falls back to one step away when no far tile is reachable', () => {
    // Every far tile is blocked, the steps themselves are clear.
    const farBlocked = field({ [key(10, 12)]: '#', [key(10, 8)]: '#', [key(12, 10)]: '~', [key(8, 10)]: '~' })
    expect(spawnBeside(farBlocked, NODE)).toEqual({ tx: 10, ty: 11, dir: 'up' })
  })

  it('with every side blocked stands just south facing up (an open reef is swum to)', () => {
    const boxed = field({ [key(10, 11)]: '~', [key(10, 9)]: '~', [key(11, 10)]: '~', [key(9, 10)]: '~' })
    expect(spawnBeside(boxed, NODE)).toEqual({ tx: 10, ty: 11, dir: 'up' })
  })

  it('is deterministic for the real Pradera landmarks', () => {
    const world = new World(PRADERA_SEED)
    const first = PRADERA_LANDMARKS.map(landmark => spawnBeside(world, landmark))
    const second = PRADERA_LANDMARKS.map(landmark => spawnBeside(new World(PRADERA_SEED), landmark))
    expect(second).toEqual(first)
    for (const [index, spot] of first.entries()) {
      const landmark = PRADERA_LANDMARKS[index]
      expect(Math.abs(spot.tx - landmark.tx) + Math.abs(spot.ty - landmark.ty)).toBeLessThanOrEqual(2)
    }
  })
})
