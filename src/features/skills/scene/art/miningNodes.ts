// Mining node art: the host prop's own volume (same recipe, same footprint)
// plus a mineral layer, in three states: ready, depleted and respawning.
//
// Base rock + ore overlay keeps every node recognisably "a WildLands rock",
// and a depleted node reads as the same rock with its minerals knocked out.

import { hash2 } from '../../../wildlands/engine/noise'
import { TRANSPARENT } from '../../../wildlands/engine/pixels'
import { CRYSTAL_RECIPE, ROCK_RECIPES, type BlobRecipe } from '../../../wildlands/engine/props'
import { ellipses, shade, type ShadeFn } from '../../../wildlands/engine/sprite'
import { ORE_TONES, type OreTones } from './miningPalette'
import { color, pixelArt, reoutline, type PixelArt } from './pixelArt'

export type RockAnchor = keyof typeof ROCK_RECIPES
export type MiningAnchor = RockAnchor | 'crystal'
export type NodeArtState = 'ready' | 'depleted' | 'respawning'

export const MINING_NODE_IDS = ['stone_outcrop', 'coal_seam', 'iron_vein', 'gold_vein', 'crystal_cluster'] as const
export type MiningNodeId = (typeof MINING_NODE_IDS)[number]

/** Anchors each node spawns on (R31-A catalog), first one is the gallery default. */
export const NODE_ANCHORS: Readonly<Record<MiningNodeId, readonly MiningAnchor[]>> = {
  stone_outcrop: ['rock'],
  coal_seam: ['rock', 'boulder'],
  iron_vein: ['boulder', 'icerock'],
  gold_vein: ['boulder', 'icerock'],
  crystal_cluster: ['crystal'],
}

interface VeinStyle {
  readonly ore: OreTones
  /** Share of volume pixels that carry small flecks. */
  readonly flecks: number
  readonly nuggets: number
}

const VEINS: Readonly<Record<Exclude<MiningNodeId, 'crystal_cluster'>, VeinStyle>> = {
  stone_outcrop: { ore: ORE_TONES.stone, flecks: 0, nuggets: 3 },
  coal_seam: { ore: ORE_TONES.coal, flecks: 0.14, nuggets: 3 },
  iron_vein: { ore: ORE_TONES.iron, flecks: 0.12, nuggets: 3 },
  gold_vein: { ore: ORE_TONES.gold, flecks: 0.08, nuggets: 4 },
}

/** Respawning frames shown as regrowth progresses. */
export const RESPAWN_FRAMES = 3

const cache = new Map<string, PixelArt>()
const memo = (key: string, build: () => PixelArt): PixelArt => {
  let art = cache.get(key)
  if (!art) cache.set(key, (art = build()))
  return art
}

function baseRock(recipe: BlobRecipe): Uint32Array {
  return shade(recipe.w, recipe.h, ellipses(recipe.shape), { tones: recipe.tones, outline: recipe.outline })
}

/** Deterministic nugget spots on the lit upper half of the volume, at least 3px apart. */
function nuggetSpots(pixels: Uint32Array, w: number, h: number, outline: number, count: number, salt: number): [number, number][] {
  const candidates: [number, number, number][] = []
  for (let y = 1; y < h - 2; y++) {
    for (let x = 1; x < w - 2; x++) {
      const inside = [0, 1, w, w + 1].every(offset => {
        const v = pixels[y * w + x + offset]
        return v !== TRANSPARENT && v !== outline
      })
      if (inside && y < h * 0.72) candidates.push([x, y, hash2(x, y, salt)])
    }
  }
  candidates.sort((a, b) => a[2] - b[2])
  const spots: [number, number][] = []
  for (const [x, y] of candidates) {
    if (spots.length >= count) break
    if (spots.every(([sx, sy]) => Math.abs(sx - x) + Math.abs(sy - y) >= 4)) spots.push([x, y])
  }
  return spots
}

function paintNugget(pixels: Uint32Array, w: number, x: number, y: number, ore: OreTones): void {
  pixels[y * w + x] = color(ore.tones[2])
  pixels[y * w + x + 1] = color(ore.tones[1])
  pixels[(y + 1) * w + x] = color(ore.tones[1])
  pixels[(y + 1) * w + x + 1] = color(ore.tones[0])
}

function rockNode(nodeId: Exclude<MiningNodeId, 'crystal_cluster'>, anchor: RockAnchor, state: NodeArtState, frame: number): PixelArt {
  const recipe = ROCK_RECIPES[anchor]
  const { w, h } = recipe
  const outline = color(recipe.outline)
  const pixels = baseRock(recipe)
  const vein = VEINS[nodeId]
  const salt = MINING_NODE_IDS.indexOf(nodeId) * 97 + w
  const spots = nuggetSpots(pixels, w, h, outline, vein.nuggets, salt)
  const darkest = color(recipe.tones[0])

  if (state === 'ready') {
    if (vein.flecks > 0) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x
          if (pixels[i] === TRANSPARENT || pixels[i] === outline) continue
          if (hash2(x, y, salt + 3) < vein.flecks) pixels[i] = color(vein.ore.tones[y < h * 0.45 ? 1 : 0])
        }
      }
    }
    for (const [x, y] of spots) paintNugget(pixels, w, x, y, vein.ore)
    if (spots[0]) pixels[spots[0][1] * w + spots[0][0]] = color(vein.ore.glint)
    if (nodeId === 'stone_outcrop' && spots[1]) {
      // A chisel line marks worked stone.
      const [x, y] = spots[1]
      for (let d = 0; d < 3; d++) if (x + d + 2 < w) pixels[(y + d) * w + x + d + 2] = outline
    }
    return pixelArt(w, h, pixels, w / 2, h - 1)
  }

  // Depleted: minerals knocked out (dark hollows), top chipped, rubble at the feet.
  for (const [x, y] of spots) {
    pixels[y * w + x] = darkest
    pixels[y * w + x + 1] = darkest
    pixels[(y + 1) * w + x] = outline
  }
  let top = 0
  while (top < h && !pixels.slice(top * w, (top + 1) * w).some(v => v !== TRANSPARENT && v !== outline)) top++
  for (let y = top; y < Math.min(h, top + 2); y++) {
    for (let x = 0; x < w; x++) if (hash2(x, y, salt + 11) < 0.55) pixels[y * w + x] = TRANSPARENT
  }
  reoutline(pixels, w, h, outline)
  const pebble = (x: number, y: number, tone: string) => {
    if (x < 0 || x >= w - 1 || y < 1) return
    if (pixels[y * w + x] !== TRANSPARENT) return
    pixels[y * w + x] = color(tone)
    pixels[(y - 1) * w + x] = outline
    pixels[y * w + x + 1] = outline
  }
  pebble(0, h - 1, recipe.tones[2])
  pebble(w - 3, h - 1, recipe.tones[1])

  if (state === 'respawning') {
    // Specks of mineral regrow in the hollows, one more per frame.
    const shown = Math.max(1, Math.min(spots.length, frame + 1))
    spots.slice(0, shown).forEach(([x, y], index) => {
      pixels[y * w + x] = color(vein.ore.tones[index === shown - 1 ? 1 : 2])
    })
  }
  return pixelArt(w, h, pixels, w / 2, h - 1)
}

function crystalNode(state: NodeArtState, frame: number): PixelArt {
  const { w, h, shards, tones, outline } = CRYSTAL_RECIPE
  const shard = ORE_TONES.shard
  // Snapped shards keep only their bottom part when depleted.
  const cut = state === 'ready' ? 0 : state === 'depleted' ? 0.62 : 0.62 - frame * 0.12
  const fn: ShadeFn = (x, y) => {
    for (const [cx, cy, hw, hh] of shards) {
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      if (Math.abs(dx) / hw + Math.abs(dy) / hh > 1) continue
      if (cut > 0 && y + 0.5 < cy - hh + hh * 2 * cut) continue
      return dx < 0 ? (dy < 0 ? 1 : 0.7) : dy < 0 ? 0.5 : 0.2
    }
    return null
  }
  const pixels = shade(w, h, fn, { tones, outline, dither: 0 })
  if (state === 'ready') {
    // Evolution-shard core: a violet heart in the main shard.
    for (const [x, y, tone] of [[6, 8, 2], [7, 8, 1], [6, 9, 1], [7, 9, 0], [7, 10, 0]] as const) pixels[y * w + x] = color(shard.tones[tone])
    pixels[7 * w + 6] = color(shard.glint)
  }
  // Rubble ring of dull stone around the base keeps depleted crystals readable.
  if (state !== 'ready') {
    for (const [x, y] of [[1, h - 1], [2, h - 1], [11, h - 1], [12, h - 2]] as const) pixels[y * w + x] = color('#80838c')
  }
  return pixelArt(w, h, pixels, 7, 17)
}

/** Art for a mining node on its host anchor. */
export function miningNodeArt(nodeId: MiningNodeId, anchor: MiningAnchor, state: NodeArtState, frame = 0): PixelArt {
  const safeFrame = state === 'respawning' ? Math.max(0, Math.min(RESPAWN_FRAMES - 1, Math.floor(frame))) : 0
  return memo(`${nodeId}|${anchor}|${state}|${safeFrame}`, () => {
    if (nodeId === 'crystal_cluster' || anchor === 'crystal') return crystalNode(state, safeFrame)
    return rockNode(nodeId, anchor, state, safeFrame)
  })
}

export function isMiningNodeId(id: string): id is MiningNodeId {
  return (MINING_NODE_IDS as readonly string[]).includes(id)
}

export function isMiningAnchor(kind: string | null): kind is MiningAnchor {
  return kind === 'rock' || kind === 'boulder' || kind === 'icerock' || kind === 'crystal'
}
