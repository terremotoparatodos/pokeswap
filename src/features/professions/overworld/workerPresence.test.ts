import { describe, expect, it } from 'vitest'
import { DISMISS_SECONDS, faceToward, isBeside, presencePose, SUMMON_SECONDS, workerSpot } from './workerPresence'

const open = () => true
const player = { tx: 10, ty: 10 }
const SIDES = { north: { tx: 10, ty: 9 }, south: { tx: 10, ty: 11 }, west: { tx: 9, ty: 10 }, east: { tx: 11, ty: 10 } }

describe('worker spot', () => {
  it('stands beside the player, away from the swing, facing the node from every side', () => {
    expect(workerSpot(player, SIDES.north, open)).toEqual({ tx: 11, ty: 10, dir: 'up' })
    expect(workerSpot(player, SIDES.south, open)).toEqual({ tx: 9, ty: 10, dir: 'down' })
    expect(workerSpot(player, SIDES.west, open)).toEqual({ tx: 10, ty: 9, dir: 'left' })
    expect(workerSpot(player, SIDES.east, open)).toEqual({ tx: 10, ty: 9, dir: 'right' })
  })

  it('never uses the node or the player tile and stays adjacent to the player', () => {
    for (const target of Object.values(SIDES)) {
      const spot = workerSpot(player, target, open)!
      expect([spot.tx, spot.ty]).not.toEqual([target.tx, target.ty])
      expect([spot.tx, spot.ty]).not.toEqual([player.tx, player.ty])
      expect(Math.max(Math.abs(spot.tx - player.tx), Math.abs(spot.ty - player.ty))).toBe(1)
    }
  })

  it('works around obstacles: other side, slightly behind, straight behind, or nothing', () => {
    const blockedSides = (tx: number, ty: number) => !(ty === 10 && (tx === 9 || tx === 11))
    expect(workerSpot(player, SIDES.north, blockedSides)).toEqual({ tx: 11, ty: 11, dir: 'up' })
    const rightBlocked = (tx: number, ty: number) => !(tx === 11 && ty === 10)
    expect(workerSpot(player, SIDES.north, rightBlocked)).toEqual({ tx: 9, ty: 10, dir: 'up' })
    const onlyBehind = (tx: number, ty: number) => tx === 10 && ty === 11
    expect(workerSpot(player, SIDES.north, onlyBehind)).toEqual({ tx: 10, ty: 11, dir: 'up' })
    const northOnlyFreeForEast = (tx: number, ty: number) => tx === 10 && ty === 9
    expect(workerSpot(player, SIDES.east, northOnlyFreeForEast)).toEqual({ tx: 10, ty: 9, dir: 'right' })
    expect(workerSpot(player, SIDES.west, () => false)).toBeNull()
  })

  it('knows when the player is within reach of the node', () => {
    for (const target of Object.values(SIDES)) expect(isBeside(player, target)).toBe(true)
    expect(isBeside(player, { tx: 11, ty: 11 })).toBe(false)
    expect(isBeside(player, { tx: 10, ty: 13 })).toBe(false)
    expect(isBeside(player, player)).toBe(false)
  })

  it('faces along the dominant axis and keeps the player facing on diagonals', () => {
    expect(faceToward({ tx: 0, ty: 0 }, { tx: 3, ty: 1 }, 'up')).toBe('right')
    expect(faceToward({ tx: 0, ty: 0 }, { tx: -1, ty: -1 }, 'left')).toBe('left')
  })
})

describe('presence pose', () => {
  it('pops in quickly with a burst, then stays solid', () => {
    const start = presencePose(0, null, 0)
    expect(start.alpha).toBe(0)
    expect(start.scale).toBeCloseTo(0.35)
    expect(start.burst).toBe(0)
    expect(presencePose(0, null, SUMMON_SECONDS)).toMatchObject({ scale: 1, alpha: 1 })
    expect(presencePose(0, null, 5)).toEqual({ scale: 1, alpha: 1, burst: null, gone: false })
  })

  it('fades out fast and reports when it is gone', () => {
    expect(presencePose(0, 5, 5 + DISMISS_SECONDS / 2).alpha).toBeCloseTo(0.5)
    expect(presencePose(0, 5, 5 + DISMISS_SECONDS * 1.01).gone).toBe(true)
    expect(SUMMON_SECONDS + DISMISS_SECONDS).toBeLessThan(0.5)
  })
})
