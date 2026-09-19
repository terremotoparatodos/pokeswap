// Building volume — WildLands prototype
//
// Hand-drawn buildings are a façade (upright) under a roof seen from above
// (`flatTop`, squashed like the ground). Drawn as flat cards they read as
// cut-outs: the ground around them converges toward the screen centre with
// depth, their roofs don't, and no side wall ever shows.
//
// A building that declares its footprint depth is drawn as a box instead,
// with the projector's own perspective: the back of the footprint sits
// deeper, so it lands closer to the screen centre by the ratio of the two
// scales. The roof narrows toward its back row by row, and the side wall
// that faces the centre appears between the façade's edge and the roof's
// back corner — wider the farther the building is from the centre, as in
// the handheld games' 3D towns.

import type { Sprite } from './sprite'

export interface VolumeInput {
  /** Screen x of the façade's left edge and its width. */
  left: number
  width: number
  /** Screen rows: façade bottom, façade top (= roof front), and roof height. */
  bottom: number
  faceTop: number
  roofH: number
  /** Screen x of the perspective centre. */
  cx: number
  /** Scale at the back of the footprint over the scale at the front (< 1). */
  ratio: number
}

export interface VolumeWall {
  side: 'left' | 'right'
  /** Façade edge (front) and its projection at the back of the footprint (rear). */
  front: number
  rear: number
}

export interface VolumeGeometry {
  /** Screen span of each roof row, back (0) to front (roofH − 1). */
  roofRow(i: number): { x: number; width: number }
  /** The side facing the screen centre, or null when the building is centred. */
  wall: VolumeWall | null
  /**
   * Horizontal span of the side wall on screen row `y`, from the building's
   * own silhouette edge on that row (`edge`) back to the rear edge of the
   * box; null where there is no wall (air beside a pointed roof, outside the box).
   */
  wallSpan(y: number, edge: number | null): { x0: number; x1: number } | null
}

/** Screen x of a front point moved back to the footprint's back, toward the centre. */
const back = (x: number, cx: number, ratio: number) => cx + (x - cx) * ratio

export function volumeGeometry(v: VolumeInput): VolumeGeometry {
  const right = v.left + v.width
  const roofRow = (i: number) => {
    // t: 0 at the roof's back row, 1 at its front row (the façade top).
    const t = v.roofH <= 1 ? 1 : i / (v.roofH - 1)
    const k = v.ratio + (1 - v.ratio) * t
    const x = back(v.left, v.cx, k)
    return { x, width: back(right, v.cx, k) - x }
  }
  // Only the side facing the centre shows; centred buildings show none.
  const side: VolumeWall['side'] | null = v.left > v.cx ? 'left' : right < v.cx ? 'right' : null
  const front = side === 'left' ? v.left : right
  const rear = back(front, v.cx, v.ratio)
  const wall: VolumeWall | null = side && Math.abs(rear - front) >= 1 ? { side, front, rear } : null
  const backTop = v.faceTop - v.roofH
  const wallSpan = (y: number, edge: number | null) => {
    if (!wall || edge === null || y < backTop || y >= v.bottom) return null
    // The box's rear edge: upright at the back, then the ground line back to the façade's foot.
    const lift = v.bottom - y
    const rearX = lift >= v.roofH || v.roofH === 0 ? rear : front + (rear - front) * (lift / v.roofH)
    const toward = wall.side === 'left' ? rearX < edge : rearX > edge
    if (!toward) return null
    return { x0: Math.min(edge, rearX), x1: Math.max(edge, rearX) }
  }
  return { roofRow, wall, wallSpan }
}

/** Per source row, how far the art's silhouette sits in from each side (px; the width when the row is empty). */
export function silhouetteInsets(sprite: Sprite): { left: Int16Array; right: Int16Array } {
  let cached = insets.get(sprite)
  if (cached) return cached
  const left = new Int16Array(sprite.h).fill(sprite.w)
  const right = new Int16Array(sprite.h).fill(sprite.w)
  const g = sprite.canvas.getContext('2d')
  if (g) {
    const data = g.getImageData(0, 0, sprite.w, sprite.h).data
    for (let y = 0; y < sprite.h; y++) {
      for (let x = 0; x < sprite.w; x++) {
        if (data[(y * sprite.w + x) * 4 + 3] < 128) continue
        left[y] = Math.min(left[y], x)
        right[y] = Math.min(right[y], sprite.w - 1 - x)
      }
    }
  }
  cached = { left, right }
  insets.set(sprite, cached)
  return cached
}

const insets = new WeakMap<Sprite, { left: Int16Array; right: Int16Array }>()

const wallColours = new WeakMap<Sprite, { left: string; right: string }>()

/**
 * The side wall's colour: the façade's own edge pixels on that side,
 * averaged and darkened (walls facing away from the sun read darker).
 */
export function wallColour(sprite: Sprite, side: 'left' | 'right'): string {
  let cached = wallColours.get(sprite)
  if (!cached) {
    cached = { left: edgeColour(sprite, 'left'), right: edgeColour(sprite, 'right') }
    wallColours.set(sprite, cached)
  }
  return cached[side]
}

function edgeColour(sprite: Sprite, side: 'left' | 'right'): string {
  const fallback = '#5a5460'
  const g = sprite.canvas.getContext('2d')
  if (!g) return fallback
  const top = sprite.flatTop ?? 0
  const h = sprite.h - top
  if (h <= 0) return fallback
  const data = g.getImageData(0, top, sprite.w, h).data
  let r = 0, gr = 0, b = 0, n = 0
  for (let y = 0; y < h; y++) {
    // The first opaque pixels from that side, skipping the outline pixel.
    let seen = 0
    for (let i = 0; i < sprite.w && seen < 3; i++) {
      const x = side === 'left' ? i : sprite.w - 1 - i
      const o = (y * sprite.w + x) * 4
      if (data[o + 3] < 200) continue
      seen++
      if (seen === 1) continue
      r += data[o]; gr += data[o + 1]; b += data[o + 2]; n++
    }
  }
  if (!n) return fallback
  // The sun comes from the upper left: west-facing walls catch more of it.
  const shade = side === 'left' ? 0.82 : 0.7
  const c = (v: number) => Math.round((v / n) * shade)
  return `rgb(${c(r)}, ${c(gr)}, ${c(b)})`
}
