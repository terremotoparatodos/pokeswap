// Alchemy forage node art (R31-C4.1).
//
// Same contract as the mining nodes and the logging trees: a forage node is
// **the prop the world already draws**, with what can be gathered hanging from
// it. A bush keeps the bush's volume and gains berries; the tundra crystal
// keeps its shards and grows an ice bloom on top.
//
// The herb patch is the exception and the interesting case: its anchor is tall
// *grass*, which is terrain, not a prop — there is nothing to restyle. So the
// patch draws its own tuft: taller, bluer and flowering, over the grass the
// world already paints.

import { hash2 } from '../../wildlands/engine/noise'
import { TRANSPARENT } from '../../wildlands/engine/pixels'
import { ellipses, shade, type ShadeFn } from '../../wildlands/engine/sprite'
import {
  BUD_TONES, BUSH_RECIPES, CRYSTAL_RECIPE, CUT_STEM, FROST_CORE, FROST_OUTLINE, FROST_PETALS,
  FRUIT, HERB_BLADES, HERB_FLOWERS, HERB_OUTLINE, LEAF_OUTLINE, SPARKLE_TONES, TWIG_TONE, type FruitKind,
} from './foragePalette'
import { color, pixelArt, type PixelArt } from './pixelArt'

export const FORAGE_NODE_IDS = ['berry_bush', 'herb_patch', 'wild_grove', 'frost_bloom'] as const
export type ForageNodeId = (typeof FORAGE_NODE_IDS)[number]

/** World anchors each node grows on (R31-A catalog). */
export type ForageAnchor = 'bush' | 'tallGrass' | 'crystal'

export const FORAGE_ANCHORS: Readonly<Record<ForageNodeId, ForageAnchor>> = {
  berry_bush: 'bush',
  herb_patch: 'tallGrass',
  wild_grove: 'bush',
  frost_bloom: 'crystal',
}

/** ready → (gathered) → picked → regrowing → ready again. */
export type ForageArtState = 'ready' | 'picked' | 'regrowing'
export const REGROW_FRAMES = 2

const cache = new Map<string, PixelArt>()
const memo = (key: string, build: () => PixelArt): PixelArt => {
  let art = cache.get(key)
  if (!art) cache.set(key, (art = build()))
  return art
}

// ── Bushes: berry bush (T1) and wild grove (T2) ─────────────────────────────

const BUSH = BUSH_RECIPES.bush

function bushPixels(): Uint32Array {
  return shade(BUSH.w, BUSH.h, ellipses(BUSH.shape), { tones: BUSH.tones, outline: BUSH.outline })
}

/**
 * Deterministic spots on the lit upper half of the bush, never on the outline
 * and never touching each other, so the fruit reads as separate berries.
 */
function fruitSpots(pixels: Uint32Array, count: number, salt: number): [number, number][] {
  const outline = color(LEAF_OUTLINE)
  const spots: [number, number][] = []
  const candidates: [number, number, number][] = []
  for (let y = 2; y < BUSH.h - 3; y++) {
    for (let x = 2; x < BUSH.w - 2; x++) {
      const value = pixels[y * BUSH.w + x]
      if (value === TRANSPARENT || value === outline) continue
      candidates.push([x, y, hash2(x, y, salt)])
    }
  }
  candidates.sort((a, b) => a[2] - b[2])
  for (const [x, y] of candidates) {
    if (spots.length >= count) break
    if (spots.some(([sx, sy]) => Math.abs(sx - x) < 4 && Math.abs(sy - y) < 3)) continue
    spots.push([x, y])
  }
  return spots
}

/** A berry: two body pixels, one highlight, one dark pixel underneath. */
function berry(pixels: Uint32Array, x: number, y: number, kind: FruitKind): void {
  const tones = FRUIT[kind]
  const put = (px: number, py: number, value: number) => {
    if (px < 0 || py < 0 || px >= BUSH.w || py >= BUSH.h) return
    pixels[py * BUSH.w + px] = value
  }
  put(x, y, color(tones.tones[1]))
  put(x + 1, y, color(tones.tones[0]))
  put(x, y + 1, color(tones.outline))
  put(x + 1, y + 1, color(tones.tones[0]))
  put(x, y - 1, color(tones.tones[2]))
}

/** What is left after picking: the bare twig the fruit hung from. */
function twig(pixels: Uint32Array, x: number, y: number): void {
  if (x < 0 || y < 1 || x >= BUSH.w || y >= BUSH.h) return
  pixels[y * BUSH.w + x] = color(TWIG_TONE)
  pixels[(y - 1) * BUSH.w + x] = color(TWIG_TONE)
}

function bud(pixels: Uint32Array, x: number, y: number, ripe: boolean): void {
  if (x < 0 || y < 0 || x >= BUSH.w || y >= BUSH.h) return
  pixels[y * BUSH.w + x] = color(BUD_TONES[ripe ? 1 : 0])
}

/** The grove's crown: a few white blossoms, so a T2 bush is never a T1 bush. */
function blossoms(pixels: Uint32Array): void {
  for (const [x, y] of [[7, 3], [12, 1], [17, 3]] as const) {
    pixels[y * BUSH.w + x] = color(HERB_FLOWERS[2])
    pixels[(y + 1) * BUSH.w + x] = color(HERB_FLOWERS[1])
    if (x > 0) pixels[y * BUSH.w + x - 1] = color(HERB_FLOWERS[0])
  }
}

function bushArt(nodeId: 'berry_bush' | 'wild_grove', state: ForageArtState, frame: number): PixelArt {
  const pixels = bushPixels()
  const grove = nodeId === 'wild_grove'
  const salt = grove ? 977 : 311
  const spots = fruitSpots(pixels, grove ? 7 : 5, salt)
  if (grove) blossoms(pixels)

  if (state === 'ready') {
    // The grove carries two fruits at once (Zidra and Zanama); the bush, one.
    spots.forEach(([x, y], index) => berry(pixels, x, y, grove ? (index % 3 === 0 ? 'leppa' : 'sitrus') : 'oran'))
  } else if (state === 'picked') {
    spots.forEach(([x, y]) => twig(pixels, x, y))
  } else {
    // Regrowing: buds first, then buds with a hint of the fruit's colour.
    spots.forEach(([x, y], index) => {
      if (frame > 0 && index % 2 === 0) berry(pixels, x, y, grove ? 'sitrus' : 'oran')
      else bud(pixels, x, y, frame > 0)
    })
  }
  return pixelArt(BUSH.w, BUSH.h, pixels, Math.floor(BUSH.w / 2), BUSH.h - 1)
}

// ── Herb patch: its own tuft over the tall grass ────────────────────────────

const HERB_W = 18
const HERB_H = 16

/**
 * Blades drawn one by one from the root: each is a column that leans away and
 * tapers to a single pixel. Rasterising them as a fan of capsules turned the
 * whole tuft into one dark wedge, which is exactly what a patch must not be.
 */
function blades(tall: boolean): Uint32Array {
  const pixels = new Uint32Array(HERB_W * HERB_H)
  const root = Math.floor(HERB_W / 2)
  const put = (x: number, y: number, tone: string) => {
    if (x < 0 || y < 0 || x >= HERB_W || y >= HERB_H) return
    pixels[y * HERB_W + x] = color(tone)
  }
  // lean: how far the tip drifts sideways; height: how tall this blade is.
  const shape: readonly (readonly [number, number])[] = tall
    ? [[-4, 12], [-2, 9], [-1, 13], [1, 11], [3, 8], [4, 12], [0, 10]]
    : [[-2, 4], [0, 5], [2, 4]]
  shape.forEach(([lean, height], index) => {
    const base = root + Math.round(lean * 0.35)
    for (let step = 0; step < height; step++) {
      const t = step / Math.max(1, height - 1)
      const x = base + Math.round(lean * t)
      const y = HERB_H - 1 - step
      // Lit on the side it leans to, darker at the root: a blade, not a stick.
      const tone = step === height - 1 ? HERB_BLADES[3] : t > 0.5 ? HERB_BLADES[2] : HERB_BLADES[1]
      put(x, y, tone)
      if (step < 2) put(x, y, HERB_BLADES[0])
      // Every other blade gets a shaded edge so the tuft reads as a volume.
      if (index % 2 === 0 && step > 1) put(x - 1, y, HERB_OUTLINE)
    }
  })
  return pixels
}

function herbArt(state: ForageArtState, frame: number): PixelArt {
  const root = Math.floor(HERB_W / 2)
  const pixels = blades(state === 'ready' || (state === 'regrowing' && frame > 0))
  if (state === 'ready') {
    // Small flowers over the tips: the cue that this tuft is a resource.
    for (const [x, y, tone] of [[5, 3, 1], [9, 2, 2], [13, 5, 0]] as const) {
      pixels[y * HERB_W + x] = color(HERB_FLOWERS[tone])
      pixels[y * HERB_W + x - 1] = color(HERB_FLOWERS[0])
      pixels[y * HERB_W + x + 1] = color(HERB_FLOWERS[0])
      pixels[(y + 1) * HERB_W + x] = color(HERB_FLOWERS[2])
    }
  }
  if (state === 'picked') {
    // Pale cut ends where the blades were taken.
    for (let x = root - 3; x <= root + 3; x++) pixels[(HERB_H - 5) * HERB_W + x] = color(CUT_STEM)
  }
  return pixelArt(HERB_W, HERB_H, pixels, Math.floor(HERB_W / 2), HERB_H - 1)
}

// ── Frost bloom: an ice flower on the tundra crystal ────────────────────────

function crystalPixels(): Uint32Array {
  const { w, h, shards, tones, outline } = CRYSTAL_RECIPE
  const fn: ShadeFn = (x, y) => {
    for (const [cx, cy, hw, hh] of shards) {
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      if (Math.abs(dx) / hw + Math.abs(dy) / hh <= 1) return dx < 0 ? (dy < 0 ? 1 : 0.7) : dy < 0 ? 0.5 : 0.2
    }
    return null
  }
  return shade(w, h, fn, { tones, outline, dither: 0 })
}

function frostArt(state: ForageArtState, frame: number): PixelArt {
  const { w, h } = CRYSTAL_RECIPE
  const pixels = crystalPixels()
  const put = (x: number, y: number, tone: string) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return
    pixels[y * w + x] = color(tone)
  }
  // The bloom sits on the tallest shard. The crystal is already pale cyan, so
  // the flower cannot be pale cyan too: it takes the violet-white of the kit's
  // other flowers, with its own dark rim, and juts past the shard's edge.
  const cx = 7
  const cy = 4
  if (state === 'ready') {
    const petals: readonly (readonly [number, number])[] = [
      [0, -2], [-2, -1], [2, -1], [-3, 1], [3, 1], [-1, 2], [1, 2],
    ]
    for (const [dx, dy] of petals) {
      put(cx + dx, cy + dy, HERB_FLOWERS[0])
      put(cx + dx, cy + dy - 1, HERB_FLOWERS[1])
    }
    // A rim all around, so the flower never dissolves into the shard.
    for (const [dx, dy] of [[-4, 1], [4, 1], [-3, -1], [3, -1], [0, -4], [-2, 3], [2, 3]] as const) {
      put(cx + dx, cy + dy, FROST_OUTLINE)
    }
    put(cx, cy, FROST_CORE[1])
    put(cx, cy - 1, HERB_FLOWERS[2])
    put(cx, cy + 1, FROST_CORE[0])
    put(cx + 4, cy - 3, SPARKLE_TONES[2])
    put(cx - 4, cy - 2, SPARKLE_TONES[1])
  } else if (state === 'picked') {
    // Only the frosted stem is left.
    put(cx, cy + 1, FROST_OUTLINE)
    put(cx, cy + 2, FROST_PETALS[0])
  } else {
    put(cx, cy + 1, FROST_PETALS[0])
    put(cx, cy, frame > 0 ? FROST_PETALS[1] : FROST_PETALS[0])
    if (frame > 0) {
      put(cx - 1, cy, FROST_PETALS[1])
      put(cx + 1, cy, FROST_PETALS[1])
    }
  }
  return pixelArt(w, h, pixels, 7, h - 1)
}

/** Art for a forage node in one of its states. */
export function forageNodeArt(nodeId: ForageNodeId, state: ForageArtState, frame = 0): PixelArt {
  return memo(`${nodeId}|${state}|${frame}`, () => {
    if (nodeId === 'herb_patch') return herbArt(state, frame)
    if (nodeId === 'frost_bloom') return frostArt(state, frame)
    return bushArt(nodeId, state, frame)
  })
}

/** The untouched prop, for the gallery's decorative-versus-resource row. */
export function plainForageArt(anchor: ForageAnchor): PixelArt {
  return memo(`plain|${anchor}`, () => {
    if (anchor === 'crystal') return pixelArt(CRYSTAL_RECIPE.w, CRYSTAL_RECIPE.h, crystalPixels(), 7, CRYSTAL_RECIPE.h - 1)
    if (anchor === 'tallGrass') return pixelArt(HERB_W, HERB_H, blades(false), Math.floor(HERB_W / 2), HERB_H - 1)
    return pixelArt(BUSH.w, BUSH.h, bushPixels(), Math.floor(BUSH.w / 2), BUSH.h - 1)
  })
}

export function isForageNodeId(id: string): id is ForageNodeId {
  return (FORAGE_NODE_IDS as readonly string[]).includes(id)
}

export function isForageAnchor(kind: string | null): kind is ForageAnchor {
  return kind === 'bush' || kind === 'tallGrass' || kind === 'crystal'
}
