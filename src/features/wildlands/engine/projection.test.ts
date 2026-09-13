import { describe, expect, it } from 'vitest'
import { createProjector, LENSES, lerpLens } from './projection'

const view = { width: 1200, height: 800, focusY: 450 }

describe('createProjector', () => {
  it('places the focus point at the focus row with the lens zoom', () => {
    const proj = createProjector(LENSES.handheld, view)
    const p = proj.project(0, 0)!
    expect(p.x).toBeCloseTo(600)
    expect(p.y).toBeCloseTo(450)
    expect(p.scale).toBeCloseTo(LENSES.handheld.zoom)
  })

  it('row() inverts project() for every lens', () => {
    for (const lens of Object.values(LENSES)) {
      const proj = createProjector(lens, view)
      for (const wy of [-300, -40, 0, 25, 120]) {
        const p = proj.project(10, wy)!
        const row = proj.row(p.y)!
        expect(row.wy).toBeCloseTo(wy, 6)
        expect(row.scale).toBeCloseTo(p.scale, 6)
      }
    }
  })

  it('shrinks distant ground and returns null above the horizon', () => {
    const proj = createProjector(LENSES.dramatic, view)
    expect(proj.project(0, -200)!.scale).toBeLessThan(proj.project(0, 100)!.scale)
    expect(proj.row(proj.horizon - 1)).toBeNull()
  })

  it('blends lenses linearly', () => {
    const mid = lerpLens(LENSES.cenital, LENSES.dramatic, 0.5)
    expect(mid.squash).toBeCloseTo((LENSES.cenital.squash + LENSES.dramatic.squash) / 2)
  })
})
