// Logging tree art (R31-C3): the world's own tree, plus what tells the player
// it can be felled and what is left afterwards.
//
// A harvestable tree is NOT a new sprite: it is the prop WildLands already
// draws (same recipe, same footprint, same shadow) with a forester's ribbon tied
// round the trunk, a notch cut out of it and the first logs at its foot. That
// keeps the forest a forest.

import { hash2 } from '../../wildlands/engine/noise'
import { TRANSPARENT } from '../../wildlands/engine/pixels'
import { LEAVES, PALM_TRUNK_OUTLINE, PALM_TRUNK_TONES, TREE_METRICS, treeKindPixels, treeTrunkPixels, TRUNK_OUTLINE, TRUNK_TONES, type TreeKind } from '../../wildlands/engine/props'
import { CUT_RING, CUT_TONES, RESIN_TONES, RIBBON, SPROUT_TONES, WOOD_TIERS, type WoodTier } from './loggingPalette'
import { color, pixelArt, reoutline, type PixelArt } from './pixelArt'

export const LOGGING_NODE_IDS = ['common_tree', 'pine_tree', 'hardwood_tree', 'boreal_tree'] as const
export type LoggingNodeId = (typeof LOGGING_NODE_IDS)[number]

/** Tree kinds each node spawns on (R31-A catalog); the first is the gallery default. */
export const NODE_TREE_KINDS: Readonly<Record<LoggingNodeId, readonly TreeKind[]>> = {
  common_tree: ['tree', 'palm'],
  pine_tree: ['pine'],
  hardwood_tree: ['tree'],
  boreal_tree: ['snowpine'],
}

export const NODE_WOOD_TIER: Readonly<Record<LoggingNodeId, WoodTier>> = {
  common_tree: 'common',
  pine_tree: 'common',
  hardwood_tree: 'hardwood',
  boreal_tree: 'boreal',
}

/** ready → (felled) → stump → sprout → sapling → ready again. */
export type TreeArtState = 'ready' | 'stump' | 'sprout' | 'sapling'

/** Regrowth frames shown between stump and a full tree. */
export const REGROW_FRAMES = 2

const cache = new Map<string, PixelArt>()
const memo = (key: string, build: () => PixelArt): PixelArt => {
  let art = cache.get(key)
  if (!art) cache.set(key, (art = build()))
  return art
}

const TRUNK_PACKED = TRUNK_TONES.map(tone => color(tone))
const TRUNK_OUTLINE_PACKED = color(TRUNK_OUTLINE)

/** Repaints the prop's bark in the tier's own tones; the canopy is untouched. */
function retint(pixels: Uint32Array, tier: WoodTier): void {
  if (tier === 'common') return
  const target = WOOD_TIERS[tier]
  const tones = target.tones.map(tone => color(tone))
  const outline = color(target.outline)
  for (let i = 0; i < pixels.length; i++) {
    const value = pixels[i]
    if (value === TRUNK_OUTLINE_PACKED) {
      pixels[i] = outline
      continue
    }
    const index = TRUNK_PACKED.indexOf(value)
    if (index >= 0) pixels[i] = tones[Math.min(index, tones.length - 1)]
  }
}

/**
 * The packed bark colours of a tree, used to tell trunk from canopy. The palm
 * keeps its own paler stem (the engine never painted it with the common trunk
 * tones), so it needs its own entry or its marks land nowhere.
 */
function barkPalette(tier: WoodTier, kind: TreeKind): Set<number> {
  const { tones, outline, streak } = WOOD_TIERS[tier]
  const bark = new Set<number>([...tones.map(tone => color(tone)), color(outline), color(streak)])
  if (kind === 'palm') for (const tone of [...PALM_TRUNK_TONES, PALM_TRUNK_OUTLINE]) bark.add(color(tone))
  return bark
}

/**
 * Trunk column at a given row, as [x0, x1] of *bark* pixels. Matching on colour
 * instead of on opacity matters: on a pine the canopy skirt covers the trunk box
 * for most of its height, and an opacity test would hand back the foliage.
 */
function trunkSpan(pixels: Uint32Array, w: number, y: number, box: readonly [number, number, number, number], bark: Set<number>): [number, number] | null {
  let x0 = -1
  let x1 = -1
  for (let x = Math.max(0, Math.floor(box[0]) - 2); x <= Math.min(w - 1, Math.ceil(box[1]) + 2); x++) {
    if (!bark.has(pixels[y * w + x])) continue
    if (x0 < 0) x0 = x
    x1 = x
  }
  return x0 < 0 ? null : [x0, x1]
}

/**
 * The stretch of trunk the player actually sees: the run of rows ending at the
 * foot where the bark is clear of the canopy. Every mark goes inside this band,
 * so a pine (a hand's width of trunk under the skirt) and an oak (a long bare
 * trunk) both get their cues where they can be read.
 */
function exposedTrunk(pixels: Uint32Array, w: number, box: readonly [number, number, number, number], bark: Set<number>): [number, number] {
  const top = Math.round(box[2])
  const bottom = Math.round(box[3])
  const full = Math.round(box[1] - box[0]) - 1
  let start = bottom
  for (let y = bottom; y >= top; y--) {
    const span = trunkSpan(pixels, w, y, box, bark)
    if (!span || span[1] - span[0] + 1 < full) break
    start = y
  }
  return [start, bottom]
}

/**
 * The notch: a wedge bitten out of the trunk, cut from the silhouette itself
 * (not painted over it) so the outline breaks. Pale heartwood shows inside.
 * Read at a glance: someone has already put an axe to this tree.
 */
function carveNotch(pixels: Uint32Array, w: number, h: number, box: readonly [number, number, number, number], bark: Set<number>, tier: WoodTier, y: number, height: number): void {
  // Deepest in the middle: a V, like two axe strokes meeting.
  const depths = [1, 2, 2, 1].slice(0, height)
  depths.forEach((depth, row) => {
    const span = trunkSpan(pixels, w, y + row, box, bark)
    if (!span) return
    const [x0, x1] = span
    for (let i = 0; i < depth; i++) {
      const x = x0 + i
      if (x <= x1) pixels[(y + row) * w + x] = TRANSPARENT
    }
    // Exposed heartwood behind the cut, brightest where the wedge is deepest.
    const inner = Math.min(x0 + depth, x1)
    pixels[(y + row) * w + inner] = color(CUT_TONES[depth === 2 ? 2 : 1])
    const shade = inner + 1
    if (shade <= x1) pixels[(y + row) * w + shade] = color(CUT_RING)
  })
  reoutline(pixels, w, h, color(WOOD_TIERS[tier].outline))
}

/**
 * The forester's ribbon tied around the trunk: the cue that survives distance.
 * Bark is brown and leaves are green, so a red band is unmistakable and, unlike
 * an outline or a floating icon, it belongs to the tree.
 */
function tieRibbon(pixels: Uint32Array, w: number, box: readonly [number, number, number, number], bark: Set<number>, y: number, tails: number): void {
  const put = (x: number, row: number, value: number) => {
    if (x < 0 || x >= w) return
    pixels[(y + row) * w + x] = value
  }
  for (let row = 0; row < 2; row++) {
    const span = trunkSpan(pixels, w, y + row, box, bark)
    if (!span) continue
    const [x0, x1] = span
    // The band wraps the trunk and juts one pixel past it, so the outline breaks.
    for (let x = x0; x <= x1; x++) put(x, row, color(row === 0 ? RIBBON.light : RIBBON.dark))
    put(x0 - 1, row, color(RIBBON.outline))
    put(x1 + 1, row, color(RIBBON.outline))
    put(x0 + 1, 0, color(RIBBON.tie))
  }
  // Two short tails hanging from the knot, as long as there is trunk left.
  const span = trunkSpan(pixels, w, y + 1, box, bark)
  if (span && tails > 0) {
    put(span[0], 2, color(RIBBON.dark))
    put(span[1] - 1, 2, color(RIBBON.light))
    if (tails > 1) put(span[1] - 1, 3, color(RIBBON.dark))
  }
}

/**
 * Cut logs stacked at the foot: the second cue, down at ground level where the
 * eye reads the forest tile by tile.
 */
function logStack(pixels: Uint32Array, w: number, kind: TreeKind, tier: WoodTier): void {
  const { ay, trunk: box } = TREE_METRICS[kind]
  const bark = WOOD_TIERS[tier]
  const outline = color(bark.outline)
  const baseX = Math.round(box[1]) + 2
  const put = (x: number, y: number, value: number) => {
    if (x < 0 || x >= w || y < 0) return
    pixels[y * w + x] = value
  }
  // Two short logs, the upper one nested between them, seen end-on from the left.
  const rows: readonly [number, number, number][] = [
    [ay, baseX, 6],
    [ay - 2, baseX + 1, 5],
  ]
  for (const [y, x0, length] of rows) {
    for (let i = 0; i < length; i++) {
      put(x0 + i, y - 1, i === 0 ? color(CUT_TONES[2]) : color(bark.tones[2]))
      put(x0 + i, y, i === 0 ? color(CUT_TONES[1]) : color(bark.tones[1]))
    }
    put(x0 - 1, y - 1, outline)
    put(x0 - 1, y, outline)
    put(x0 + length, y - 1, outline)
    put(x0 + length, y, outline)
    for (let i = -1; i <= length; i++) put(x0 + i, y + 1, outline)
    put(x0, y - 1, color(CUT_TONES[2]))
  }
}

/** Per-node marks: resin beads, dark grain or frost, on the visible trunk. */
function tierMarks(pixels: Uint32Array, w: number, box: readonly [number, number, number, number], bark: Set<number>, band: readonly [number, number], nodeId: LoggingNodeId): void {
  const [top, bottom] = band
  const mark = (y: number, offset: number, tone: string) => {
    if (y < top || y > bottom) return
    const span = trunkSpan(pixels, w, y, box, bark)
    if (!span) return
    const x = Math.min(span[1] - 1, span[0] + 1 + offset)
    if (x < 0 || x >= w) return
    pixels[y * w + x] = color(tone)
  }
  if (nodeId === 'pine_tree') {
    mark(top + 1, 1, RESIN_TONES[2])
    mark(top + 2, 1, RESIN_TONES[1])
    mark(bottom - 1, 2, RESIN_TONES[2])
    return
  }
  if (nodeId === 'hardwood_tree' || nodeId === 'boreal_tree') {
    const streak = WOOD_TIERS[NODE_WOOD_TIER[nodeId]].streak
    for (let y = top + 1; y < bottom; y += 3) mark(y, (y % 2) + 1, streak)
  }
}

/** Cuts the trunk down to a stump and paints the pale face with its rings. */
function stumpPixels(kind: TreeKind, tier: WoodTier): { pixels: Uint32Array; w: number; h: number; cutY: number } {
  const { w, h, trunk: box } = TREE_METRICS[kind]
  const pixels = treeTrunkPixels(kind)
  retint(pixels, tier)
  const bottom = Math.round(box[3])
  const cutY = Math.max(1, bottom - 6)
  for (let y = 0; y < cutY; y++) pixels.fill(TRANSPARENT, y * w, (y + 1) * w)

  const span = trunkSpan(pixels, w, cutY + 1, box, barkPalette(tier, kind))
  if (span) {
    const [x0, x1] = span
    for (let x = x0; x <= x1; x++) {
      pixels[cutY * w + x] = color(CUT_TONES[1])
      pixels[(cutY + 1) * w + x] = color(CUT_TONES[2])
    }
    // One ring and the bark lip around the face.
    const cx = Math.round((x0 + x1) / 2)
    pixels[cutY * w + cx] = color(CUT_RING)
    pixels[(cutY + 1) * w + Math.max(x0, cx - 1)] = color(CUT_RING)
    pixels[cutY * w + x0] = color(WOOD_TIERS[tier].outline)
    pixels[cutY * w + x1] = color(WOOD_TIERS[tier].outline)
  }
  reoutline(pixels, w, h, color(WOOD_TIERS[tier].outline))
  return { pixels, w, h, cutY }
}

/** Wood chips left around a fresh stump. */
function litter(pixels: Uint32Array, w: number, h: number, salt: number): void {
  for (const [dx, tone] of [[-3, CUT_TONES[2]], [3, CUT_TONES[1]], [5, CUT_TONES[0]]] as const) {
    const x = Math.round(w / 2) + dx
    const y = h - 1 - (hash2(x, dx, salt) < 0.5 ? 0 : 1)
    if (x < 0 || x >= w || y < 0) continue
    pixels[y * w + x] = color(tone)
  }
}

function readyArt(nodeId: LoggingNodeId, kind: TreeKind): PixelArt {
  const { w, h, ax, ay } = TREE_METRICS[kind]
  const tier = NODE_WOOD_TIER[nodeId]
  const box = TREE_METRICS[kind].trunk
  const pixels = treeKindPixels(kind)
  retint(pixels, tier)

  // Everything is laid out inside the trunk the player can actually see, from
  // the ribbon down: on a pine that band is three rows, on an oak it is eight.
  const bark = barkPalette(tier, kind)
  const band = exposedTrunk(pixels, w, box, bark)
  tierMarks(pixels, w, box, bark, band, nodeId)
  const notchY = band[0] + 3
  const notchRows = Math.min(4, band[1] - notchY)
  if (notchRows >= 2) carveNotch(pixels, w, h, box, bark, tier, notchY, notchRows)
  tieRibbon(pixels, w, box, bark, band[0], Math.min(2, band[1] - band[0] - 1))
  logStack(pixels, w, kind, tier)
  return pixelArt(w, h, pixels, ax, ay)
}

function regrowArt(nodeId: LoggingNodeId, kind: TreeKind, state: Exclude<TreeArtState, 'ready'>): PixelArt {
  const tier = NODE_WOOD_TIER[nodeId]
  const { pixels, w, h, cutY } = stumpPixels(kind, tier)
  const { ax, ay } = TREE_METRICS[kind]
  litter(pixels, w, h, LOGGING_NODE_IDS.indexOf(nodeId) * 17 + 3)
  const cx = Math.round(w / 2)

  if (state === 'sprout') {
    // A shoot with two leaves out of the cut face.
    for (let i = 1; i <= 3; i++) pixels[(cutY - i) * w + cx] = color(SPROUT_TONES[0])
    pixels[(cutY - 3) * w + cx - 1] = color(SPROUT_TONES[1])
    pixels[(cutY - 3) * w + cx + 1] = color(SPROUT_TONES[2])
    pixels[(cutY - 4) * w + cx] = color(SPROUT_TONES[1])
  }

  if (state === 'sapling') {
    // A young tree: thin stem and a small canopy, in the kind's own greens.
    const leaves = kind === 'snowpine' ? ['#255a45', '#35775a', '#dfe9f5'] : LEAVES.slice(1, 4)
    for (let i = 1; i <= 7; i++) pixels[(cutY - i) * w + cx] = color(i > 4 ? SPROUT_TONES[0] : TRUNK_TONES[1])
    for (let dy = -11; dy <= -6; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        if (dx * dx * 1.4 + (dy + 8.5) * (dy + 8.5) * 2.4 > 12) continue
        const y = cutY + dy
        const x = cx + dx
        if (y < 0 || x < 0 || x >= w) continue
        pixels[y * w + x] = color(leaves[(dx + dy + 12) % leaves.length])
      }
    }
  }
  return pixelArt(w, h, pixels, ax, ay)
}

/** Art for a logging node on its host tree. */
export function loggingTreeArt(nodeId: LoggingNodeId, kind: TreeKind, state: TreeArtState): PixelArt {
  return memo(`${nodeId}|${kind}|${state}`, () => (state === 'ready' ? readyArt(nodeId, kind) : regrowArt(nodeId, kind, state)))
}

/** Regrowth stage for a 0..1 progress: stump → sprout → sapling. */
export function regrowState(progress: number): Exclude<TreeArtState, 'ready'> {
  if (progress >= 0.66) return 'sapling'
  return progress >= 0.33 ? 'sprout' : 'stump'
}

export function isLoggingNodeId(id: string): id is LoggingNodeId {
  return (LOGGING_NODE_IDS as readonly string[]).includes(id)
}

export function isTreeKind(kind: string | null): kind is TreeKind {
  return kind === 'tree' || kind === 'pine' || kind === 'snowpine' || kind === 'palm'
}

/**
 * The decorative tree exactly as the world draws it, with no blaze: the
 * contrast case the gallery shows beside a harvestable one.
 */
export function plainTreeArt(kind: TreeKind): PixelArt {
  return memo(`plain|${kind}`, () => {
    const { w, h, ax, ay } = TREE_METRICS[kind]
    return pixelArt(w, h, treeKindPixels(kind), ax, ay)
  })
}
