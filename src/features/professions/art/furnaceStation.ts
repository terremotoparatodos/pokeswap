// The furnace (T-S3) — art only.
//
// The heaviest of the three: a squat chimney of dressed stone banded with iron,
// with an arched mouth at the front. Everything about the silhouette is built —
// courses of block, a straight chimney, iron bands — so it never reads as a
// boulder someone dropped.
//
// The mouth is where the whole station is read:
//
//   idle    — cold and dark. Empty grate.
//   ready   — ore stacked beside it and coals banked in the mouth; the pip lit.
//   working — the fire is up and the chimney is smoking.
//   done    — the fire has died back to embers and an ingot sits on the ledge.
//
// It knows nothing about fuel, recipes, durations or what an ingot is worth:
// those are `O-8` and `A-12`, and they are not decided here.

import {
  block, compose, doneSparkle, dots, emberBed, FIRE_TONES, fireTongue, frameOf, groundPad,
  IRON_OUTLINE, IRON_TONES, MASONRY_OUTLINE, MASONRY_TONES, readyPip, stationArtOf, stationBounds,
  type StationBounds, type StationState,
} from './stationVisuals'
import { color, type PixelArt } from './pixelArt'

/** Art size and anchor. The anchor is the front-bottom middle, like every world prop. */
export const FURNACE_W = 30
export const FURNACE_H = 34
export const FURNACE_AX = 15
export const FURNACE_AY = 33

const W = FURNACE_W
const H = FURNACE_H

const cache = new Map<string, PixelArt>()
const memo = (key: string, build: () => PixelArt): PixelArt => {
  let art = cache.get(key)
  if (!art) cache.set(key, (art = build()))
  return art
}

/** Body, chimney and the stone ledge the ingot ends up on. */
function masonry(): Uint32Array {
  return compose(W, H, [
    groundPad(W, H, 15, 31, 13, 3.4),
    // Base course: widest, so the thing looks planted.
    block(W, H, 4, 24, 25, 31, MASONRY_TONES, MASONRY_OUTLINE, 0.8, 0.4),
    // Main body.
    block(W, H, 6, 12, 23, 25, MASONRY_TONES, MASONRY_OUTLINE, 0.95, 0.55),
    // Shoulder, stepping in toward the chimney.
    block(W, H, 9, 8, 20, 13, MASONRY_TONES, MASONRY_OUTLINE, 0.9, 0.6),
    // Chimney.
    block(W, H, 12, 1, 17, 9, MASONRY_TONES, MASONRY_OUTLINE, 0.85, 0.5),
    // Front ledge: where a finished ingot is set down.
    block(W, H, 7, 22, 22, 23, MASONRY_TONES, MASONRY_OUTLINE, 1, 0.8),
  ])
}

/** Two iron bands and the grate bars: the worked-metal half of the silhouette. */
function ironwork(pixels: Uint32Array): void {
  const band = compose(W, H, [
    block(W, H, 5, 20, 24, 21, IRON_TONES, IRON_OUTLINE, 0.9, 0.7),
    block(W, H, 8, 10, 21, 11, IRON_TONES, IRON_OUTLINE, 0.9, 0.7),
  ])
  for (let i = 0; i < pixels.length; i++) if (band[i]) pixels[i] = band[i]
  // Grate bars across the mouth.
  dots(pixels, W, H, color(IRON_TONES[1]), [[12, 19], [15, 19], [18, 19]])
}

/**
 * The arched mouth, carved out of the body. Returns the interior rows so the
 * fire is always drawn inside the opening and never over the stone.
 */
function mouth(pixels: Uint32Array): void {
  const dark = color('#171310')
  for (let y = 13; y <= 19; y++) {
    // A flat arch: narrow at the top, full width at the grate.
    const half = y <= 14 ? 4 : 6
    for (let x = 15 - half; x <= 15 + half; x++) pixels[y * W + x] = dark
  }
}

/** Ore waiting to go in: two lumps on the ledge, only when the station is loaded. */
function oreStack(pixels: Uint32Array): void {
  dots(pixels, W, H, color('#6b675e'), [[8, 21], [9, 21], [8, 20]])
  dots(pixels, W, H, color('#8d887c'), [[9, 20]])
  dots(pixels, W, H, color('#5a5f52'), [[21, 21], [22, 21], [22, 20]])
}

/** The finished ingot on the front ledge: the reason to come back. */
function ingot(pixels: Uint32Array): void {
  dots(pixels, W, H, color(IRON_TONES[3]), [[18, 21], [19, 21], [20, 21], [21, 21]])
  dots(pixels, W, H, color(IRON_TONES[2]), [[19, 22], [20, 22], [21, 22], [22, 22]])
  dots(pixels, W, H, color(IRON_OUTLINE), [[18, 22], [22, 21], [23, 22]])
  // Still hot underneath.
  dots(pixels, W, H, color(FIRE_TONES[3]), [[19, 23], [21, 23]])
}

/**
 * The light thrown out of the mouth: the arch rim and the ledge below it pick
 * up the fire. Without this the furnace changes by a handful of pixels and
 * reads the same hot or cold.
 */
function glow(pixels: Uint32Array, strength: number): void {
  const rim = color(FIRE_TONES[strength > 0.6 ? 3 : 2])
  const spill = color(FIRE_TONES[strength > 0.6 ? 2 : 1])
  // The inside edge of the arch.
  for (let y = 13; y <= 19; y++) {
    const half = y <= 14 ? 4 : 6
    dots(pixels, W, H, rim, [[15 - half, y], [15 + half, y]])
  }
  // The stone lintel above and the ledge below.
  for (let x = 11; x <= 19; x++) dots(pixels, W, H, spill, [[x, 12]])
  for (let x = 10; x <= 20; x++) dots(pixels, W, H, spill, [[x, 20]])
}

/** Smoke off the chimney while it runs. */
function smoke(pixels: Uint32Array, frame: number): void {
  const drift = [0, 1, 1, 0][frame % 4]
  const puffs: [number, number][] = [[14 + drift, 0], [15, 1], [15 - drift, 2]]
  for (const [x, y] of puffs) {
    if (x < 0 || x >= W || y < 0) continue
    pixels[y * W + x] = color('#8a8178')
  }
}

/**
 * Furnace art for a state. `frame` only matters while `working`; every other
 * state is a single cached buffer.
 */
export function furnaceStationArt(state: StationState, frame = 0): PixelArt {
  const step = frameOf(state, frame)
  return memo(`${state}|${step}`, () => {
    const pixels = masonry()
    mouth(pixels)
    ironwork(pixels)

    if (state === 'ready') {
      oreStack(pixels)
      emberBed(pixels, W, H, 19, 10, 20, false)
      emberBed(pixels, W, H, 18, 11, 19, false)
      glow(pixels, 0.3)
      readyPip(pixels, W, H, 14, 10)
    }

    if (state === 'working') {
      emberBed(pixels, W, H, 19, 10, 20, true)
      emberBed(pixels, W, H, 18, 10, 20, true)
      // Three tongues across the grate, so the mouth is full of fire.
      for (const [cx, height] of [[12, 5], [15, 7], [18, 5]] as const) {
        const fire = fireTongue(W, H, cx, 18, height, step)
        for (let i = 0; i < pixels.length; i++) if (fire[i]) pixels[i] = fire[i]
      }
      glow(pixels, 1)
      smoke(pixels, step)
    }

    if (state === 'done') {
      emberBed(pixels, W, H, 19, 11, 19, false)
      glow(pixels, 0.3)
      ingot(pixels)
      doneSparkle(pixels, W, H, 22, 17)
    }

    return stationArtOf(W, H, pixels, FURNACE_AX, FURNACE_AY)
  })
}

/** Declared size and anchor, identical in all four states. */
export const FURNACE_BOUNDS: StationBounds = stationBounds(furnaceStationArt('idle'))
