import { describe, expect, it } from 'vitest'
import { createProjector, LENSES } from './projection'
import { ProjectionRowCache } from './projectionRows'

describe('ProjectionRowCache', () => {
  it('matches the projector exactly and reuses rows while the view is stable', () => {
    const lens = { ...LENSES.handheld }
    const view = { width: 1200, height: 800, focusY: 448 }
    const proj = createProjector(lens, view)
    const cache = new ProjectionRowCache().prepare(proj, 100, view.height, view.focusY, lens)
    const worldY = cache.worldY
    const inverseScale = cache.inverseScale

    for (const sy of [100, 211, 447, 799]) {
      const row = proj.row(sy + 0.5)!
      expect(cache.worldY[sy - 100]).toBe(row.wy)
      expect(cache.inverseScale[sy - 100]).toBe(1 / row.scale)
    }

    cache.prepare(createProjector(lens, view), 100, view.height, view.focusY, lens)
    expect(cache.worldY).toBe(worldY)
    expect(cache.inverseScale).toBe(inverseScale)
  })

  it('recalculates values when the lens changes', () => {
    const view = { width: 1200, height: 800, focusY: 448 }
    const cache = new ProjectionRowCache()
    const first = { ...LENSES.handheld }
    cache.prepare(createProjector(first, view), 100, view.height, view.focusY, first)
    const before = cache.worldY[300]
    const second = { ...first, squash: first.squash - 0.1 }
    cache.prepare(createProjector(second, view), 100, view.height, view.focusY, second)
    expect(cache.worldY[300]).not.toBe(before)
  })
})
