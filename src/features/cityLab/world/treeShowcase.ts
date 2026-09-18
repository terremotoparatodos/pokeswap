// City Mapping Lab — tree comparison scenes (DEV only).
//
// Two small scenes for human visual review, both drawn by the real renderer:
//
//   - a sample town: four bands (grass, plaza, street edge, forest). Each band
//     shows a FOREST GENERATED tree (a 2×2 forest block, exactly as TownArea
//     draws Ciudad Corazón's forest) next to every PLACED city tree asset;
//   - a WildLands preview: the same assets standing on a real procedural
//     world (Pradera Brisa), next to that world's own trees.
//
// Pure: builds data only; the component owns canvases and the frame loop.

import { HEARTHOME } from '../../wildlands/areas/atlas'
import type { TownDef } from '../../wildlands/areas/townArea'
import type { Tile } from '../../wildlands/engine/pathfinding'
import type { OverlayLabel } from '../../wildlands/engine/sceneOverlay'
import { TILE } from '../../wildlands/engine/world'
import { CITY_TREE_ASSETS, forestVariantAt, treeFeet, type CityTreeId } from '../../worldAssets/trees/cityTrees'
import type { PlacedTree } from './labTownArea'

const W = 30
const BAND = 6
const BANDS = [
  { name: 'PASTO', ground: 'g' },
  { name: 'PLAZA', ground: 'p' },
  { name: 'BORDE DE CALLE', ground: 'edge' },
  { name: 'BOSQUE', ground: 't' },
] as const
/**
 * Columns (even, so blocks align like the city's) of three adjacent forest
 * blocks — TownArea's variant formula gives each a different asset — and of
 * each placed asset.
 */
const FOREST_COLS = [2, 4, 6]
const PLACED_COLS = [12, 17, 22]

export interface ShowcaseTown {
  readonly def: TownDef
  readonly trees: readonly PlacedTree[]
  readonly labels: readonly OverlayLabel[]
  /** Centre of the scene in world pixels. */
  readonly centre: { x: number; y: number }
}

export function showcaseTown(): ShowcaseTown {
  const H = 2 + BANDS.length * BAND
  const rows: string[][] = Array.from({ length: H }, () => Array.from({ length: W }, () => 'g'))
  const trees: PlacedTree[] = []
  const labels: OverlayLabel[] = []
  BANDS.forEach((band, i) => {
    const y0 = 2 + i * BAND // even: forest blocks start on even rows
    for (let y = y0 - 1; y < y0 + BAND - 1; y++) {
      for (let x = 0; x < W; x++) {
        if (band.ground === 'edge') rows[y][x] = y >= y0 + 2 ? 's' : 'g' // trunks stand on the curb's grass
        else rows[y][x] = band.ground
      }
    }
    // FOREST GENERATED: 2×2 forest blocks; TownArea turns each into one tree.
    for (const bx of FOREST_COLS) {
      rows[y0][bx] = rows[y0][bx + 1] = rows[y0 + 1][bx] = rows[y0 + 1][bx + 1] = 't'
      labels.push({ wx: (bx + 1) * TILE, wy: (y0 + 2) * TILE, lift: -8, text: `F·${forestVariantAt(bx, y0).replace('city-tree-', '')}`, color: '#b8ffb0' })
    }
    labels.push({ wx: 9.5 * TILE, wy: (y0 + 1) * TILE, lift: 0, text: band.name, color: '#ffffff' })
    CITY_TREE_ASSETS.forEach((asset, j) => {
      const tx = PLACED_COLS[j]
      trees.push({ id: `showcase-${i}-${asset.id}`, kind: asset.id, tx, ty: y0 })
      labels.push({ wx: (tx + 1) * TILE, wy: (y0 + 2) * TILE, lift: -8, text: `P·${asset.id.replace('city-tree-', '')}`, color: '#9fe8ff' })
    })
  })
  const def: TownDef = {
    ...HEARTHOME,
    id: 'city-lab-tree-showcase',
    name: 'Comparación de árboles',
    terrain: rows.map(r => r.join('')),
    buildings: [], fountains: [], props: [], gates: [], residents: [], wanderers: [], plots: [], plazaZones: [],
    spawn: { tx: W - 2, ty: 0, dir: 'down' },
  }
  return { def, trees, labels, centre: { x: (W / 2) * TILE, y: (H / 2) * TILE } }
}

export interface WildShowcaseTree {
  readonly kind: CityTreeId
  readonly x: number
  readonly y: number
}

/**
 * Where the preview stands each asset in a procedural world: a row a few
 * tiles above the world's arrival point, feet computed by the same `treeFeet`
 * the city uses. They are drawn, not added to the world's collision.
 */
export function wildShowcaseTrees(arrival: Tile): WildShowcaseTree[] {
  return CITY_TREE_ASSETS.flatMap((asset, j) => [0, 1].map(k => {
    const feet = treeFeet(arrival.tx - 7 + j * 5 + k * 2, arrival.ty - 5 + k * 4)
    return { kind: asset.id, ...feet }
  }))
}
