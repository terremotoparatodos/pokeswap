import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildChunkPixels, CHUNK_PX, CHUNK_TILES, ChunkStore, MAX_CACHED_CHUNKS, prefetchCenter, resolveTerrainIds } from './chunks'
import { terrainArt } from './terrainArt'
import { T, World } from './world'

const GRID = CHUNK_TILES + 3
const SPAN = CHUNK_PX + 6

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

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

describe('ChunkStore cache bound', () => {
  it('evicts least-recently-used canvases down to the per-world limit', () => {
    const chunks = new Map(Array.from({ length: MAX_CACHED_CHUNKS + 4 }, (_, index) => [
      String(index), { lastUsed: index },
    ]))
    const metrics = { loaded: chunks.size, generated: chunks.size, evicted: 0, lastBuildMs: 0, maxBuildMs: 0 }
    const state = { chunks, frame: 100, metrics }
    const tick = ChunkStore.prototype.tick as unknown as (this: typeof state) => void
    tick.call(state)
    expect(chunks.size).toBe(MAX_CACHED_CHUNKS)
    expect(chunks.has('0')).toBe(false)
    expect(chunks.has(String(MAX_CACHED_CHUNKS + 3))).toBe(true)
    expect(metrics.loaded).toBe(MAX_CACHED_CHUNKS)
    expect(metrics.evicted).toBe(4)
  })

  it('warms one neighbouring chunk per browser idle window', () => {
    const callbacks: IdleRequestCallback[] = []
    vi.stubGlobal('requestIdleCallback', vi.fn((callback: IdleRequestCallback) => {
      callbacks.push(callback)
      return callbacks.length
    }))
    const store = new ChunkStore(new World(1337))
    const fakeChunk = { cx: 1, cy: 0, canvas: {} as HTMLCanvasElement, decor: [], lastUsed: 0 }
    const get = vi.spyOn(store, 'get').mockReturnValue(fakeChunk)

    store.prefetchAround(16, 16)
    expect(callbacks).toHaveLength(1)
    callbacks.shift()!({ didTimeout: false, timeRemaining: () => 20 } as IdleDeadline)

    expect(get).toHaveBeenCalledOnce()
    expect(get).toHaveBeenCalledWith(1, 0)
    expect(fakeChunk.lastUsed).toBe(-1)
    expect(callbacks).toHaveLength(1)
  })

  it('does not schedule speculative work when idle callbacks are unavailable', () => {
    vi.stubGlobal('requestIdleCallback', undefined)
    const store = new ChunkStore(new World(1337))
    const get = vi.spyOn(store, 'get')
    store.prefetchAround(0, 0)
    expect(get).not.toHaveBeenCalled()
  })

  it('releases canvases and pending idle work without forgetting collected decor', () => {
    const cancel = vi.fn()
    vi.stubGlobal('requestIdleCallback', vi.fn(() => 42))
    vi.stubGlobal('cancelIdleCallback', cancel)
    const store = new ChunkStore(new World(1337))
    store.prefetchAround(16, 16)
    store.removeDecor(2, 3)

    store.releaseCanvases()

    expect(cancel).toHaveBeenCalledWith(42)
    expect(store.metrics.loaded).toBe(0)
    expect(store.isRemoved(2, 3)).toBe(true)
  })

  it('warms the initial 3×3 chunks one idle window at a time', async () => {
    const callbacks: IdleRequestCallback[] = []
    vi.stubGlobal('requestIdleCallback', vi.fn((callback: IdleRequestCallback) => {
      callbacks.push(callback)
      return callbacks.length
    }))
    const store = new ChunkStore(new World(1337))
    const get = vi.spyOn(store, 'get').mockImplementation((cx, cy) => ({
      cx, cy, canvas: {} as HTMLCanvasElement, decor: [], lastUsed: 0,
    }))

    const warming = store.warmAround(0, 0)
    for (let index = 0; index < 9; index++) {
      expect(callbacks).toHaveLength(1)
      callbacks.shift()!({ didTimeout: index === 0, timeRemaining: () => index === 0 ? 0 : 20 } as IdleDeadline)
      await Promise.resolve()
    }
    await warming

    expect(get).toHaveBeenCalledTimes(9)
    expect(get).toHaveBeenCalledWith(0, 0)
  })
})

describe('chunk prefetch lookahead', () => {
  it('keeps the current centre away from an edge', () => {
    expect(prefetchCenter(16, 16)).toEqual({ cx: 0, cy: 0 })
  })

  it('warms the next population before positive and negative boundaries', () => {
    expect(prefetchCenter(25, 16)).toEqual({ cx: 1, cy: 0 })
    expect(prefetchCenter(7, 16)).toEqual({ cx: -1, cy: 0 })
    expect(prefetchCenter(-5, -69)).toEqual({ cx: 0, cy: -2 })
  })
})
