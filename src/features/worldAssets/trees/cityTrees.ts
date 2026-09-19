// City tree family — reusable tree assets (DEV contract, not yet production).
//
// The art reference is Ciudad Corazón's forest: the hand-drawn trees of the
// city tileset (public/assets/tilesets/buildings.png) that `TownArea` stamps on
// forest terrain, one per aligned 2×2 block (areas/townArea.ts → ensureArt).
//
// Placed trees use *derived* PNGs (./art, built by
// scripts/build_city_tree_assets.py): the same pixels with the baked ground
// shadow removed, so the ground under them can be drawn per terrain
// (treeGroundBase.ts). The forest keeps its original PNGs, untouched.
// The PNGs are imported, not served from public/: they only reach a build if
// something in it imports this module (today only the DEV lab does).
//
// The family: the three forest trees, two more trees of the same sheet the city
// never used (golden, teal), and three silhouettes spliced from real pixel bands
// of those (tall, slim, wide) — no scaling, hue shifting or mirroring.
//
// Pure data: no DOM, no Vue, no editor. Nothing in production imports this yet.
//
// Geometry, in the renderer's own terms (TILE = 16):
//
//   cell (tx, ty)          the tree's 2×2 tile block, top-left tile
//   feet                   ((tx + 1)·16, (ty + 2)·16 − 2): the seam between the
//                          two columns, 2 px above the block's bottom — exactly
//                          where TownArea puts a forest tree (minus its jitter)
//   sprite anchor          (w/2, h−1): the loader's default (engine/sprite.ts).
//                          Each PNG keeps its source's rows under the roots, so
//                          roots stand exactly as high above the feet as in the forest
//   VISUAL footprint       the 2×2 cell the tree owns on the ground
//   COLLISION footprint    the cell's bottom row (2×1): trunk and roots
//   TAP hitbox             the crown and trunk above the cell columns (32 px
//                          wide), not the flared leaves over neighbour tiles

import type { Tile } from '../../wildlands/engine/pathfinding'
import type { TapHitbox } from '../../wildlands/engine/placedObjects'
import { TILE } from '../../wildlands/engine/world'
import golden from './art/golden.png'
import pointedLit from './art/pointed-lit.png'
import pointedSlim from './art/pointed-slim.png'
import pointedTall from './art/pointed-tall.png'
import pointed from './art/pointed.png'
import roundWide from './art/round-wide.png'
import round from './art/round.png'
import teal from './art/teal.png'

const ART: Record<string, string> = {
  pointed, 'pointed-lit': pointedLit, round, golden, teal, 'pointed-tall': pointedTall, 'pointed-slim': pointedSlim, 'round-wide': roundWide,
}

export type CityTreeId =
  | 'city-tree-pointed' | 'city-tree-pointed-lit' | 'city-tree-round'
  | 'city-tree-golden' | 'city-tree-teal'
  | 'city-tree-pointed-tall' | 'city-tree-pointed-slim' | 'city-tree-round-wide'

/** Where the tree comes from, for review: forest art, same-sheet art, or a splice of those. */
export type CityTreeOrigin = 'forest' | 'sheet' | 'derived'

/** What a tree prefers on grassy ground (treeGroundBase.ts picks the final style per terrain). */
export type GrassBase = 'tufts' | 'roots'

export interface PixelRect {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
}

export interface CityTreeAssetDefinition {
  readonly id: CityTreeId
  readonly label: string
  /** Short name for palettes. */
  readonly short: string
  readonly origin: CityTreeOrigin
  /** The placeable PNG (URL): source pixels without the baked ground shadow. */
  readonly src: string
  /** Its file name in ./art (what the build script writes). */
  readonly file: string
  /** The forest's own PNG this tree matches (forest variants only). */
  readonly forestSrc?: string
  /** Sprite size in pixels, as the PNG is drawn. */
  readonly width: number
  readonly height: number
  /** Feet inside the sprite: the image loader's default anchor. */
  readonly anchor: { readonly ax: number; readonly ay: number }
  /** Tiles, relative to the cell's top-left tile. */
  readonly visualFootprint: readonly Tile[]
  readonly collisionFootprint: readonly Tile[]
  /** Around the feet, in world pixels (same shape the engine's placed objects use). */
  readonly tapHitbox: TapHitbox
  /** Trunk and roots, in sprite pixels (from the PNG, frozen in tests). */
  readonly trunk: PixelRect
  readonly grassBase: GrassBase
  readonly tags: readonly string[]
}

const CELL: readonly Tile[] = [{ tx: 0, ty: 0 }, { tx: 1, ty: 0 }, { tx: 0, ty: 1 }, { tx: 1, ty: 1 }]
const BASE: readonly Tile[] = [{ tx: 0, ty: 1 }, { tx: 1, ty: 1 }]

function tree(
  id: CityTreeId, label: string, short: string, origin: CityTreeOrigin, file: string,
  size: readonly [number, number], trunk: readonly [number, number, number, number],
  grassBase: GrassBase, tags: readonly string[], forestFile?: string,
): CityTreeAssetDefinition {
  const [width, height] = size
  return {
    id, label, short, origin,
    src: ART[file],
    file: `${file}.png`,
    ...(forestFile ? { forestSrc: `/assets/town/${forestFile}.png` } : {}),
    width, height,
    anchor: { ax: width / 2, ay: height - 1 },
    visualFootprint: CELL,
    collisionFootprint: BASE,
    // Two cell columns wide; from the feet (row h−1) up to the top row (the PNGs are cropped to the crown).
    tapHitbox: { width: 2 * TILE, height: height - 1, offsetX: 0 },
    trunk: { x0: trunk[0], y0: trunk[1], x1: trunk[2], y1: trunk[3] },
    grassBase,
    tags,
  }
}

/**
 * The family. The first three are the forest's own variants, in the order
 * HEARTHOME lists them (the forest variant index); sizes and trunk boxes come
 * from scripts/build_city_tree_assets.py and are checked against the PNGs.
 */
export const CITY_TREE_ASSETS: readonly CityTreeAssetDefinition[] = [
  tree('city-tree-pointed', 'Árbol copa en punta', 'Punta', 'forest', 'pointed', [41, 51], [10, 40, 30, 46], 'tufts', ['crown:pointed'], 'tree-a'),
  tree('city-tree-pointed-lit', 'Árbol copa en punta · brillos', 'Punta brillos', 'forest', 'pointed-lit', [41, 51], [10, 40, 30, 46], 'tufts', ['crown:pointed', 'highlights'], 'tree-b'),
  tree('city-tree-round', 'Árbol copa redonda', 'Redondo', 'forest', 'round', [43, 48], [12, 38, 30, 42], 'roots', ['crown:round'], 'tree-c'),
  tree('city-tree-golden', 'Árbol dorado (otoño)', 'Dorado', 'sheet', 'golden', [33, 48], [8, 38, 24, 43], 'roots', ['crown:egg', 'autumn']),
  tree('city-tree-teal', 'Árbol verde azulado', 'Azulado', 'sheet', 'teal', [39, 47], [10, 33, 28, 39], 'roots', ['crown:lobed']),
  tree('city-tree-pointed-tall', 'Árbol copa en punta · alto', 'Punta alto', 'derived', 'pointed-tall', [41, 57], [10, 46, 30, 52], 'tufts', ['crown:pointed', 'tall']),
  tree('city-tree-pointed-slim', 'Árbol copa en punta · angosto', 'Punta angosto', 'derived', 'pointed-slim', [36, 51], [10, 40, 25, 46], 'tufts', ['crown:pointed', 'slim']),
  tree('city-tree-round-wide', 'Árbol copa redonda · ancho', 'Redondo ancho', 'derived', 'round-wide', [49, 48], [12, 38, 36, 42], 'roots', ['crown:round', 'wide']),
]

/** Not in the city art: a palm needs its own drawing before it can join the family. */
export const FUTURE_CITY_TREES = ['PALM TREE — FUTURE ASSET'] as const

export const CITY_TREE_IDS: readonly CityTreeId[] = CITY_TREE_ASSETS.map(t => t.id)

/** The forest's own variants, in forest order (what `forestVariantAt` picks from). */
export const FOREST_TREE_IDS: readonly CityTreeId[] = CITY_TREE_ASSETS.filter(t => t.origin === 'forest').map(t => t.id)

export function isCityTreeId(value: unknown): value is CityTreeId {
  return typeof value === 'string' && (CITY_TREE_IDS as readonly string[]).includes(value)
}

export function cityTree(id: CityTreeId): CityTreeAssetDefinition {
  return CITY_TREE_ASSETS.find(t => t.id === id)!
}

/** World-pixel feet of a tree whose cell starts at (tx, ty): where TownArea puts a forest tree. */
export function treeFeet(tx: number, ty: number): { x: number; y: number } {
  return { x: (tx + 1) * TILE, y: (ty + 2) * TILE - 2 }
}

/** How far above the feet a tree's roots end, in pixels (its ground base centres there). */
export function rootLift(id: CityTreeId): number {
  const t = cityTree(id)
  return t.anchor.ay - t.trunk.y1
}

const offset = (list: readonly Tile[], tx: number, ty: number): Tile[] => list.map(t => ({ tx: tx + t.tx, ty: ty + t.ty }))

export function treeVisualTiles(id: CityTreeId, tx: number, ty: number): Tile[] {
  return offset(cityTree(id).visualFootprint, tx, ty)
}

export function treeCollisionTiles(id: CityTreeId, tx: number, ty: number): Tile[] {
  return offset(cityTree(id).collisionFootprint, tx, ty)
}

/** Sprite bounds around the feet, in world pixels (end-exclusive). */
export function treeSpriteBounds(id: CityTreeId): PixelRect {
  const t = cityTree(id)
  return { x0: -t.anchor.ax, y0: -t.anchor.ay, x1: t.width - t.anchor.ax, y1: t.height - t.anchor.ay }
}

/** Tap hitbox around the feet, in world pixels (end-exclusive). */
export function treeTapBounds(id: CityTreeId): PixelRect {
  const { width, height, offsetX = 0 } = cityTree(id).tapHitbox
  return { x0: offsetX - width / 2, y0: -height, x1: offsetX + width / 2, y1: 0 }
}

/**
 * The forest variant TownArea draws for the 2×2 block at (bx, by) — the same
 * formula as `ensureArt`'s `variant()`, so the lab can say which asset a
 * generated forest tree is.
 */
export function forestVariantAt(bx: number, by: number): CityTreeId {
  return FOREST_TREE_IDS[Math.abs(bx * 7 + by * 13) % FOREST_TREE_IDS.length]
}

/**
 * "Árbol aleatorio": a variant picked from the tile, so the same spot always
 * gives the same tree (editor convenience; the placed tree stores the result).
 */
export function treeVariantForTile(tx: number, ty: number): CityTreeId {
  let h = (Math.imul(tx, 73856093) ^ Math.imul(ty, 19349663)) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0
  return CITY_TREE_IDS[((h ^ (h >>> 15)) >>> 0) % CITY_TREE_IDS.length]
}
