// Station visual language (T-S3).
//
// Three stations are coming — furnace, campfire, workbench — and the playtest
// asked for the same thing of all of them: that they read as **interactive
// objects**, not as scenery. The Alchemy bench already solved that problem once
// (`alchemyStation.ts`); this module turns its answer into a shared contract so
// the next three do not each invent their own.
//
// The language, in five rules:
//
//   1. **Worked silhouette.** The world grows rocks, trees and bushes: organic
//      blobs. A station is built — straight edges, right angles, cut stone,
//      sawn wood, metal. That alone separates it from decor at a glance.
//   2. **Feet at the front.** The anchor sits on the front-bottom edge of the
//      art, like every other world prop, so draw order and adjacency agree.
//   3. **A ground pad.** Every station stands on something: trodden earth, a
//      stone base, a scorch ring. It says "somebody put this here".
//   4. **Four shared states**, `idle → ready → working → done`, meaning the
//      same thing everywhere and each visibly different from the others.
//   5. **One active feature** per station carries the state — the fire in the
//      furnace, the flame in the campfire, the piece on the workbench — so the
//      state is readable from across the clearing, without opening a panel.
//
// **This module is art only.** It has no idea what a station *does*: no recipe,
// no fuel, no duration, no solidity, no hitbox, no placement. It returns pixel
// buffers, and whoever places a station later decides everything else.
//
// The only imports are the pixel primitives the rest of `art/` already uses
// (`shade`, `layer`, `pixelArt`) and existing palettes. No engine state, no
// renderer, no DOM, no Vue, no domain, no inventory, no services.

import { TRANSPARENT } from '../../wildlands/engine/pixels'
import { layer, shade, type ShadeFn } from '../../wildlands/engine/sprite'
import { color, pixelArt, type PixelArt } from './pixelArt'

/**
 * What a station is doing, in the words the design approved.
 *
 * `idle`    — cold, empty, nothing loaded. It still reads as a station.
 * `ready`   — it has what it needs and the player could start now.
 * `working` — running. This is the only animated state (`frame`).
 * `done`    — finished; there is something to take.
 *
 * The Alchemy bench predates this and calls its working state `brewing`
 * (`alchemyStation.ts`). It is the same state under a profession's name; it is
 * not touched here.
 */
export type StationState = 'idle' | 'ready' | 'working' | 'done'

export const STATION_STATES: readonly StationState[] = ['idle', 'ready', 'working', 'done']

/** The stations this kit covers. The alchemy bench keeps its own module. */
export type StationKind = 'furnace' | 'campfire' | 'workbench'

export const STATION_KINDS: readonly StationKind[] = ['furnace', 'campfire', 'workbench']

/**
 * The size and anchor of a station's art, in art pixels.
 *
 * This is a **drawing** measurement, not a physical one: it says how big the
 * sprite is and where its feet are, and nothing about which tiles it occupies
 * or what it blocks. Whoever places the station decides that (F-1), and may
 * use these numbers to declare a tap hitbox — but that declaration lives with
 * the placement, not here.
 */
export interface StationBounds {
  /** Art width in pixels. */
  readonly width: number
  /** Art height in pixels. */
  readonly height: number
  /** Anchor x: the horizontal middle of the art. */
  readonly anchorX: number
  /** Anchor y: the front-bottom row, where the station meets the ground. */
  readonly anchorY: number
}

export const stationBounds = (art: PixelArt): StationBounds =>
  ({ width: art.w, height: art.h, anchorX: art.ax, anchorY: art.ay })

// ── Shared palette ──────────────────────────────────────────────────────────
//
// Cut stone, sawn wood, iron and fire. Deliberately narrow: three stations that
// share a material family read as three things built by the same hands.

/** Dressed stone: the furnace body, the campfire ring, the workbench footing. */
export const MASONRY_TONES = ['#4a4741', '#6b675e', '#8d887c', '#aca596'] as const
export const MASONRY_OUTLINE = '#2b2925'

/** Sawn timber: worktops, beams, firewood. Warmer and lighter than the world's trunks. */
export const TIMBER_TONES = ['#5a3d24', '#7d5631', '#a1723f', '#c08f55'] as const
export const TIMBER_OUTLINE = '#33210f'

/** Iron: bands, hinges, tools, the anvil face. */
export const IRON_TONES = ['#3c4148', '#585f68', '#767f8a', '#9aa3ad'] as const
export const IRON_OUTLINE = '#22262b'

/**
 * Fire, dark to white-hot. Shared by the furnace mouth and the campfire so the
 * player learns one colour for "this is running".
 */
export const FIRE_TONES = ['#8f2408', '#c23a10', '#f07818', '#ffc247', '#fff3b0'] as const

/** The ground a station is standing on: trodden earth and ash. */
export const PAD_TONES = ['#3b3228', '#4d4135', '#5e5043'] as const

/** The small "ready" mark every station shares, so the state has one colour. */
export const READY_PIP = '#ffd27a'
/** The "done" sparkle, same as the bench's. */
export const DONE_SPARKLE = '#fff3b0'

// ── Shared parts ────────────────────────────────────────────────────────────

/**
 * The ground pad (rule 3): a flattened ellipse of trodden earth under the
 * station, darkest at the rim. Drawn first so everything else sits on it.
 */
export function groundPad(w: number, h: number, cx: number, cy: number, rx: number, ry: number): Uint32Array {
  const pad: ShadeFn = (x, y) => {
    const dx = (x + 0.5 - cx) / rx
    const dy = (y + 0.5 - cy) / ry
    const d = dx * dx + dy * dy
    return d <= 1 ? 0.35 + (1 - d) * 0.45 : null
  }
  return shade(w, h, pad, { tones: PAD_TONES, outline: PAD_TONES[0], dither: 0.4 })
}

/**
 * A rectangular block of worked material (rule 1). Straight edges on purpose:
 * this is the shape that says "built" instead of "grown".
 */
export function block(
  w: number, h: number, x0: number, y0: number, x1: number, y1: number,
  tones: readonly string[], outline: string, top = 0.95, bottom = 0.45,
): Uint32Array {
  const span = Math.max(1, y1 - y0)
  const face: ShadeFn = (x, y) => (x >= x0 && x <= x1 && y >= y0 && y <= y1
    ? top - (y - y0) / span * (top - bottom)
    : null)
  return shade(w, h, face, { tones, outline, dither: 0.3 })
}

/** Paints `value` at a list of art coordinates. Bounds-checked, so art edits are safe. */
export function dots(pixels: Uint32Array, w: number, h: number, value: number, at: readonly (readonly [number, number])[]): void {
  for (const [x, y] of at) {
    if (x < 0 || y < 0 || x >= w || y >= h) continue
    pixels[y * w + x] = value
  }
}

/**
 * The flame shape shared by the furnace mouth and the campfire: a tongue that
 * narrows upward, flickering with `frame`. Returns the pixels so the caller
 * decides what it sits on.
 */
export function fireTongue(
  w: number, h: number, cx: number, baseY: number, height: number, frame: number,
): Uint32Array {
  const pixels = new Uint32Array(w * h)
  const lean = [0, 1, 0, -1][frame % 4]
  for (let i = 0; i < height; i++) {
    const y = baseY - i
    if (y < 0 || y >= h) continue
    const t = i / Math.max(1, height - 1)
    // Wide and dark at the base, narrow and white at the tip.
    const half = Math.max(0, Math.round((1 - t) * 2.2))
    const tone = t > 0.82 ? 4 : t > 0.55 ? 3 : t > 0.25 ? 2 : 1
    const drift = Math.round(lean * t)
    for (let dx = -half; dx <= half; dx++) {
      const x = cx + drift + dx
      if (x < 0 || x >= w) continue
      pixels[y * w + x] = color(FIRE_TONES[Math.abs(dx) === half && half > 0 ? Math.max(1, tone - 1) : tone])
    }
  }
  return pixels
}

/** Embers: the low, dark glow of a fire that is loaded but not lit yet, or dying. */
export function emberBed(
  pixels: Uint32Array, w: number, h: number, y: number, x0: number, x1: number, bright: boolean,
): void {
  for (let x = x0; x <= x1; x++) {
    if (x < 0 || x >= w || y < 0 || y >= h) continue
    // Alternating tones read as coals rather than a painted line.
    const hot = (x + y) % 2 === 0
    pixels[y * w + x] = color(FIRE_TONES[bright ? (hot ? 3 : 2) : (hot ? 1 : 0)])
  }
}

/**
 * The shared state marks (rule 5, support): a small pip when a station is
 * ready, and a sparkle when something is waiting to be taken. They are the
 * same colour on every station, so the player learns them once.
 */
export function readyPip(pixels: Uint32Array, w: number, h: number, x: number, y: number): void {
  dots(pixels, w, h, color(READY_PIP), [[x, y], [x + 1, y]])
}

export function doneSparkle(pixels: Uint32Array, w: number, h: number, x: number, y: number): void {
  dots(pixels, w, h, color(DONE_SPARKLE), [[x, y], [x - 1, y + 1], [x + 1, y + 1], [x, y + 2]])
}

// ── Helpers for the station modules ─────────────────────────────────────────

/** Stacks layers bottom-up into one buffer. `layer` paints onto the base. */
export function compose(w: number, h: number, layers: readonly Uint32Array[]): Uint32Array {
  const out = new Uint32Array(w * h)
  for (const next of layers) layer(out, next)
  return out
}

/** Only `working` animates; every other state is one frame, which keeps art cached. */
export const frameOf = (state: StationState, frame: number): number => (state === 'working' ? frame % 4 : 0)

/**
 * A stable fingerprint of an art buffer (FNV-1a over the pixels plus the
 * geometry). Pure and deterministic: the tests use it to prove that the same
 * state always draws the same thing and that two states never draw the same
 * thing.
 */
export function stationArtHash(art: PixelArt): string {
  let hash = 0x811c9dc5
  const mix = (value: number): void => {
    hash ^= value >>> 0
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  mix(art.w)
  mix(art.h)
  mix(art.ax)
  mix(art.ay)
  for (const value of art.pixels) mix(value)
  return hash.toString(16).padStart(8, '0')
}

/** How many pixels differ between two arts of the same size. */
export function pixelDifference(a: PixelArt, b: PixelArt): number {
  if (a.w !== b.w || a.h !== b.h) return Math.max(a.pixels.length, b.pixels.length)
  let count = 0
  for (let i = 0; i < a.pixels.length; i++) if (a.pixels[i] !== b.pixels[i]) count++
  return count
}

/** Opaque pixels, so a test can assert a station is actually drawn. */
export function inked(art: PixelArt): number {
  let count = 0
  for (const value of art.pixels) if (value !== TRANSPARENT) count++
  return count
}

/** Builds the `PixelArt` record with the front-bottom anchor rule (rule 2). */
export const stationArtOf = (w: number, h: number, pixels: Uint32Array, ax: number, ay: number): PixelArt =>
  pixelArt(w, h, pixels, ax, ay)
