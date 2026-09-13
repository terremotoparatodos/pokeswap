import { describe, expect, it } from 'vitest'
import { buildChunkPixels, CHUNK_PX, CHUNK_TILES, resolveTerrainIds } from './chunks'
import { terrainArt } from './terrainArt'
import { T, World } from './world'

const GRID = CHUNK_TILES + 3
const SPAN = CHUNK_PX + 6

function gridOf(fn: (gx: number, gy: number) => number): Uint8Array {
  const grid = new Uint8Array(GRID * GRID)
  for (let gy = 0; gy < GRID; gy++) for (let gx = 0; gx < GRID; gx++) grid[gy * GRID + gx] = fn(gx, gy)
  return grid
}

describe('resolveTerrainIds', () => {
  const { jitter } = terrainArt()

  it('fills uniform corners with a single terrain', () => {
    const ids = resolveTerrainIds(gridOf(() => T.GRASS), 0, 0, jitter)
    expect(ids.every(id => id === T.GRASS)).toBe(true)
  })

  it('blends a vertical border between the two terrains, never inventing others', () => {
    // Left half sand, right half water.
    const ids = resolveTerrainIds(gridOf(gx => (gx < GRID / 2 ? T.SAND : T.WATER)), 0, 0, jitter)
    const seen = new Set(ids)
    expect([...seen].sort()).toEqual([T.WATER, T.SAND].sort())
    const row = 200 * SPAN
    expect(ids[row + 10]).toBe(T.SAND)
    expect(ids[row + SPAN - 10]).toBe(T.WATER)
  })
})

describe('buildChunkPixels', () => {
  it('bakes a full chunk deterministically with decor inside its bounds', () => {
    const world = new World(1337)
    const a = buildChunkPixels(world, 0, 0)
    const b = buildChunkPixels(world, 0, 0)
    expect(a.pixels.length).toBe(CHUNK_PX * CHUNK_PX)
    expect(a.pixels).toEqual(b.pixels)
    for (const d of a.decor) {
      expect(d.tx).toBeGreaterThanOrEqual(0)
      expect(d.tx).toBeLessThan(CHUNK_TILES)
    }
  })
})
