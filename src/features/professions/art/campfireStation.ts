// The campfire (T-S3) — art only.
//
// The smallest of the three, and the one that has to work hardest not to read
// as scenery: a ring of stones is very close to "some rocks". T-S3.2 rebuilt it
// after the visual review said exactly that — it was flat, it was the smallest
// thing in the set, and on grass it disappeared.
//
// What answers that now is a **tripod**: three lashed poles over the fire, with
// a hook hanging from the apex. Nothing in nature makes that shape, so the
// silhouette says "somebody camps here" before any detail is read, and it gives
// the station the vertical presence the others get from their bodies. The art
// grew from 28×22 to 32×26 to hold it — still the smallest of the four, and
// still well inside the scale of the set.
//
//   idle    — cold ring, logs stacked, tripod bare.
//   ready   — kindling laid, tinder tucked in, flint on the stones; the pip lit.
//   working — the fire is up through the tripod, with sparks.
//   done    — burned down to embers, and the pot is down off the hook, full and
//             steaming, sitting on the stones where you can reach it.
//
// It knows nothing about what it cooks, how long it takes or what it burns.

import {
  block, compose, doneSparkle, dots, emberBed, FIRE_TONES, fireTongue, frameOf, groundPad,
  IRON_OUTLINE, IRON_TONES, MASONRY_OUTLINE, MASONRY_TONES, readyPip, stationArtOf, stationBounds,
  TIMBER_OUTLINE, TIMBER_TONES, type StationBounds, type StationState,
} from './stationVisuals'
import { color, type PixelArt } from './pixelArt'

export const CAMPFIRE_W = 32
export const CAMPFIRE_H = 26
export const CAMPFIRE_AX = 16
export const CAMPFIRE_AY = 25

const W = CAMPFIRE_W
const H = CAMPFIRE_H

const cache = new Map<string, PixelArt>()
const memo = (key: string, build: () => PixelArt): PixelArt => {
  let art = cache.get(key)
  if (!art) cache.set(key, (art = build()))
  return art
}

/** Eight stones of the same size, evenly spaced: placed, not fallen. */
const RING: readonly (readonly [number, number])[] = [
  [8, 19], [13, 21], [18, 21], [23, 19], [25, 16], [22, 14], [9, 14], [6, 16],
]

function ring(): Uint32Array {
  const stones = RING.map(([x, y]) => block(W, H, x, y, x + 2, y + 2, MASONRY_TONES, MASONRY_OUTLINE, 0.9, 0.55))
  return compose(W, H, [
    groundPad(W, H, 16, 19, 13, 4.4),
    // The scorch mark inside the ring: this spot has been used.
    groundPad(W, H, 16, 18, 6, 2.6),
    ...stones,
  ])
}

/**
 * The tripod: three poles leaning into an apex, lashed at the top, with an iron
 * hook hanging from it. This is the silhouette that makes the campfire a
 * station instead of a pile — and the only tall thing it has.
 */
function tripod(pixels: Uint32Array): void {
  const wood = color(TIMBER_TONES[1])
  const lit = color(TIMBER_TONES[3])
  // Left, right and back poles, drawn as one-pixel diagonals to the apex (16, 2).
  for (let i = 0; i <= 14; i++) {
    const t = i / 14
    dots(pixels, W, H, i < 3 ? lit : wood, [
      [Math.round(16 - 9 * t), 2 + i],
      [Math.round(16 + 9 * t), 2 + i],
      [Math.round(16 + 3 * t), 2 + i],
    ])
  }
  // The lashing at the apex.
  dots(pixels, W, H, color(TIMBER_TONES[0]), [[15, 3], [16, 3], [17, 3], [16, 4]])
  // The hook, hanging where a pot would go.
  dots(pixels, W, H, color(IRON_TONES[2]), [[16, 5], [16, 6], [16, 7]])
  dots(pixels, W, H, color(IRON_TONES[3]), [[15, 8], [16, 8]])
}

/** Split logs stacked across the middle: sawn ends, not branches. */
function logs(pixels: Uint32Array): void {
  const stack = compose(W, H, [
    block(W, H, 11, 17, 20, 18, TIMBER_TONES, TIMBER_OUTLINE, 0.9, 0.6),
    block(W, H, 13, 15, 19, 16, TIMBER_TONES, TIMBER_OUTLINE, 0.8, 0.55),
  ])
  for (let i = 0; i < pixels.length; i++) if (stack[i]) pixels[i] = stack[i]
  // Cut ends, lighter, so the wood reads as split rather than picked up.
  dots(pixels, W, H, color(TIMBER_TONES[3]), [[11, 17], [20, 18], [13, 15], [19, 16]])
}

/**
 * Kindling laid under the logs: dry twigs and tinder, plus a struck flint on
 * the ring. This is what makes `ready` read as "laid and waiting for a match"
 * instead of as the cold pile it was a moment ago.
 */
function kindling(pixels: Uint32Array): void {
  const twigs: [number, number][] = [
    [12, 19], [14, 19], [16, 19], [18, 19],
    [13, 20], [15, 20], [17, 20],
  ]
  dots(pixels, W, H, color(TIMBER_TONES[3]), twigs)
  // Tinder tucked between the logs.
  dots(pixels, W, H, color(TIMBER_TONES[2]), [[14, 14], [15, 14], [16, 14], [17, 14]])
  // The flint, set on a ring stone: the thing you are about to use.
  dots(pixels, W, H, color(IRON_TONES[3]), [[24, 18], [25, 18]])
  dots(pixels, W, H, color(IRON_TONES[1]), [[25, 19]])
}

/**
 * The pot, down off the hook and sitting on the stones (T-S3.2).
 *
 * The first one was a rectangle and the review could not tell what it was. This
 * one is built out of the three things that say "pot" at any size: a body that
 * is wider than it is tall and rounded at the bottom, a rim that overhangs it,
 * and a handle arcing above. Steam rises off it, which is also the only thing
 * moving in `done`.
 */
function pot(pixels: Uint32Array): void {
  const body = color(IRON_TONES[1])
  const dark = color(IRON_TONES[0])
  const edge = color(IRON_OUTLINE)
  // Belly: widest in the middle, tucked in at the base.
  const rows: readonly (readonly number[])[] = [[13, 12, 19], [14, 11, 20], [15, 11, 20], [16, 12, 19], [17, 13, 18]]
  for (const [y, x0, x1] of rows) {
    for (let x = x0; x <= x1; x++) pixels[y * W + x] = x === x0 || x === x1 ? dark : body
  }
  // Rim: one row wider than the belly, in a lighter tone, so it overhangs.
  dots(pixels, W, H, color(IRON_TONES[3]), [[11, 12], [12, 12], [13, 12], [14, 12], [15, 12], [16, 12], [17, 12], [18, 12], [19, 12], [20, 12]])
  dots(pixels, W, H, edge, [[10, 12], [21, 12]])
  // Handle: an arc over the rim, clear of the body.
  dots(pixels, W, H, color(IRON_TONES[2]), [[11, 11], [12, 10], [15, 9], [16, 9], [19, 10], [20, 11]])
  // What is inside, catching the light.
  dots(pixels, W, H, color('#e2a35c'), [[14, 13], [15, 13], [16, 13], [17, 13]])
  // Steam.
  dots(pixels, W, H, color('#c3d6e4'), [[14, 7], [17, 6], [15, 5]])
}

export function campfireStationArt(state: StationState, frame = 0): PixelArt {
  const step = frameOf(state, frame)
  return memo(`${state}|${step}`, () => {
    const pixels = ring()
    tripod(pixels)

    if (state === 'done') {
      // Burned down: embers under the pot, no standing logs, pot off the hook.
      emberBed(pixels, W, H, 18, 12, 19, true)
      emberBed(pixels, W, H, 17, 13, 18, false)
      pot(pixels)
      doneSparkle(pixels, W, H, 24, 9)
      return stationArtOf(W, H, pixels, CAMPFIRE_AX, CAMPFIRE_AY)
    }

    logs(pixels)

    if (state === 'ready') {
      kindling(pixels)
      emberBed(pixels, W, H, 19, 12, 19, false)
      emberBed(pixels, W, H, 18, 13, 18, false)
      readyPip(pixels, W, H, 24, 12)
    }

    if (state === 'working') {
      emberBed(pixels, W, H, 19, 12, 19, true)
      const fire = fireTongue(W, H, 16, 15, 9, step)
      for (let i = 0; i < pixels.length; i++) if (fire[i]) pixels[i] = fire[i]
      // Sparks lifting past the tripod, offset per frame so they never pair up.
      const sparks: [number, number][] = [[13 - (step % 2), 6], [19 + (step % 2), 5]]
      dots(pixels, W, H, color(FIRE_TONES[4]), sparks)
    }

    return stationArtOf(W, H, pixels, CAMPFIRE_AX, CAMPFIRE_AY)
  })
}

export const CAMPFIRE_BOUNDS: StationBounds = stationBounds(campfireStationArt('idle'))
