// The furnace (T-S3) — art only.
//
// The heaviest of the three: a squat chimney of dressed stone banded with iron,
// with an arched mouth at the front. Everything about the silhouette is built —
// courses of block, a straight chimney, iron bands — so it never reads as a
// boulder someone dropped.
//
// T-S3.2 changed two things after the visual review:
//
//   - the body is fired brick with mortar courses instead of cold grey slabs.
//     Still stone, still nothing like the bench or the workbench, but part of
//     the same warm family rather than a machine from another set;
//   - `ready` and `done` no longer both glow orange. Loaded and finished are
//     different situations and now look it.
//
// The mouth is where the whole station is read:
//
//   idle    — cold and dark. Empty grate, nothing loaded.
//   ready   — charged and waiting: ore heaped **inside** the mouth and on the
//             ledge, the fire unlit. No glow at all.
//   working — the fire is up, the mouth is full of it, the chimney smokes.
//   done    — the fire is out, the mouth dark again, and a bright ingot sits on
//             the ledge with the heat still coming off it.
//
// It knows nothing about fuel, recipes, durations or what an ingot is worth:
// those are `O-8` and `A-12`, and they are not decided here.

import {
  block, compose, courses, doneSparkle, dots, emberBed, FIREBRICK_OUTLINE, FIREBRICK_TONES,
  FIRE_TONES, fireTongue, frameOf, groundPad, IRON_OUTLINE, IRON_TONES, MASONRY_OUTLINE,
  MASONRY_TONES, readyPip, stationArtOf, stationBounds, type StationBounds, type StationState,
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

/**
 * Body, chimney and the stone ledge the ingot ends up on.
 *
 * Fired brick above, grey footing below: the same trick a real forge uses, and
 * it keeps a foot in the material family the campfire ring and the workbench
 * footings are made of.
 */
function masonry(): Uint32Array {
  const pixels = compose(W, H, [
    groundPad(W, H, 15, 31, 13, 3.4),
    // Grey footing: widest, so the thing looks planted.
    block(W, H, 4, 26, 25, 31, MASONRY_TONES, MASONRY_OUTLINE, 0.8, 0.45),
    // Main body, in brick.
    block(W, H, 6, 12, 23, 26, FIREBRICK_TONES, FIREBRICK_OUTLINE, 0.95, 0.55),
    // Shoulder, stepping in toward the chimney.
    block(W, H, 9, 8, 20, 13, FIREBRICK_TONES, FIREBRICK_OUTLINE, 0.9, 0.6),
    // Chimney.
    block(W, H, 12, 1, 17, 9, FIREBRICK_TONES, FIREBRICK_OUTLINE, 0.85, 0.5),
    // Front ledge: where a finished ingot is set down. Grey, like the footing.
    block(W, H, 7, 22, 22, 23, MASONRY_TONES, MASONRY_OUTLINE, 1, 0.8),
  ])
  // Mortar courses over the brick only: this is what says "built course by
  // course" instead of "moulded in one piece".
  const joint = color(FIREBRICK_OUTLINE)
  courses(pixels, W, H, 6, 12, 23, 21, joint, 4)
  courses(pixels, W, H, 12, 1, 17, 8, joint, 4)
  return pixels
}

/**
 * Iron strapping and the grate bars.
 *
 * T-S3.2: these used to be two wide bands in bright iron, and at world scale
 * they were most of what you saw — which is why the furnace read as a grey
 * machine even after the body turned to brick. Now they are thin dark straps
 * with a single highlight row and rivets at the ends: still clearly forged
 * metal, but holding brick together instead of replacing it.
 */
function ironwork(pixels: Uint32Array): void {
  const strap = (y: number): void => {
    for (let x = 6; x <= 23; x++) dots(pixels, W, H, color(IRON_TONES[0]), [[x, y]])
    for (let x = 6; x <= 23; x += 2) dots(pixels, W, H, color(IRON_TONES[2]), [[x, y]])
    // Rivets at both ends.
    dots(pixels, W, H, color(IRON_TONES[3]), [[6, y], [23, y]])
  }
  strap(21)
  strap(11)
  // Grate bars across the mouth.
  dots(pixels, W, H, color(IRON_TONES[1]), [[12, 19], [15, 19], [18, 19]])
}

/**
 * The arched mouth, carved out of the body. Returns the interior rows so the
 * fire is always drawn inside the opening and never over the stone.
 */
function mouth(pixels: Uint32Array): void {
  const dark = color('#1a120c')
  for (let y = 13; y <= 19; y++) {
    // A flat arch: narrow at the top, full width at the grate.
    const half = y <= 14 ? 4 : 6
    for (let x = 15 - half; x <= 15 + half; x++) pixels[y * W + x] = dark
  }
}

/**
 * The charge: ore heaped **inside** the mouth, plus two lumps waiting on the
 * ledge. Putting it inside is what makes `ready` read as loaded, rather than
 * as a furnace that happens to have rocks next to it.
 */
function oreStack(pixels: Uint32Array): void {
  // On the grate, filling the lower half of the opening.
  dots(pixels, W, H, color(MASONRY_TONES[1]), [[12, 18], [13, 18], [14, 18], [16, 18], [17, 18], [18, 18]])
  dots(pixels, W, H, color(MASONRY_TONES[3]), [[13, 17], [17, 17]])
  dots(pixels, W, H, color(MASONRY_TONES[2]), [[15, 18], [15, 17], [16, 17]])
  // Heaped high enough to break the line of the arch.
  dots(pixels, W, H, color(MASONRY_TONES[1]), [[13, 16], [16, 16], [17, 16]])
  // And a row of lumps along the ledge, waiting to go in.
  dots(pixels, W, H, color(MASONRY_TONES[1]), [[8, 21], [9, 21], [8, 20], [11, 21], [20, 21], [21, 21]])
  dots(pixels, W, H, color(MASONRY_TONES[3]), [[9, 20], [11, 20], [21, 20]])
}

/**
 * The damper, open: the iron plate over the flue swung aside, which is what a
 * forge looks like when it has been set up and is one match from running.
 * Together with the charge it is what separates `ready` from `idle` at world
 * scale, where a few pixels of ore would not.
 */
function damperOpen(pixels: Uint32Array): void {
  // The plate, hinged back against the shoulder.
  dots(pixels, W, H, color(IRON_TONES[2]), [[20, 9], [21, 9], [22, 9], [20, 10], [21, 10], [22, 10]])
  dots(pixels, W, H, color(IRON_OUTLINE), [[19, 9], [19, 10], [23, 9], [23, 10]])
  // The flue it uncovered, dark.
  dots(pixels, W, H, color('#1a120c'), [[13, 9], [14, 9], [15, 9], [16, 9], [13, 10], [14, 10], [15, 10], [16, 10]])
}

/** The finished ingot on the front ledge: the reason to come back. */
function ingot(pixels: Uint32Array): void {
  // A trapezoid read from its bright top face down to its dark base: the one
  // shape in the set that means "output, come and take it".
  dots(pixels, W, H, color(IRON_TONES[3]), [[17, 20], [18, 20], [19, 20], [20, 20], [21, 20]])
  dots(pixels, W, H, color(IRON_TONES[2]), [[16, 21], [17, 21], [18, 21], [19, 21], [20, 21], [21, 21], [22, 21]])
  dots(pixels, W, H, color(IRON_OUTLINE), [[16, 20], [22, 20], [15, 21], [23, 21]])
  // Fresh metal catches the light along the top.
  dots(pixels, W, H, color('#e8eef5'), [[18, 20], [20, 20]])
  // Heat still coming off it, onto the stone underneath.
  dots(pixels, W, H, color(FIRE_TONES[2]), [[17, 22], [19, 22], [21, 22]])
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
      // Charged, not lit: no embers, no glow. The difference with `done` is the
      // whole point — one mouth is full of stone, the other of finished metal.
      oreStack(pixels)
      damperOpen(pixels)
      readyPip(pixels, W, H, 10, 10)
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
      // The fire is out and the mouth is dark again; everything bright here is
      // the ingot.
      emberBed(pixels, W, H, 19, 12, 18, false)
      ingot(pixels)
      doneSparkle(pixels, W, H, 24, 17)
    }

    return stationArtOf(W, H, pixels, FURNACE_AX, FURNACE_AY)
  })
}

/** Declared size and anchor, identical in all four states. */
export const FURNACE_BOUNDS: StationBounds = stationBounds(furnaceStationArt('idle'))
