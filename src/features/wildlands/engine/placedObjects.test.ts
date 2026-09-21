// F-1 — the physical layer for things placed in the world.
//
// These are the promises the engine and the features will lean on: an empty
// registry changes nothing, a placed object owns its tiles, an area only sees
// its own, and removing one leaves no trace.

import { describe, expect, it } from 'vitest'
import { besidePlaced, placedObject, PlacedObjects } from './placedObjects'

const bench = placedObject({ id: 'bench', areaId: 'pradera', anchor: { tx: 4, ty: -7 }, kind: 'alchemyTable' })

describe('an empty registry is neutral', () => {
  it('answers no to everything and holds nothing', () => {
    const placed = new PlacedObjects()
    expect(placed.size).toBe(0)
    expect(placed.isSolid('pradera', 4, -7)).toBe(false)
    expect(placed.isInteractive('pradera', 4, -7)).toBe(false)
    expect(placed.at('pradera', 4, -7)).toBeNull()
    expect(placed.inArea('pradera')).toEqual([])
  })
})

describe('a solid object owns its tile', () => {
  it('blocks its own tile and nothing else', () => {
    const placed = new PlacedObjects()
    placed.register(bench)
    expect(placed.isSolid('pradera', 4, -7)).toBe(true)
    expect(placed.at('pradera', 4, -7)?.id).toBe('bench')
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      expect(placed.isSolid('pradera', 4 + dx, -7 + dy), `${dx},${dy}`).toBe(false)
    }
  })

  it('is used from the four tiles around it', () => {
    expect(placed1x1Beside()).toEqual([
      { tx: 4, ty: -6 }, { tx: 4, ty: -8 }, { tx: 5, ty: -7 }, { tx: 3, ty: -7 },
    ])
  })

  const placed1x1Beside = () => besidePlaced(bench)
})

describe('an interactive object that does not block', () => {
  it('is reported as interactive but never as solid', () => {
    const placed = new PlacedObjects()
    placed.register(placedObject({
      id: 'mark', areaId: 'pradera', anchor: { tx: 0, ty: 0 }, kind: 'campfire', solid: false,
    }))
    expect(placed.isSolid('pradera', 0, 0)).toBe(false)
    expect(placed.isInteractive('pradera', 0, 0)).toBe(true)
    expect(placed.at('pradera', 0, 0)?.id).toBe('mark')
  })

  it('and one that blocks without being usable is the other way round', () => {
    const placed = new PlacedObjects()
    placed.register(placedObject({
      id: 'block', areaId: 'pradera', anchor: { tx: 1, ty: 1 }, kind: 'workbench', interactive: false,
    }))
    expect(placed.isSolid('pradera', 1, 1)).toBe(true)
    expect(placed.isInteractive('pradera', 1, 1)).toBe(false)
  })
})

describe('several objects', () => {
  it('reuses the per-area view until the registry changes', () => {
    const placed = new PlacedObjects()
    placed.register(bench)
    const first = placed.inArea('pradera')
    expect(placed.inArea('pradera')).toBe(first)
    placed.register(placedObject({ id: 'oven', areaId: 'pradera', anchor: { tx: 9, ty: -2 }, kind: 'smelter' }))
    expect(placed.inArea('pradera')).not.toBe(first)
    expect(placed.inArea('pradera')).toHaveLength(2)
  })

  it('each owns its own tiles', () => {
    const placed = new PlacedObjects()
    placed.register(bench)
    placed.register(placedObject({ id: 'oven', areaId: 'pradera', anchor: { tx: 9, ty: -2 }, kind: 'smelter' }))
    expect(placed.size).toBe(2)
    expect(placed.at('pradera', 4, -7)?.id).toBe('bench')
    expect(placed.at('pradera', 9, -2)?.id).toBe('oven')
    expect(placed.isSolid('pradera', 6, -4)).toBe(false)
    expect(placed.inArea('pradera')).toHaveLength(2)
  })

  it('registering the same id twice replaces it instead of leaving a ghost', () => {
    const placed = new PlacedObjects()
    placed.register(bench)
    placed.register(placedObject({ id: 'bench', areaId: 'pradera', anchor: { tx: 20, ty: 20 }, kind: 'alchemyTable' }))
    expect(placed.size).toBe(1)
    expect(placed.isSolid('pradera', 4, -7)).toBe(false)
    expect(placed.isSolid('pradera', 20, 20)).toBe(true)
  })

  it('two objects on the same tile: the last one registered answers, and it stays solid', () => {
    const placed = new PlacedObjects()
    placed.register(bench)
    placed.register(placedObject({ id: 'other', areaId: 'pradera', anchor: { tx: 4, ty: -7 }, kind: 'smelter' }))
    expect(placed.at('pradera', 4, -7)?.id).toBe('other')
    expect(placed.isSolid('pradera', 4, -7)).toBe(true)
    placed.unregister('other')
    expect(placed.at('pradera', 4, -7)?.id).toBe('bench')
  })
})

describe('removal and areas', () => {
  it('unregistering frees the tile, and doing it twice is harmless', () => {
    const placed = new PlacedObjects()
    placed.register(bench)
    placed.unregister('bench')
    placed.unregister('bench')
    expect(placed.size).toBe(0)
    expect(placed.isSolid('pradera', 4, -7)).toBe(false)
  })

  it('an object never leaks into another area', () => {
    const placed = new PlacedObjects()
    placed.register(bench)
    expect(placed.isSolid('ciudad-corazon', 4, -7)).toBe(false)
    expect(placed.at('ciudad-corazon', 4, -7)).toBeNull()
    expect(placed.inArea('ciudad-corazon')).toEqual([])
  })

  it('clearing one area leaves the others alone', () => {
    const placed = new PlacedObjects()
    placed.register(bench)
    placed.register(placedObject({ id: 'town-bench', areaId: 'ciudad-corazon', anchor: { tx: 2, ty: 2 }, kind: 'alchemyTable' }))
    placed.clearArea('pradera')
    expect(placed.isSolid('pradera', 4, -7)).toBe(false)
    expect(placed.isSolid('ciudad-corazon', 2, 2)).toBe(true)
    placed.clear()
    expect(placed.size).toBe(0)
  })
})

// The first objects are 1×1, but the contract is already tiles, not a point.
describe('ready for a bigger footprint', () => {
  it('a 2×2 object covers four tiles and is solid on all of them', () => {
    const placed = new PlacedObjects()
    placed.register(placedObject({
      id: 'oven', areaId: 'pradera', anchor: { tx: 0, ty: 0 }, kind: 'smelter', width: 2, depth: 2,
    }))
    const covered = [{ tx: 0, ty: 0 }, { tx: 1, ty: 0 }, { tx: 0, ty: -1 }, { tx: 1, ty: -1 }]
    for (const tile of covered) expect(placed.isSolid('pradera', tile.tx, tile.ty), `${tile.tx},${tile.ty}`).toBe(true)
    expect(placed.isSolid('pradera', 2, 0)).toBe(false)
    expect(placed.isSolid('pradera', 0, 1)).toBe(false)
  })

  it('its adjacency ring surrounds the whole footprint, never its own tiles', () => {
    const wide = placedObject({
      id: 'oven', areaId: 'pradera', anchor: { tx: 0, ty: 0 }, kind: 'smelter', width: 2, depth: 2,
    })
    const ring = besidePlaced(wide)
    expect(ring).toHaveLength(8)
    for (const tile of wide.footprint) {
      expect(ring.some(at => at.tx === tile.tx && at.ty === tile.ty), 'ring must not stand on the object').toBe(false)
    }
  })

  it('carries the hitbox its art declares, without inventing one', () => {
    const plain = placedObject({ id: 'plain', areaId: 'pradera', anchor: { tx: 0, ty: 0 }, kind: 'campfire' })
    expect(plain.hitbox).toBeUndefined()
    const tall = placedObject({
      id: 'oven', areaId: 'pradera', anchor: { tx: 0, ty: 0 }, kind: 'smelter', hitbox: { width: 34, height: 30 },
    })
    expect(tall.hitbox).toEqual({ width: 34, height: 30 })
  })
})
