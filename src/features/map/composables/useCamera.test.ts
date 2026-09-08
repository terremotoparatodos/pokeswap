// useCamera.test.ts — R16
// Tests for pan clamping, zoom-around-pivot, scale limits, and minimapViewport.
// All state is client-side/transient; no Supabase interaction.

import { describe, it, expect, beforeEach } from 'vitest'
import { useCamera } from './useCamera'

// Container: 800×600 viewport, world: 3091×2457
const CW = 800
const CH = 600

function mkCamera() {
  return useCamera(() => CW, () => CH)
}

describe('initial state', () => {
  it('starts at origin with scale 1', () => {
    const { state } = mkCamera()
    expect(state.value.x).toBe(0)
    expect(state.value.y).toBe(0)
    expect(state.value.scale).toBe(1)
  })
})

describe('pan', () => {
  it('pans right (negative dx moves camera left, exposing more world to the right)', () => {
    const { pan, state } = mkCamera()
    pan(-50, 0)
    expect(state.value.x).toBe(-50)
    expect(state.value.y).toBe(0)
  })

  it('clamps pan so the world cannot scroll past the right/bottom edge', () => {
    const { pan, state } = mkCamera()
    pan(9999, 9999) // try to pan way off-screen
    expect(state.value.x).toBeLessThanOrEqual(0)
    expect(state.value.y).toBeLessThanOrEqual(0)
  })

  it('clamps pan so the left/top of the world does not leave the container', () => {
    const { pan, state } = mkCamera()
    pan(-99999, -99999)
    // With scale=1, minX = CW - MAP_W = 800 - 3091 = -2291
    expect(state.value.x).toBeGreaterThanOrEqual(CW - 3091)
    expect(state.value.y).toBeGreaterThanOrEqual(CH - 2457)
  })
})

describe('zoom', () => {
  it('increases scale on positive delta', () => {
    const { zoom, state } = mkCamera()
    const before = state.value.scale
    zoom(1, CW / 2, CH / 2)
    expect(state.value.scale).toBeGreaterThan(before)
  })

  it('decreases scale on negative delta', () => {
    const { zoom, state } = mkCamera()
    const before = state.value.scale
    zoom(-1, CW / 2, CH / 2)
    expect(state.value.scale).toBeLessThan(before)
  })

  it('never exceeds SCALE_MAX=3.0', () => {
    const { zoom, state } = mkCamera()
    zoom(100, CW / 2, CH / 2)
    expect(state.value.scale).toBeLessThanOrEqual(3.0)
  })

  it('never goes below SCALE_MIN=0.25', () => {
    const { zoom, state } = mkCamera()
    zoom(-100, CW / 2, CH / 2)
    expect(state.value.scale).toBeGreaterThanOrEqual(0.25)
  })

  it('zooms around the given pivot point (pivot stays fixed in screen space)', () => {
    const { zoom, state } = mkCamera()
    const pivotX = 200
    const pivotY = 150

    // At scale=1 and origin (0,0), world point at pivotX is just (pivotX, pivotY).
    // After zoom, the world point that was at the pivot should still be there.
    const worldXBefore = (pivotX - state.value.x) / state.value.scale
    zoom(1, pivotX, pivotY)
    const worldXAfter = (pivotX - state.value.x) / state.value.scale
    expect(worldXAfter).toBeCloseTo(worldXBefore, 1)
  })
})

describe('setScale', () => {
  it('sets scale to the given value (clamped)', () => {
    const { setScale, state } = mkCamera()
    setScale(2.0)
    expect(state.value.scale).toBeCloseTo(2.0, 1)
  })

  it('clamps to SCALE_MAX', () => {
    const { setScale, state } = mkCamera()
    setScale(10)
    expect(state.value.scale).toBeCloseTo(3.0, 1)
  })
})

describe('centerOn', () => {
  it('places the target world point near the container center', () => {
    const { centerOn, state } = mkCamera()
    const wx = 1500
    const wy = 1200
    centerOn(wx, wy)
    const { x, y, scale } = state.value
    const screenX = wx * scale + x
    const screenY = wy * scale + y
    expect(screenX).toBeCloseTo(CW / 2, 0)
    expect(screenY).toBeCloseTo(CH / 2, 0)
  })
})

describe('minimapViewport', () => {
  it('returns a box that fits within the minimap dimensions', () => {
    const { minimapViewport } = mkCamera()
    const mmW = 200; const mmH = 160
    const vp = minimapViewport(mmW, mmH)
    expect(vp.left).toBeGreaterThanOrEqual(0)
    expect(vp.top).toBeGreaterThanOrEqual(0)
    expect(vp.width).toBeLessThanOrEqual(mmW)
    expect(vp.height).toBeLessThanOrEqual(mmH)
  })

  it('viewport box shrinks when zoomed in', () => {
    const cam = mkCamera()
    const mmW = 200; const mmH = 160
    const vpOut = cam.minimapViewport(mmW, mmH)
    cam.zoom(5, CW / 2, CH / 2)  // zoom in
    const vpIn = cam.minimapViewport(mmW, mmH)
    expect(vpIn.width).toBeLessThan(vpOut.width)
    expect(vpIn.height).toBeLessThan(vpOut.height)
  })
})

describe('transform', () => {
  it('produces a CSS transform string containing translate and scale', () => {
    const { transform } = mkCamera()
    expect(transform.value).toMatch(/translate\(/)
    expect(transform.value).toMatch(/scale\(/)
  })
})
