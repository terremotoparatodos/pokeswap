// City tree family — ground bases.
//
// The forest PNGs bake a ground shadow tinted for the city's lawn; on stone,
// street or another grass it reads as a coloured ring. Placed trees drop it
// (see cityTrees.ts) and get a small base painted *on the ground* instead:
// a neutral, dithered, translucent contact shadow — it darkens whatever
// terrain is there instead of covering it — plus, on grass, a couple of tufts
// or root nubs in the tree's own ramp. On paving it is only the shadow.
//
// Four styles, chosen from the terrain and the tree; no per-placement data.
// Pure pixels here (testable without a DOM); cityTreeSprites.ts turns them
// into canvases for the renderer.

import { packColor } from '../../wildlands/engine/pixels'
import { T, type Terrain } from '../../wildlands/engine/world'
import { cityTree, type CityTreeId } from './cityTrees'

export type GroundBaseStyle = 'grass-tufts' | 'grass-roots' | 'paved' | 'forest'
export const GROUND_BASE_STYLES: readonly GroundBaseStyle[] = ['grass-tufts', 'grass-roots', 'paved', 'forest']

/** Coarse ground families the bases know about. */
export type GroundKind = 'grass' | 'paved' | 'forest'

export function groundBaseStyle(ground: GroundKind, tree: CityTreeId): GroundBaseStyle {
  if (ground === 'paved') return 'paved'
  if (ground === 'forest') return 'forest'
  return cityTree(tree).grassBase === 'roots' ? 'grass-roots' : 'grass-tufts'
}

/** City terrain letters (hearthomeTerrain.ts) → ground family. */
export function townGround(letter: string | null | undefined): GroundKind {
  if (letter === 's' || letter === 'p') return 'paved'
  if (letter === 't') return 'forest'
  return 'grass'
}

/** WildLands terrain ids (engine/world.ts) → ground family: grass is grass, everything else gets the plain shadow. */
export function wildGround(terrain: Terrain): GroundKind {
  return terrain === T.GRASS || terrain === T.TALL ? 'grass' : 'paved'
}

export interface GroundBasePixels {
  readonly width: number
  readonly height: number
  /** Where the roots' bottom centre goes inside the image. */
  readonly ox: number
  readonly oy: number
  /** Row-major packed RGBA (engine/pixels.ts). */
  readonly pixels: Uint32Array
}

// Translucent near-black: darkens grass, stone and sand alike.
const SHADE = [packColor('#141c10', 46), packColor('#141c10', 78), packColor('#141c10', 104)]
const TUFT_DARK = packColor('#2f6a2e', 235)
const TUFT_LIGHT = packColor('#7cc050', 235)
const ROOT = packColor('#6f653c')
const ROOT_LIGHT = packColor('#8b6d45')
const ROOT_LINE = packColor('#333322')

/** Ground base pixels for a tree whose roots span `rootWidth` px. Deterministic. */
export function groundBasePixels(style: GroundBaseStyle, rootWidth: number): GroundBasePixels {
  const forest = style === 'forest'
  const paved = style === 'paved'
  const rx = Math.round(rootWidth / 2) + (paved ? 4 : 6)
  const ry = forest ? 5 : paved ? 3 : 4
  const width = rx * 2 + 3
  const height = ry * 2 + 4
  const cx = Math.floor(width / 2)
  // The shadow sits mostly under and just in front of the roots.
  const cy = ry + 1
  const px = new Uint32Array(width * height)
  const put = (x: number, y: number, c: number) => {
    if (x >= 0 && y >= 0 && x < width && y < height) px[y * width + x] = c
  }
  const levels = paved ? [0, 0, 1] : forest ? [1, 2, 2] : [0, 1, 2]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
      if (d > 1) continue
      // Ordered dither on the rim keeps the pixel-art edge instead of a smooth blur.
      const rim = d > 0.62
      if (rim && (x + y) % 2 === 1) continue
      put(x, y, SHADE[levels[d < 0.3 ? 2 : d < 0.62 ? 1 : 0]])
    }
  }
  if (style === 'grass-tufts') {
    // Two small clumps at the ends of the roots, one blade lit.
    for (const [bx, dir] of [[cx - rx + 3, -1], [cx + rx - 3, 1]] as const) {
      put(bx, cy, TUFT_DARK); put(bx, cy - 1, TUFT_DARK); put(bx + dir, cy, TUFT_DARK)
      put(bx - dir, cy - 1, TUFT_LIGHT); put(bx - dir, cy - 2, TUFT_LIGHT)
    }
  } else if (style === 'grass-roots') {
    // Root nubs creeping a few pixels out of the trunk base, in the trunk ramp.
    const half = Math.round(rootWidth / 2)
    for (const dir of [-1, 1]) {
      const x0 = cx + dir * (half - 1)
      put(x0 + dir, cy - 1, ROOT_LIGHT); put(x0 + dir * 2, cy - 1, ROOT); put(x0 + dir * 3, cy, ROOT)
      put(x0 + dir, cy, ROOT_LINE); put(x0 + dir * 2, cy, ROOT_LINE); put(x0 + dir * 3, cy + 1, ROOT_LINE); put(x0 + dir * 4, cy, ROOT_LINE)
    }
  }
  // Anchored one row above the shadow's centre: the roots' bottom row sits on it.
  return { width, height, ox: cx, oy: cy - 1, pixels: px }
}

/** Width of a tree's roots, in pixels. */
export function rootWidth(tree: CityTreeId): number {
  const t = cityTree(tree).trunk
  return t.x1 - t.x0 + 1
}
