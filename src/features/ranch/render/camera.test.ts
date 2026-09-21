import { describe, expect, it } from 'vitest'
import { clampCentre, RanchCamera, snapZoom, zoomLimits } from './camera'

const WORLD = { width: 1920, height: 1440 }

/** A camera sized like a phone in portrait, with no DOM involved. */
function phone(zoom = 2): RanchCamera {
  const camera = new RanchCamera(WORLD, { initialZoom: zoom })
  camera.resize(390, 780, 3)
  return camera
}

describe('camera limits', () => {
  it('lets the whole ranch fit on screen at the smallest zoom', () => {
    const { min } = zoomLimits(WORLD, 390, 780)
    expect(390 / min).toBeGreaterThanOrEqual(WORLD.width)
  })

  it('never zooms past 4x, where the pixel art would be mush', () => {
    expect(zoomLimits(WORLD, 3840, 2160).max).toBe(4)
  })
})

describe('camera bounds', () => {
  it('keeps the view over the map when it is smaller than the world', () => {
    const centre = clampCentre(WORLD, 400, 400, 2, { x: -5000, y: 9000 })
    expect(centre.x).toBeGreaterThan(0)
    expect(centre.y).toBeLessThan(WORLD.height)
  })

  it('centres the map on the axis where the view is wider than the world', () => {
    const centre = clampCentre(WORLD, 4000, 400, 1, { x: 10, y: 700 })
    expect(centre.x).toBe(WORLD.width / 2)
  })
})

describe('zoom snapping', () => {
  it('snaps a scale that is nearly whole', () => {
    expect(snapZoom(1.96, { min: 0.2, max: 4 })).toBe(2)
  })

  it('leaves a scale that is genuinely between steps alone', () => {
    expect(snapZoom(2.45, { min: 0.2, max: 4 })).toBe(2.45)
  })

  it('ignores a crisp scale that the limits forbid', () => {
    // 0.5 is the nearest step but the view cannot zoom out that far.
    expect(snapZoom(0.52, { min: 0.6, max: 4 })).toBe(0.52)
  })
})

describe('camera', () => {
  it('maps a screen point to a world point and back', () => {
    const camera = phone()
    camera.jumpTo(800, 600, 2)
    const world = camera.screenToWorld(120, 300)
    const back = camera.worldToScreen(world.x, world.y)
    expect(back.x).toBeCloseTo(120, 3)
    expect(back.y).toBeCloseTo(300, 3)
  })

  it('keeps the point under the cursor fixed while zooming', () => {
    const camera = phone()
    camera.jumpTo(800, 600, 2)
    const before = camera.screenToWorld(100, 200)
    const target = { x: before.x, y: before.y }
    camera.zoomAt(100, 200, 3)
    const after = camera.screenToWorld(100, 200)
    expect(after.x).toBeCloseTo(target.x, 1)
    expect(after.y).toBeCloseTo(target.y, 1)
  })

  it('glides to a point and then stops', () => {
    const camera = phone()
    camera.jumpTo(300, 300, 2)
    camera.flyTo(1400, 1000, 3, 0.5)
    for (let i = 0; i < 40; i++) camera.update(1 / 60)
    expect(camera.x).toBeCloseTo(1400, 0)
    expect(camera.zoom).toBeCloseTo(3, 2)
    expect(camera.moving).toBe(false)
  })

  it('does nothing per frame when it is at rest', () => {
    const camera = phone()
    expect(camera.update(1 / 60)).toBe(false)
  })

  it('draws on whole device pixels so the art stays sharp', () => {
    const camera = phone(2)
    camera.jumpTo(801.37, 600.91, 2)
    const seen: number[] = []
    camera.applyTo({ setTransform: (...args: number[]) => seen.push(...args) } as unknown as CanvasRenderingContext2D)
    expect(seen[0]).toBe(6) // zoom 2 x dpr 3
    expect(Number.isInteger(seen[4])).toBe(true)
    expect(Number.isInteger(seen[5])).toBe(true)
  })
})
