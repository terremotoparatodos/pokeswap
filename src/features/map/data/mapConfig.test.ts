// mapConfig.test.ts — R16
// Tests for map positioning utilities.
// The WALKMAP global is absent in the test environment; isWalkable must
// fall back to "all tiles walkable" so spawn functions still return results.

import { describe, it, expect, beforeEach } from 'vitest'
import {
  isWalkable,
  getHearthomePoint,
  getSpawnPoint,
  MAP_W, MAP_H,
  ZONES, ZONE_TYPES,
} from './mapConfig'

describe('isWalkable', () => {
  it('returns true when WALKMAP is absent (test environment fallback)', () => {
    expect(isWalkable(100, 100)).toBe(true)
  })

  it('returns true when WALKMAP is present and tile is walkable', () => {
    ;(globalThis as Record<string, unknown>)['WALKMAP'] = [[0, 1], [1, 0]]
    expect(isWalkable(0, 0)).toBe(true)   // row 0, col 0 → 0
    expect(isWalkable(16, 0)).toBe(false) // row 0, col 1 → 1
    delete (globalThis as Record<string, unknown>)['WALKMAP']
  })
})

describe('getHearthomePoint', () => {
  it('returns a point within MAP_W × MAP_H bounds', () => {
    for (let i = 0; i < 10; i++) {
      const { x, y } = getHearthomePoint()
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(MAP_W)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThan(MAP_H)
    }
  })

  it('returns a point within the Hearthome zone bounds', () => {
    const zone = ZONES.find(z => z.name === 'hearthome')!
    for (let i = 0; i < 10; i++) {
      const { x, y } = getHearthomePoint()
      expect(x).toBeGreaterThanOrEqual(zone.x)
      expect(x).toBeLessThan(zone.x + zone.w)
      expect(y).toBeGreaterThanOrEqual(zone.y)
      expect(y).toBeLessThan(zone.y + zone.h)
    }
  })
})

describe('getSpawnPoint', () => {
  it('returns a point within world bounds for a known type', () => {
    const { x, y } = getSpawnPoint('grass')
    expect(x).toBeGreaterThanOrEqual(0)
    expect(x).toBeLessThan(MAP_W)
    expect(y).toBeGreaterThanOrEqual(0)
    expect(y).toBeLessThan(MAP_H)
  })

  it('falls back gracefully for an unknown type', () => {
    const { x, y } = getSpawnPoint('unknowntype')
    expect(x).toBeGreaterThanOrEqual(0)
    expect(y).toBeGreaterThanOrEqual(0)
  })

  it('places grass type in a zone that has grass affinity', () => {
    const grassZones = Object.entries(ZONE_TYPES)
      .filter(([, types]) => types.includes('grass'))
      .map(([name]) => ZONES.find(z => z.name === name)!)

    const { x, y } = getSpawnPoint('grass')
    const inGrassZone = grassZones.some(
      z => x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h,
    )
    expect(inGrassZone).toBe(true)
  })
})

describe('ZONES and ZONE_TYPES', () => {
  it('every ZONE_TYPES key corresponds to a ZONES entry', () => {
    const zoneNames = new Set(ZONES.map(z => z.name))
    for (const key of Object.keys(ZONE_TYPES)) {
      expect(zoneNames.has(key)).toBe(true)
    }
  })

  it('ZONES cover plausible fractions of the world', () => {
    for (const zone of ZONES) {
      expect(zone.x + zone.w).toBeLessThanOrEqual(MAP_W + 1)
      expect(zone.y + zone.h).toBeLessThanOrEqual(MAP_H + 1)
    }
  })
})
