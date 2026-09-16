// Fishing spot art (R31-C2): what the water itself shows.
//
// A spot is not a prop: it is a flat mark painted on the water (darker patch,
// foam ring, a moving shadow under the surface), so the coast keeps looking
// like water and never like a button placed on top of it.

import { hash2 } from '../../wildlands/engine/noise'
import { TRANSPARENT } from '../../wildlands/engine/pixels'
import { WATER_TONES, type WaterTones } from './fishingPalette'
import { color, pixelArt, type PixelArt } from './pixelArt'

export const FISHING_NODE_IDS = ['shore_spot', 'coastal_spot', 'reef_spot'] as const
export type FishingNodeId = (typeof FISHING_NODE_IDS)[number]

/** ready: fish below · bite: the pull · spent: flat water · respawning: fish returning. */
export type SpotArtState = 'ready' | 'bite' | 'spent' | 'respawning'

export const SPOT_IDLE_FRAMES = 2
export const SPOT_RESPAWN_FRAMES = 3

const W = 20
const H = 13
const CX = W / 2
const CY = H / 2

const cache = new Map<string, PixelArt>()
const memo = (key: string, build: () => PixelArt): PixelArt => {
  let art = cache.get(key)
  if (!art) cache.set(key, (art = build()))
  return art
}

const inEllipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number): number => {
  const dx = (x + 0.5 - cx) / rx
  const dy = (y + 0.5 - cy) / ry
  return 1 - (dx * dx + dy * dy)
}

/** Darker water patch with a dithered edge: "it is deeper here". */
function patch(pixels: Uint32Array, water: WaterTones, alpha: number, salt: number): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const depth = inEllipse(x, y, CX, CY, 9, 5.6)
      if (depth < 0) continue
      if (depth < 0.22 && hash2(x, y, salt) > 0.45) continue
      const tone = depth > 0.55 ? water.tones[0] : water.tones[1]
      pixels[y * W + x] = color(tone, Math.round(alpha * (depth > 0.55 ? 1 : 0.75)))
    }
  }
}

/** Foam ring on the rim, brighter where the light hits (top-left). */
function ring(pixels: Uint32Array, water: WaterTones, alpha: number, rx: number, ry: number): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const outer = inEllipse(x, y, CX, CY, rx, ry)
      const inner = inEllipse(x, y, CX, CY, rx - 1.6, ry - 1.1)
      if (outer < 0 || inner >= 0) continue
      const lit = y < CY ? 1 : 0.6
      pixels[y * W + x] = color(water.foam, Math.round(alpha * lit))
    }
  }
}

/** The fish under the surface: a dark blur, never a drawn fish. */
function shadow(pixels: Uint32Array, offset: number, alpha: number): void {
  const cx = CX + offset
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (inEllipse(x, y, cx, CY + 0.5, 3.4, 1.5) < 0 && inEllipse(x, y, cx - 3.6, CY + 0.5, 1.4, 1.1) < 0) continue
      pixels[y * W + x] = color('#0b2740', alpha)
    }
  }
}

function bubbles(pixels: Uint32Array, water: WaterTones, salt: number, count: number): void {
  let placed = 0
  for (let y = 2; y < H - 2 && placed < count; y++) {
    for (let x = 3; x < W - 3 && placed < count; x++) {
      if (inEllipse(x, y, CX, CY, 7, 4.2) < 0 || hash2(x, y, salt) > 0.06) continue
      pixels[y * W + x] = color(water.foam, 150)
      placed++
    }
  }
}

/**
 * Flat art for a fishing spot, anchored at its centre so the overlay can paint
 * it straight onto the ground buffer (it tilts with the terrain like a mark).
 */
export function fishingSpotArt(nodeId: FishingNodeId, state: SpotArtState, frame = 0): PixelArt {
  const frames = state === 'respawning' ? SPOT_RESPAWN_FRAMES : SPOT_IDLE_FRAMES
  const safe = Math.max(0, Math.min(frames - 1, Math.floor(frame)))
  return memo(`${nodeId}|${state}|${safe}`, () => {
    const water = WATER_TONES[nodeId]
    const pixels = new Uint32Array(W * H)
    const salt = FISHING_NODE_IDS.indexOf(nodeId) * 53 + 7

    if (state === 'spent') {
      patch(pixels, water, 90, salt)
      ring(pixels, water, 70, 8.4, 5.2)
      return pixelArt(W, H, pixels, CX, CY)
    }

    if (state === 'respawning') {
      patch(pixels, water, 110 + safe * 35, salt)
      ring(pixels, water, 90 + safe * 30, 8.4, 5.2)
      bubbles(pixels, water, salt + safe, safe + 1)
      if (safe > 0) shadow(pixels, safe === 1 ? -2 : 0, 60 + safe * 30)
      return pixelArt(W, H, pixels, CX, CY)
    }

    if (state === 'bite') {
      // The water dips: a tight, bright ring and the shadow right under the line.
      patch(pixels, water, 200, salt)
      ring(pixels, water, 230, 6.4, 4)
      ring(pixels, water, 120, 9, 5.6)
      shadow(pixels, 0, 190)
      bubbles(pixels, water, salt + 5, 4)
      return pixelArt(W, H, pixels, CX, CY)
    }

    patch(pixels, water, 160, salt)
    ring(pixels, water, 140, 8.4, 5.2)
    shadow(pixels, safe === 0 ? -2.5 : 2.5, 120)
    bubbles(pixels, water, salt + safe, 2)
    return pixelArt(W, H, pixels, CX, CY)
  })
}

export function isFishingNodeId(id: string): id is FishingNodeId {
  return (FISHING_NODE_IDS as readonly string[]).includes(id)
}

/** Anchors a fishing node can sit on (R31-A catalog). */
export const FISHING_ANCHORS = ['shore', 'coral', 'searock'] as const

export function isFishingAnchor(kind: string | null): kind is (typeof FISHING_ANCHORS)[number] {
  return kind === 'shore' || kind === 'coral' || kind === 'searock'
}

/** True when a spot's art has any painted pixel (used by tests and the gallery). */
export function spotHasArt(art: PixelArt): boolean {
  return art.pixels.some(value => value !== TRANSPARENT)
}
