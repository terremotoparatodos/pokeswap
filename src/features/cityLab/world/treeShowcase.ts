// City Mapping Lab — tree comparison scenes (DEV only).
//
// Small scenes for human visual review, all drawn by the real renderer with
// the real `LabTownArea` (so ground bases, collision and depth are the lab's):
//
//   - TERRAINS: bands of city grass, plaza, street edge and forest. Each band
//     shows three FOREST GENERATED trees (2×2 forest blocks, exactly as
//     TownArea draws Ciudad Corazón's forest) next to every PLACED variant;
//   - GROUPS: the patterns a city is made of — a row along a street, a garden,
//     a small wood and a lone plaza tree — with variants picked the way
//     "Árbol aleatorio" picks them;
//   - WILDLANDS: the same assets standing on a real procedural world
//     (Pradera Brisa), next to that world's own trees.
//
// Pure: builds data only; the component owns canvases and the frame loop.

import { HEARTHOME } from '../../wildlands/areas/atlas'
import type { TownDef } from '../../wildlands/areas/townArea'
import type { Tile } from '../../wildlands/engine/pathfinding'
import type { OverlayLabel } from '../../wildlands/engine/sceneOverlay'
import { TILE } from '../../wildlands/engine/world'
import { CITY_TREE_ASSETS, forestVariantAt, treeVariantForTile, type CityTreeId } from '../../worldAssets/trees/cityTrees'
import type { PlacedTree } from './labTownArea'

export interface ShowcaseTown {
  readonly def: TownDef
  readonly trees: readonly PlacedTree[]
  readonly labels: readonly OverlayLabel[]
  /** Centre of the scene in world pixels. */
  readonly centre: { x: number; y: number }
}

const short = (id: CityTreeId) => id.replace('city-tree-', '')

function townOf(id: string, rows: string[][], trees: PlacedTree[], labels: OverlayLabel[]): ShowcaseTown {
  const H = rows.length
  const W = rows[0].length
  const def: TownDef = {
    ...HEARTHOME,
    id,
    name: 'Comparación de árboles',
    terrain: rows.map(r => r.join('')),
    buildings: [], fountains: [], props: [], gates: [], residents: [], wanderers: [], plots: [], plazaZones: [],
    spawn: { tx: W - 1, ty: 0, dir: 'down' },
  }
  return { def, trees, labels, centre: { x: (W / 2) * TILE, y: (H / 2) * TILE } }
}

const BAND = 6
const BANDS = [
  { name: 'PASTO', ground: 'g' },
  { name: 'PLAZA', ground: 'p' },
  { name: 'BORDE DE CALLE', ground: 'edge' },
  { name: 'BOSQUE', ground: 't' },
] as const
/** Three adjacent forest blocks on even columns: TownArea's formula gives each a different variant. */
const FOREST_COLS = [2, 4, 6]
const PLACED_COL0 = 11
const PLACED_STEP = 3

/** Every placed variant next to the forest's own trees, on each kind of city ground. */
export function showcaseTown(): ShowcaseTown {
  const W = PLACED_COL0 + CITY_TREE_ASSETS.length * PLACED_STEP + 1
  const H = 2 + BANDS.length * BAND
  const rows: string[][] = Array.from({ length: H }, () => Array.from({ length: W }, () => 'g'))
  const trees: PlacedTree[] = []
  const labels: OverlayLabel[] = []
  BANDS.forEach((band, i) => {
    const y0 = 2 + i * BAND // even: forest blocks start on even rows
    for (let y = y0 - 1; y < y0 + BAND - 1; y++) {
      for (let x = 0; x < W; x++) rows[y][x] = band.ground === 'edge' ? (y >= y0 + 2 ? 's' : 'g') : band.ground
    }
    for (const bx of FOREST_COLS) {
      rows[y0][bx] = rows[y0][bx + 1] = rows[y0 + 1][bx] = rows[y0 + 1][bx + 1] = 't'
      labels.push({ wx: (bx + 1) * TILE, wy: (y0 + 2) * TILE, lift: -8, text: `F·${short(forestVariantAt(bx, y0))}`, color: '#b8ffb0' })
    }
    labels.push({ wx: 9 * TILE, wy: (y0 - 1) * TILE, lift: -10, text: band.name, color: '#ffffff' })
    CITY_TREE_ASSETS.forEach((asset, j) => {
      const tx = PLACED_COL0 + j * PLACED_STEP
      trees.push({ id: `showcase-${i}-${asset.id}`, kind: asset.id, tx, ty: y0 })
      labels.push({ wx: (tx + 1) * TILE, wy: (y0 + 2) * TILE, lift: -8, text: short(asset.id), color: '#9fe8ff' })
    })
  })
  return townOf('city-lab-tree-terrains', rows, trees, labels)
}

/** Patterns: a street lined with trees, a garden, a small wood, a lone plaza tree. */
export function showcaseGroups(): ShowcaseTown {
  const W = 40
  const H = 26
  const rows: string[][] = Array.from({ length: H }, () => Array.from({ length: W }, () => 'g'))
  const trees: PlacedTree[] = []
  const labels: OverlayLabel[] = []
  const place = (tx: number, ty: number, kind?: CityTreeId) =>
    trees.push({ id: `group-${tx}-${ty}`, kind: kind ?? treeVariantForTile(tx, ty), tx, ty })
  const fill = (x0: number, y0: number, x1: number, y1: number, c: string) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) rows[y][x] = c
  }

  // LINEAL: a street with a tree every 3 tiles on its upper curb.
  fill(0, 5, W - 1, 7, 's')
  for (let tx = 1; tx < W - 2; tx += 3) place(tx, 3)
  labels.push({ wx: 3 * TILE, wy: 2 * TILE, lift: 0, text: 'LINEAL', color: '#ffffff' })

  // JARDÍN: four trees whose crowns overlap, around a small lawn.
  for (const [tx, ty] of [[3, 11], [5, 10], [7, 11], [5, 12]] as const) place(tx, ty)
  labels.push({ wx: 6 * TILE, wy: 9 * TILE, lift: 0, text: 'JARDÍN', color: '#ffffff' })

  // BOSQUE PEQUEÑO: a dozen trees, staggered rows, trunks never touching.
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if ((r + c) % 3 !== 2) place(15 + c * 3 + (r % 2), 10 + r * 3)
  labels.push({ wx: 20 * TILE, wy: 9 * TILE, lift: 0, text: 'BOSQUE PEQUEÑO', color: '#ffffff' })

  // PLAZA: one tree alone on paving.
  fill(30, 10, 38, 18, 'p')
  place(33, 13, 'city-tree-round')
  labels.push({ wx: 34 * TILE, wy: 10 * TILE, lift: 0, text: 'PLAZA', color: '#ffffff' })

  // The same pattern next to the forest's own edge, for comparison.
  fill(0, 20, 11, 25, 't')
  place(13, 20)
  place(16, 21)
  labels.push({ wx: 8 * TILE, wy: 19 * TILE, lift: 0, text: 'BORDE DE BOSQUE', color: '#ffffff' })

  return townOf('city-lab-tree-groups', rows, trees, labels)
}

export interface WildShowcaseTree {
  readonly kind: CityTreeId
  /** The tree's 2×2 cell, like a placed tree in the city. */
  readonly tx: number
  readonly ty: number
}

/**
 * Where the preview stands the assets in a procedural world: every variant in
 * a row above the arrival point, and a small mixed group below it. They are
 * drawn (sprite + ground base), not added to the world or its collision.
 */
export function wildShowcaseTrees(arrival: Tile): WildShowcaseTree[] {
  const row = CITY_TREE_ASSETS.map((asset, j) => ({ kind: asset.id, tx: arrival.tx - 12 + j * 3, ty: arrival.ty - 6 }))
  const group = [[-4, 3], [-2, 2], [0, 4], [2, 3], [4, 2]].map(([dx, dy]) => {
    const tx = arrival.tx + dx
    const ty = arrival.ty + dy
    return { kind: treeVariantForTile(tx, ty), tx, ty }
  })
  return [...row, ...group]
}
