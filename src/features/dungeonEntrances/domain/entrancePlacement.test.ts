import { describe, expect, it } from 'vitest'
import {
  entranceApproach, entranceFootprint, fits, placeEntrances,
  type EntranceWorldPort, type PlacementConfig,
} from './entrancePlacement'

const SHAPE = { width: 3, depth: 2 }
const config = (over: Partial<PlacementConfig> = {}): PlacementConfig =>
  ({ ...SHAPE, minRing: 4, maxRing: 12, count: 4, minSpacing: 5, ...over })

/** An empty plain, with optional blocked tiles. */
function world(blocked: { solid?: string[]; water?: string[]; taken?: string[] } = {}): EntranceWorldPort {
  const set = (list?: string[]) => new Set(list ?? [])
  const solid = set(blocked.solid)
  const water = set(blocked.water)
  const taken = set(blocked.taken)
  return {
    isSolid: (tx, ty) => solid.has(`${tx}:${ty}`),
    isWater: (tx, ty) => water.has(`${tx}:${ty}`),
    isTaken: (tx, ty) => taken.has(`${tx}:${ty}`),
  }
}

describe('footprint and approach', () => {
  it('grows northwards from the front-left tile, like every other placed object', () => {
    expect(entranceFootprint({ tx: 10, ty: 20 }, SHAPE)).toEqual([
      { tx: 10, ty: 20 }, { tx: 11, ty: 20 }, { tx: 12, ty: 20 },
      { tx: 10, ty: 19 }, { tx: 11, ty: 19 }, { tx: 12, ty: 19 },
    ])
  })

  it('puts the approach directly in front of the middle of the mouth', () => {
    expect(entranceApproach({ tx: 10, ty: 20 }, SHAPE)).toEqual({ tx: 11, ty: 21 })
  })
})

describe('fits', () => {
  it('accepts open ground', () => {
    expect(fits(world(), { tx: 0, ty: 0 }, SHAPE)).toBe(true)
  })

  it('refuses a footprint over water, rock or something already placed', () => {
    expect(fits(world({ water: ['1:-1'] }), { tx: 0, ty: 0 }, SHAPE)).toBe(false)
    expect(fits(world({ solid: ['2:0'] }), { tx: 0, ty: 0 }, SHAPE)).toBe(false)
    expect(fits(world({ taken: ['0:0'] }), { tx: 0, ty: 0 }, SHAPE)).toBe(false)
  })

  it('refuses a cave nobody could walk up to, even when the rock itself fits', () => {
    // Footprint clear, approach tile under water: a mouth facing a lake.
    expect(fits(world({ water: ['1:1'] }), { tx: 0, ty: 0 }, SHAPE)).toBe(false)
  })
})

describe('placeEntrances', () => {
  const origin = { tx: 0, ty: 0 }

  it('places the requested number on an open plain', () => {
    expect(placeEntrances(world(), origin, 208, config())).toHaveLength(4)
  })

  it('is deterministic: same world, same origin, same seed, same caves', () => {
    const a = placeEntrances(world(), origin, 208, config())
    const b = placeEntrances(world(), origin, 208, config())
    expect(b).toEqual(a)
  })

  it('a different seed moves them', () => {
    const a = placeEntrances(world(), origin, 208, config())
    const b = placeEntrances(world(), origin, 999, config())
    expect(b).not.toEqual(a)
  })

  it('never lands on the arrival point, and never inside the inner ring', () => {
    for (const { footprint } of placeEntrances(world(), origin, 208, config({ count: 6 }))) {
      for (const tile of footprint) {
        expect(Math.max(Math.abs(tile.tx), Math.abs(tile.ty))).toBeGreaterThanOrEqual(config().minRing - 1)
      }
    }
  })

  it('keeps every cave inside the searched band', () => {
    const settings = config({ count: 6, maxRing: 10 })
    for (const { anchor } of placeEntrances(world(), origin, 7, settings)) {
      const ring = Math.max(Math.abs(anchor.tx), Math.abs(anchor.ty))
      expect(ring).toBeGreaterThanOrEqual(settings.minRing)
      expect(ring).toBeLessThanOrEqual(settings.maxRing)
    }
  })

  it('keeps them apart', () => {
    const placed = placeEntrances(world(), origin, 208, config({ count: 6, minSpacing: 5 }))
    for (const a of placed) {
      for (const b of placed) {
        if (a === b) continue
        expect(Math.max(Math.abs(a.anchor.tx - b.anchor.tx), Math.abs(a.anchor.ty - b.anchor.ty))).toBeGreaterThanOrEqual(5)
      }
    }
  })

  it('never overlaps two footprints', () => {
    const placed = placeEntrances(world(), origin, 31, config({ count: 6, minSpacing: 4 }))
    const seen = new Set<string>()
    for (const { footprint } of placed) {
      for (const tile of footprint) {
        const key = `${tile.tx}:${tile.ty}`
        expect(seen.has(key)).toBe(false)
        seen.add(key)
      }
    }
  })

  it('every cave placed is one the placement rules would accept', () => {
    const port = world({ water: ['6:6', '7:7', '-8:3'], solid: ['5:-5', '9:2'] })
    for (const { anchor } of placeEntrances(port, origin, 208, config({ count: 6 }))) {
      expect(fits(port, anchor, SHAPE)).toBe(true)
    }
  })

  it('returns fewer rather than worse when the world is closed', () => {
    const everywhere: EntranceWorldPort = { isSolid: () => true, isWater: () => false, isTaken: () => false }
    expect(placeEntrances(everywhere, origin, 208, config())).toEqual([])
  })

  it('an approach that is solid rules the tile out, so every cave is enterable', () => {
    const placed = placeEntrances(world(), origin, 208, config({ count: 6 }))
    const rock = new Set(placed.flatMap(p => p.footprint.map(t => `${t.tx}:${t.ty}`)))
    for (const { approach } of placed) expect(rock.has(`${approach.tx}:${approach.ty}`)).toBe(false)
  })
})
