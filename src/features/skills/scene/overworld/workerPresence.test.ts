import { describe, expect, it } from 'vitest'
import { isBeside } from './workerPresence'

const player = { tx: 10, ty: 10 }
const SIDES = { north: { tx: 10, ty: 9 }, south: { tx: 10, ty: 11 }, west: { tx: 9, ty: 10 }, east: { tx: 11, ty: 10 } }

describe('reach', () => {
  it('knows when the player is within reach of the node', () => {
    for (const target of Object.values(SIDES)) expect(isBeside(player, target)).toBe(true)
    expect(isBeside(player, { tx: 11, ty: 11 })).toBe(false)
    expect(isBeside(player, { tx: 10, ty: 13 })).toBe(false)
    expect(isBeside(player, player)).toBe(false)
  })
})
