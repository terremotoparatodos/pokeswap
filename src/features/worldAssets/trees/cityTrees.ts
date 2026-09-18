// City tree family — reusable tree assets (DEV contract, not yet production).
//
// The art reference is Ciudad Corazón's forest: three hand-drawn PNGs that
// `TownArea` already stamps on forest terrain, one per aligned 2×2 block
// (areas/townArea.ts → ensureArt). This module turns those exact images into
// individually placeable trees, so a placed tree and a forest tree are the
// same picture, anchored the same way.
//
// Pure data: no DOM, no Vue, no editor. The sprite loader lives next door
// (cityTreeSprites.ts). Nothing in production imports this yet: WildLands'
// procedural trees and TownDef are untouched.
//
// Geometry, in the renderer's own terms (TILE = 16):
//
//   cell (tx, ty)          the tree's 2×2 tile block, top-left tile
//   feet                   ((tx + 1)·16, (ty + 2)·16 − 2): the seam between the
//                          two columns, 2 px above the block's bottom — exactly
//                          where TownArea puts a forest tree (minus its jitter)
//   sprite anchor          (w/2, h−1): the loader's default (engine/sprite.ts)
//   VISUAL footprint       the 2×2 cell the tree owns on the ground
//   COLLISION footprint    the cell's bottom row: roots and trunk sit 4–10 px
//                          above the feet, centred on the seam, so both lower
//                          tiles are blocked and the canopy row stays walkable
//   TAP hitbox             the crown and trunk above the cell columns (32 px
//                          wide), not the flared leaves over neighbour tiles

import type { Tile } from '../../wildlands/engine/pathfinding'
import type { TapHitbox } from '../../wildlands/engine/placedObjects'
import { TILE } from '../../wildlands/engine/world'

export type CityTreeId = 'city-tree-pointed' | 'city-tree-pointed-lit' | 'city-tree-round'

export interface PixelRect {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
}

export interface CityTreeAssetDefinition {
  readonly id: CityTreeId
  readonly label: string
  /** The very PNG the city forest uses (HEARTHOME art.trees). */
  readonly src: string
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
  /** Parts of the art, in sprite pixels (from the PNG, frozen in tests). */
  readonly parts: { readonly trunk: PixelRect; readonly bakedShadow: PixelRect; readonly crown: PixelRect }
  readonly tags: readonly string[]
}

const CELL: readonly Tile[] = [{ tx: 0, ty: 0 }, { tx: 1, ty: 0 }, { tx: 0, ty: 1 }, { tx: 1, ty: 1 }]
const BASE: readonly Tile[] = [{ tx: 0, ty: 1 }, { tx: 1, ty: 1 }]

function tree(
  id: CityTreeId, label: string, file: string, width: number, height: number,
  parts: CityTreeAssetDefinition['parts'], tags: readonly string[],
): CityTreeAssetDefinition {
  return {
    id, label, src: `/assets/town/${file}.png`, width, height,
    anchor: { ax: width / 2, ay: height - 1 },
    visualFootprint: CELL,
    collisionFootprint: BASE,
    // Two cell columns wide; from the feet (row h−1) up to the crown's first row.
    tapHitbox: { width: 2 * TILE, height: height - 1 - parts.crown.y0, offsetX: 0 },
    parts,
    tags,
  }
}

/** The city forest's own variants, in the order HEARTHOME lists them (forest variant index). */
export const CITY_TREE_ASSETS: readonly CityTreeAssetDefinition[] = [
  tree('city-tree-pointed', 'Árbol copa en punta', 'tree-a', 41, 51, {
    trunk: { x0: 10, y0: 40, x1: 30, y1: 46 }, bakedShadow: { x0: 5, y0: 37, x1: 35, y1: 50 }, crown: { x0: 0, y0: 0, x1: 40, y1: 48 },
  }, ['city', 'forest-family', 'crown:pointed']),
  tree('city-tree-pointed-lit', 'Árbol copa en punta · brillos', 'tree-b', 41, 51, {
    trunk: { x0: 10, y0: 40, x1: 30, y1: 46 }, bakedShadow: { x0: 5, y0: 37, x1: 35, y1: 50 }, crown: { x0: 0, y0: 0, x1: 40, y1: 48 },
  }, ['city', 'forest-family', 'crown:pointed', 'highlights']),
  tree('city-tree-round', 'Árbol copa redonda', 'tree-c', 43, 48, {
    trunk: { x0: 12, y0: 38, x1: 30, y1: 42 }, bakedShadow: { x0: 7, y0: 36, x1: 35, y1: 47 }, crown: { x0: 0, y0: 0, x1: 42, y1: 44 },
  }, ['city', 'forest-family', 'crown:round']),
]

/** Not in the city art: a palm needs its own drawing before it can join the family. */
export const FUTURE_CITY_TREES = ['PALM TREE — FUTURE ASSET'] as const

export const CITY_TREE_IDS: readonly CityTreeId[] = CITY_TREE_ASSETS.map(t => t.id)

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
  return CITY_TREE_ASSETS[Math.abs(bx * 7 + by * 13) % CITY_TREE_ASSETS.length].id
}
