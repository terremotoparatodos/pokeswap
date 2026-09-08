// useCamera — R16
//
// Client-side viewport state for the pannable, zoomable world map.
// No server interaction; all state is transient (TRUST_BOUNDARY §2).

import { ref, computed, readonly } from 'vue'
import { MAP_W, MAP_H } from '../data/mapConfig'
import type { CameraState } from '../types'

const SCALE_MIN = 0.25
const SCALE_MAX = 3.0
const SCALE_STEP = 0.2

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

export function useCamera(containerWidth: () => number, containerHeight: () => number) {
  const state = ref<CameraState>({ x: 0, y: 0, scale: 1 })

  /** CSS transform string for the world element. */
  const transform = computed(() => {
    const { x, y, scale } = state.value
    return `translate(${x}px, ${y}px) scale(${scale})`
  })

  function clampPan(x: number, y: number, scale: number) {
    const maxX = 0
    const minX = containerWidth() - MAP_W * scale
    const maxY = 0
    const minY = containerHeight() - MAP_H * scale
    return {
      x: clamp(x, minX, maxX),
      y: clamp(y, minY, maxY),
    }
  }

  /** Pan the viewport by (dx, dy) pixels in screen space. */
  function pan(dx: number, dy: number) {
    const { x, y, scale } = state.value
    const clamped = clampPan(x + dx, y + dy, scale)
    state.value = { ...state.value, ...clamped }
  }

  /**
   * Zoom by `delta` steps around the screen-space pivot (pivotX, pivotY).
   * Positive delta zooms in, negative zooms out.
   */
  function zoom(delta: number, pivotX: number, pivotY: number) {
    const { x, y, scale } = state.value
    const newScale = clamp(scale + delta * SCALE_STEP, SCALE_MIN, SCALE_MAX)
    const ratio = newScale / scale

    // Scale around the pivot point
    const newX = pivotX - (pivotX - x) * ratio
    const newY = pivotY - (pivotY - y) * ratio

    const clamped = clampPan(newX, newY, newScale)
    state.value = { x: clamped.x, y: clamped.y, scale: newScale }
  }

  /** Set zoom to a specific scale, keeping the center of the viewport fixed. */
  function setScale(newScale: number) {
    const s = clamp(newScale, SCALE_MIN, SCALE_MAX)
    zoom(
      (s - state.value.scale) / SCALE_STEP,
      containerWidth() / 2,
      containerHeight() / 2,
    )
  }

  /**
   * Center the viewport on a world-space point (wx, wy).
   * Call after selecting a Pokémon to scroll the map to it.
   */
  function centerOn(wx: number, wy: number) {
    const { scale } = state.value
    const newX = containerWidth() / 2 - wx * scale
    const newY = containerHeight() / 2 - wy * scale
    const clamped = clampPan(newX, newY, scale)
    state.value = { ...state.value, ...clamped }
  }

  /** Reset to the initial centered view. */
  function reset() {
    const scale = 1
    const clamped = clampPan(
      containerWidth() / 2 - MAP_W / 2,
      containerHeight() / 2 - MAP_H / 2,
      scale,
    )
    state.value = { x: clamped.x, y: clamped.y, scale }
  }

  /**
   * Returns the minimap viewport indicator box.
   * `mmW`/`mmH` are the minimap canvas dimensions in pixels.
   */
  function minimapViewport(mmW: number, mmH: number) {
    const { x, y, scale } = state.value
    const scaleX = mmW / MAP_W
    const scaleY = mmH / MAP_H
    const vpW = containerWidth() / scale
    const vpH = containerHeight() / scale
    return {
      left: Math.max(0, (-x / scale) * scaleX),
      top:  Math.max(0, (-y / scale) * scaleY),
      width: Math.min(mmW, vpW * scaleX),
      height: Math.min(mmH, vpH * scaleY),
    }
  }

  return {
    transform: readonly(transform),
    state: readonly(state),
    pan,
    zoom,
    setScale,
    centerOn,
    reset,
    minimapViewport,
  }
}
