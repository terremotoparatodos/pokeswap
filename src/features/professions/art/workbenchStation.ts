// The workbench (T-S3) — art only.
//
// The most obviously man-made of the three and the one with no fire, so its
// state has to be carried by the work itself: what is on the top, and whether
// the tool is in hand or hung up.
//
//   idle    — bare top, tools on the rack, vice closed.
//   ready   — stock and a plan laid out; the pip lit.
//   working — the saw is on the piece, with sawdust coming off it.
//   done    — the finished piece sits on the top and the saw is back on the rack.
//
// The bench deliberately shares the Alchemy table's read — a worktop on legs
// with things stored underneath — because they are the same kind of furniture.
// What separates them is the material and the tools: this one is carpentry and
// iron, not glass.
//
// It knows nothing about recipes, tool tiers or what a "piece" is worth.

import {
  block, compose, doneSparkle, dots, frameOf, groundPad, IRON_OUTLINE, IRON_TONES,
  MASONRY_OUTLINE, MASONRY_TONES, readyPip, stationArtOf, stationBounds, TIMBER_OUTLINE,
  TIMBER_TONES, type StationBounds, type StationState,
} from './stationVisuals'
import { color, type PixelArt } from './pixelArt'

export const WORKBENCH_W = 34
export const WORKBENCH_H = 28
export const WORKBENCH_AX = 17
export const WORKBENCH_AY = 27

const W = WORKBENCH_W
const H = WORKBENCH_H

const cache = new Map<string, PixelArt>()
const memo = (key: string, build: () => PixelArt): PixelArt => {
  let art = cache.get(key)
  if (!art) cache.set(key, (art = build()))
  return art
}

/** Top, legs, lower shelf and the stone footings the legs stand on. */
function bench(): Uint32Array {
  return compose(W, H, [
    groundPad(W, H, 17, 25, 15, 3.2),
    // Stone footings: the bench does not sit in the dirt.
    block(W, H, 4, 23, 8, 25, MASONRY_TONES, MASONRY_OUTLINE, 0.8, 0.5),
    block(W, H, 25, 23, 29, 25, MASONRY_TONES, MASONRY_OUTLINE, 0.8, 0.5),
    // Legs.
    block(W, H, 5, 15, 7, 24, TIMBER_TONES, TIMBER_OUTLINE, 0.65, 0.4),
    block(W, H, 26, 15, 28, 24, TIMBER_TONES, TIMBER_OUTLINE, 0.65, 0.4),
    // Lower shelf with stock on it.
    block(W, H, 7, 19, 26, 20, TIMBER_TONES, TIMBER_OUTLINE, 0.6, 0.45),
    // The worktop: the widest, flattest, most obviously cut thing in the art.
    block(W, H, 2, 13, 31, 16, TIMBER_TONES, TIMBER_OUTLINE, 0.95, 0.6),
    // Back panel with the tool rack.
    block(W, H, 6, 4, 27, 6, TIMBER_TONES, TIMBER_OUTLINE, 0.7, 0.5),
  ])
}

/** The vice at the near corner: iron, and unmistakably a tool. */
function vice(pixels: Uint32Array): void {
  const jaw = compose(W, H, [
    block(W, H, 3, 11, 8, 13, IRON_TONES, IRON_OUTLINE, 0.85, 0.6),
    block(W, H, 4, 16, 6, 18, IRON_TONES, IRON_OUTLINE, 0.7, 0.5),
  ])
  for (let i = 0; i < pixels.length; i++) if (jaw[i]) pixels[i] = jaw[i]
  dots(pixels, W, H, color(IRON_TONES[3]), [[3, 11], [8, 11]])
}

/** Tools hanging on the rack: a saw and a mallet, the carpentry pair. */
function rack(pixels: Uint32Array, sawHung: boolean): void {
  // Mallet: head and handle.
  dots(pixels, W, H, color(TIMBER_TONES[1]), [[22, 7], [23, 7], [24, 7]])
  dots(pixels, W, H, color(TIMBER_TONES[3]), [[23, 8], [23, 9], [23, 10]])
  if (!sawHung) return
  // Saw: blade with a toothed lower edge, plus a handle.
  for (let x = 9; x <= 17; x++) pixels[8 * W + x] = color(IRON_TONES[2])
  for (let x = 9; x <= 17; x += 2) pixels[9 * W + x] = color(IRON_TONES[1])
  dots(pixels, W, H, color(TIMBER_TONES[2]), [[8, 7], [8, 8]])
}

/** Raw stock on the top, plus the drawn plan beside it. */
function stockAndPlan(pixels: Uint32Array): void {
  const plank = block(W, H, 9, 11, 19, 12, TIMBER_TONES, TIMBER_OUTLINE, 0.9, 0.75)
  for (let i = 0; i < pixels.length; i++) if (plank[i]) pixels[i] = plank[i]
  // The plan: a pale sheet with two ruled lines.
  const sheet = color('#cfc7b2')
  for (let x = 22; x <= 27; x++) {
    pixels[11 * W + x] = sheet
    pixels[12 * W + x] = sheet
  }
  dots(pixels, W, H, color('#7d7460'), [[23, 11], [25, 12], [26, 11]])
}

/** The saw biting the piece, mid-cut. */
function sawing(pixels: Uint32Array, step: number): void {
  const offset = [0, 1, 2, 1][step % 4]
  const plank = block(W, H, 9, 11, 19, 12, TIMBER_TONES, TIMBER_OUTLINE, 0.9, 0.75)
  for (let i = 0; i < pixels.length; i++) if (plank[i]) pixels[i] = plank[i]
  const x = 13 + offset
  for (let y = 7; y <= 11; y++) pixels[y * W + x] = color(IRON_TONES[2])
  dots(pixels, W, H, color(IRON_TONES[3]), [[x, 7]])
  dots(pixels, W, H, color(TIMBER_TONES[2]), [[x - 1, 6], [x, 6]])
  // Sawdust falling off the cut.
  dots(pixels, W, H, color(TIMBER_TONES[3]), [[x - 2, 13 + (step % 2)], [x + 2, 14 - (step % 2)]])
}

/** The finished piece: a squared, banded part sitting on the top. */
function finishedPiece(pixels: Uint32Array): void {
  const piece = block(W, H, 11, 9, 20, 12, TIMBER_TONES, TIMBER_OUTLINE, 1, 0.7)
  for (let i = 0; i < pixels.length; i++) if (piece[i]) pixels[i] = piece[i]
  dots(pixels, W, H, color(IRON_TONES[2]), [[13, 9], [13, 10], [13, 11], [18, 9], [18, 10], [18, 11]])
}

export function workbenchStationArt(state: StationState, frame = 0): PixelArt {
  const step = frameOf(state, frame)
  return memo(`${state}|${step}`, () => {
    const pixels = bench()
    vice(pixels)
    // The saw hangs on the rack unless it is in the cut.
    rack(pixels, state !== 'working')

    if (state === 'ready') {
      stockAndPlan(pixels)
      readyPip(pixels, W, H, 29, 10)
    }

    if (state === 'working') sawing(pixels, step)

    if (state === 'done') {
      finishedPiece(pixels)
      doneSparkle(pixels, W, H, 22, 7)
    }

    return stationArtOf(W, H, pixels, WORKBENCH_AX, WORKBENCH_AY)
  })
}

export const WORKBENCH_BOUNDS: StationBounds = stationBounds(workbenchStationArt('idle'))
