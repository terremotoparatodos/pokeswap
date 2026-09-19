import { describe, expect, it } from 'vitest'
import { volumeGeometry } from './buildingVolume'
import { createProjector, LENSES } from './projection'

const base = { width: 100, bottom: 400, faceTop: 340, roofH: 60, cx: 500, ratio: 0.9 }

describe('building volume', () => {
  it('shows no side wall on a building straddling the screen centre', () => {
    expect(volumeGeometry({ ...base, left: 450 }).wall).toBeNull()
  })

  it('shows the wall facing the centre, wider the farther the building is', () => {
    const near = volumeGeometry({ ...base, left: 600 }).wall!
    const far = volumeGeometry({ ...base, left: 900 }).wall!
    expect(near.side).toBe('left')
    expect(near.rear).toBeLessThan(near.front)
    expect(far.front - far.rear).toBeGreaterThan(near.front - near.rear)
    expect(volumeGeometry({ ...base, left: 100 }).wall!.side).toBe('right')
  })

  it('narrows the roof toward its back row, meeting the façade at the front', () => {
    const g = volumeGeometry({ ...base, left: 700 })
    const backRow = g.roofRow(0)
    const frontRow = g.roofRow(base.roofH - 1)
    expect(frontRow).toEqual({ x: 700, width: 100 })
    expect(backRow.width).toBeCloseTo(90)
    expect(backRow.x).toBeCloseTo(680)
  })

  it('spans the wall from the silhouette edge back to the box, and nowhere else', () => {
    const g = volumeGeometry({ ...base, left: 700 })
    // A row as high as the roof is deep: from the rear edge (680) to the façade edge (700).
    expect(g.wallSpan(340, 700)).toEqual({ x0: 680, x1: 700 })
    // Lower down the ground line brings the rear edge back toward the façade's foot.
    expect(g.wallSpan(380, 700)!.x0).toBeCloseTo(693.33)
    // At the foot the wall closes back to the façade corner.
    expect(g.wallSpan(399, 700)!.x1 - g.wallSpan(399, 700)!.x0).toBeLessThan(1)
    // Above the box, below the ground, or with no silhouette on that row: no wall.
    expect(g.wallSpan(270, 700)).toBeNull()
    expect(g.wallSpan(400, 700)).toBeNull()
    expect(g.wallSpan(380, 670)).toBeNull()
  })

  it('uses the projector’s own perspective: the back of a footprint lands nearer the centre', () => {
    const p = createProjector(LENSES.handheld, { width: 1000, height: 700, focusY: 390 })
    const front = p.project(150, 0)!
    const back = p.project(150, -96)!
    expect(back.scale / front.scale).toBeLessThan(1)
    expect(back.x - 500).toBeLessThan(front.x - 500)
  })

})
