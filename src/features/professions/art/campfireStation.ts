// The campfire (T-S3) — art only.
//
// The smallest and lowest of the three, and the one that has to work hardest to
// not read as scenery: a ring of stones is very close to "some rocks". What
// makes it a station is that the stones are *placed* — an even ring, all of a
// size, around a scorch mark — and that the wood is split and stacked rather
// than fallen.
//
//   idle    — cold ring, logs stacked, no ash.
//   ready   — kindling laid and coals banked; the pip lit.
//   working — the fire is up, with a spark or two.
//   done    — the fire has burned down to bright embers and a cooking pot sits
//             on the ring with something finished in it.
//
// It knows nothing about what it cooks, how long it takes or what it burns.

import {
  block, compose, doneSparkle, dots, emberBed, FIRE_TONES, fireTongue, frameOf, groundPad,
  IRON_OUTLINE, IRON_TONES, MASONRY_OUTLINE, MASONRY_TONES, readyPip, stationArtOf, stationBounds,
  TIMBER_OUTLINE, TIMBER_TONES, type StationBounds, type StationState,
} from './stationVisuals'
import { color, type PixelArt } from './pixelArt'

export const CAMPFIRE_W = 28
export const CAMPFIRE_H = 22
export const CAMPFIRE_AX = 14
export const CAMPFIRE_AY = 21

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
  [7, 16], [11, 18], [16, 18], [20, 16], [22, 13], [19, 11], [8, 11], [5, 13],
]

function ring(): Uint32Array {
  const stones = RING.map(([x, y]) => block(W, H, x, y, x + 2, y + 2, MASONRY_TONES, MASONRY_OUTLINE, 0.9, 0.55))
  return compose(W, H, [
    groundPad(W, H, 14, 16, 12, 4.2),
    // The scorch mark inside the ring: this spot has been used.
    groundPad(W, H, 14, 15, 6, 2.4),
    ...stones,
  ])
}

/** Split logs stacked across the middle: sawn ends, not branches. */
function logs(pixels: Uint32Array): void {
  const stack = compose(W, H, [
    block(W, H, 9, 14, 18, 15, TIMBER_TONES, TIMBER_OUTLINE, 0.9, 0.6),
    block(W, H, 11, 12, 17, 13, TIMBER_TONES, TIMBER_OUTLINE, 0.8, 0.55),
  ])
  for (let i = 0; i < pixels.length; i++) if (stack[i]) pixels[i] = stack[i]
  // Cut ends, lighter, so the wood reads as split rather than picked up.
  dots(pixels, W, H, color(TIMBER_TONES[3]), [[9, 14], [18, 15], [11, 12], [17, 13]])
}

/**
 * Kindling laid under the logs: dry twigs and tinder, plus a struck flint on
 * the ring. This is what makes `ready` read as "laid and waiting for a match"
 * instead of as the cold pile it was a moment ago.
 */
function kindling(pixels: Uint32Array): void {
  const twigs: [number, number][] = [
    [10, 16], [12, 16], [14, 16], [16, 16],
    [11, 17], [13, 17], [15, 17],
  ]
  dots(pixels, W, H, color(TIMBER_TONES[3]), twigs)
  // Tinder tucked between the logs.
  dots(pixels, W, H, color(TIMBER_TONES[2]), [[12, 11], [13, 11], [14, 11], [15, 11]])
  // The flint, set on a ring stone: the thing you are about to use.
  dots(pixels, W, H, color(IRON_TONES[3]), [[21, 15], [22, 15]])
  dots(pixels, W, H, color(IRON_TONES[1]), [[22, 16]])
}

/** The pot on the ring: only when there is something to take. */
function pot(pixels: Uint32Array): void {
  const body = block(W, H, 10, 8, 17, 12, IRON_TONES, IRON_OUTLINE, 0.75, 0.45)
  for (let i = 0; i < pixels.length; i++) if (body[i]) pixels[i] = body[i]
  // Rim and handle.
  dots(pixels, W, H, color(IRON_TONES[3]), [[10, 8], [11, 8], [16, 8], [17, 8]])
  dots(pixels, W, H, color(IRON_TONES[1]), [[9, 9], [18, 9]])
}

export function campfireStationArt(state: StationState, frame = 0): PixelArt {
  const step = frameOf(state, frame)
  return memo(`${state}|${step}`, () => {
    const pixels = ring()

    if (state === 'done') {
      // Burned down: embers under the pot, no standing logs.
      emberBed(pixels, W, H, 15, 10, 17, true)
      emberBed(pixels, W, H, 14, 11, 16, false)
      pot(pixels)
      doneSparkle(pixels, W, H, 20, 6)
      return stationArtOf(W, H, pixels, CAMPFIRE_AX, CAMPFIRE_AY)
    }

    logs(pixels)

    if (state === 'ready') {
      kindling(pixels)
      emberBed(pixels, W, H, 16, 10, 17, false)
      emberBed(pixels, W, H, 15, 11, 16, false)
      readyPip(pixels, W, H, 13, 7)
    }

    if (state === 'working') {
      emberBed(pixels, W, H, 16, 10, 17, true)
      const fire = fireTongue(W, H, 14, 12, 8, step)
      for (let i = 0; i < pixels.length; i++) if (fire[i]) pixels[i] = fire[i]
      // Sparks lifting off the flame, offset per frame so they never pair up.
      const sparks: [number, number][] = [[12 - (step % 2), 3], [16 + (step % 2), 2]]
      dots(pixels, W, H, color(FIRE_TONES[4]), sparks)
    }

    return stationArtOf(W, H, pixels, CAMPFIRE_AX, CAMPFIRE_AY)
  })
}

export const CAMPFIRE_BOUNDS: StationBounds = stationBounds(campfireStationArt('idle'))
