import { describe, expect, it } from 'vitest'
import { workerSpot } from './workerActors'

describe('workerSpot', () => {
  const open = () => false
  it('stands on the open side of the node nearest the trainer, never on the trainer', () => {
    const spot = workerSpot({ tx: 0, ty: 0 }, { tx: 0, ty: 1 }, open)
    expect(spot).not.toMatchObject({ tx: 0, ty: 1 })
    expect(Math.max(Math.abs(spot.tx), Math.abs(spot.ty - 1))).toBe(1)
  })
  it('faces the node', () => {
    expect(workerSpot({ tx: 0, ty: 0 }, null, open)).toEqual({ tx: 0, ty: 1, dir: 'up' })
    expect(workerSpot({ tx: 0, ty: 0 }, null, (tx, ty) => tx === 0 && ty === 1)).toEqual({ tx: 1, ty: 0, dir: 'left' })
  })
  it('is the same for every client given the same facts', () => {
    const a = workerSpot({ tx: 5, ty: 5 }, { tx: 4, ty: 5 }, (tx) => tx === 6)
    const b = workerSpot({ tx: 5, ty: 5 }, { tx: 4, ty: 5 }, (tx) => tx === 6)
    expect(a).toEqual(b)
  })
})
