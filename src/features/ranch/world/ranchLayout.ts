// Ranch layout — Rancho
//
// The designed composition, as data. Coordinates are tiles (16 px); shapes use
// continuous tile space, so a point at x + 0.5 is the centre of column x.
//
//                 N
//     ┌───────────────────────────────┐
//     │ Bosque        Rocas      Lago │   forest belt all around
//     │  (claro)                (isla)│
//     │ Jardín     Casa · Plaza  muelle│
//     │  huerta        │     Granero  │
//     │ Descanso     Prado    Corrales │
//     │ (fogón)        │               │
//     └──────────── Arco ─────────────┘
//                 S (entrada)
//
// Everything else (terrain, decor, solidity, zones, slots) is derived from
// this file by ranchMap.ts, so moving a feature here moves it everywhere.

import type { ZoneId } from '../domain/zones'

export const MAP_W = 120
export const MAP_H = 90

export interface Pt {
  x: number
  y: number
}
export interface TileRect {
  x0: number
  y0: number
  x1: number
  y1: number
}
export interface Ellipse {
  cx: number
  cy: number
  rx: number
  ry: number
}

/** Inside this rounded rectangle is the ranch; outside is the forest belt. */
export const INTERIOR = { x0: 4, y0: 4, x1: 116, y1: 86, radius: 10 }
/** Opening in the southern forest for the entrance path. */
export const ENTRANCE: TileRect = { x0: 55, y0: 78, x1: 66, y1: MAP_H }

export interface PathDef {
  points: Pt[]
  /** Half width in tiles. */
  half: number
}

export const PATHS: PathDef[] = [
  // Entrance → plaza
  { points: [{ x: 60.5, y: 92 }, { x: 60.5, y: 55 }], half: 1.5 },
  // Plaza → house door
  { points: [{ x: 60.5, y: 51 }, { x: 60.5, y: 47 }], half: 1 },
  // West: plaza → garden
  { points: [{ x: 56, y: 52.5 }, { x: 46, y: 53 }, { x: 38, y: 52 }, { x: 30, y: 51.5 }, { x: 7, y: 51.5 }], half: 1.1 },
  // Garden → rest area
  { points: [{ x: 38, y: 52.5 }, { x: 35, y: 60 }, { x: 31, y: 67 }, { x: 26, y: 72.5 }], half: 1 },
  // Garden → forest clearing
  { points: [{ x: 36, y: 52 }, { x: 32.5, y: 44 }, { x: 27.5, y: 37 }, { x: 24, y: 30 }], half: 1 },
  // East: plaza → barn → corrals
  { points: [{ x: 65, y: 52.5 }, { x: 76, y: 53 }, { x: 84, y: 55.5 }, { x: 88.5, y: 58 }, { x: 88.5, y: 84 }], half: 1.1 },
  { points: [{ x: 88.5, y: 56.5 }, { x: 101, y: 56.5 }], half: 1 },
  { points: [{ x: 88.5, y: 68.5 }, { x: 102.5, y: 68.5 }, { x: 102.5, y: 62.5 }, { x: 104.5, y: 62.5 }], half: 1 },
  { points: [{ x: 102.5, y: 68.5 }, { x: 102.5, y: 70.5 }], half: 1 },
  { points: [{ x: 88.5, y: 62.5 }, { x: 91.5, y: 62.5 }], half: 0.9 },
  // North-east: plaza → lake beach
  { points: [{ x: 63, y: 49 }, { x: 70, y: 45 }, { x: 78, y: 40.5 }, { x: 84.5, y: 37.5 }], half: 1 },
  // North: plaza → rocks
  { points: [{ x: 56, y: 49.5 }, { x: 53.5, y: 45 }, { x: 53.5, y: 36 }, { x: 56, y: 28 }, { x: 59, y: 19 }], half: 1 },
]

export const PLAZA = { x: 60.5, y: 51.5, r: 4.4 }
export const FOREST_CLEARING = { x: 22.5, y: 26.5, r: 4 }
export const CAMPFIRE_CLEARING = { x: 23.5, y: 76.5, r: 3.2 }

export const LAKE: Ellipse = { cx: 94, cy: 25, rx: 15, ry: 9.5 }
export const ISLAND = { x: 99.5, y: 22.5, r: 2 }
export const POND: Ellipse = { cx: 12.5, cy: 76.5, rx: 4.2, ry: 3.2 }

/** Wooden paddocks: perimeter fences with gate gaps (tiles left open). */
export interface Paddock extends TileRect {
  gates: Pt[]
}
export const PADDOCKS: Paddock[] = [
  { x0: 91, y0: 58, x1: 101, y1: 66, gates: [{ x: 91, y: 62 }] },
  { x0: 104, y0: 58, x1: 114, y1: 66, gates: [{ x: 104, y: 62 }] },
  { x0: 91, y0: 70, x1: 114, y1: 82, gates: [{ x: 102, y: 70 }, { x: 103, y: 70 }] },
]

export type PropKind =
  | 'house' | 'barn' | 'arch' | 'well' | 'mailbox' | 'signpost' | 'lamp' | 'bench'
  | 'hay' | 'hayStack' | 'trough' | 'berry' | 'sunflower' | 'scarecrow' | 'campfire'
  | 'log' | 'crate' | 'reeds' | 'flowerpot' | 'basket'

export interface PropDef {
  kind: PropKind
  /** Footprint in tiles; the sprite stands on its bottom edge, centred. */
  at: TileRect
  variant?: number
  /** Decorative only: does not block movement. */
  walkable?: boolean
  /** Tiles that block, when not the whole footprint (the arch blocks only its posts). */
  solid?: Pt[]
}

const one = (kind: PropKind, x: number, y: number, variant?: number): PropDef => ({ kind, at: { x0: x, y0: y, x1: x, y1: y }, variant })
/** Benches stand upright along paths and take two tiles. */
const bench = (x: number, y: number): PropDef => ({ kind: 'bench', at: { x0: x, y0: y - 1, x1: x, y1: y } })

export const PROPS: PropDef[] = [
  // Casa
  { kind: 'house', at: { x0: 58, y0: 42, x1: 62, y1: 45 } },
  one('mailbox', 63, 45),
  one('flowerpot', 57, 45, 0),
  one('flowerpot', 64, 46, 1),
  one('well', 66, 49),
  one('signpost', 57, 57),
  bench(66, 56),
  one('lamp', 55, 55),
  one('lamp', 64, 57),
  // Entrance
  { kind: 'arch', at: { x0: 57, y0: 84, x1: 63, y1: 84 }, solid: [{ x: 57, y: 84 }, { x: 63, y: 84 }] },
  // Granero y corrales
  { kind: 'barn', at: { x0: 95, y0: 51, x1: 100, y1: 54 } },
  { kind: 'hayStack', at: { x0: 92, y0: 54, x1: 93, y1: 54 } },
  one('crate', 102, 54),
  one('crate', 103, 54, 1),
  one('hay', 94, 60), one('hay', 95, 60), one('hay', 99, 64),
  { kind: 'trough', at: { x0: 97, y0: 64, x1: 98, y1: 64 } },
  { kind: 'trough', at: { x0: 107, y0: 60, x1: 108, y1: 60 } },
  one('hay', 112, 64),
  one('hay', 94, 73), one('hay', 95, 73), one('hay', 110, 80),
  { kind: 'trough', at: { x0: 104, y0: 77, x1: 105, y1: 77 } },
  // Jardín: sunflowers along the beds, berry rows and a scarecrow
  one('sunflower', 7, 44), one('sunflower', 14, 44), one('sunflower', 21, 44), one('sunflower', 28, 44),
  one('berry', 9, 60, 0), one('berry', 11, 60, 1), one('berry', 13, 60, 2), one('berry', 15, 60, 3),
  one('berry', 17, 60, 0), one('berry', 19, 60, 1),
  one('scarecrow', 23, 60),
  one('lamp', 37, 49),
  // Descanso
  one('campfire', 23, 76),
  { kind: 'log', at: { x0: 20, y0: 76, x1: 20, y1: 76 }, variant: 1 },
  { kind: 'log', at: { x0: 26, y0: 76, x1: 26, y1: 76 }, variant: 1 },
  { kind: 'log', at: { x0: 23, y0: 79, x1: 23, y1: 79 }, variant: 0 },
  bench(31, 71),
  bench(36, 64),
  one('lamp', 25, 70),
  one('signpost', 38, 57),
  one('basket', 38, 78),
  // Lake shore
  one('signpost', 82, 40),
]

export type DecalKind = 'flowerBed' | 'soil' | 'dock' | 'blanket' | 'mosaic' | 'boat' | 'doormat' | 'stones'

export interface DecalDef {
  kind: DecalKind
  at: TileRect
  variant?: number
}

export const DECALS: DecalDef[] = [
  { kind: 'mosaic', at: { x0: 59, y0: 50, x1: 61, y1: 52 } },
  { kind: 'doormat', at: { x0: 60, y0: 46, x1: 60, y1: 46 } },
  // Flower beds, two rows either side of the garden path
  { kind: 'flowerBed', at: { x0: 8, y0: 46, x1: 12, y1: 48 }, variant: 0 },
  { kind: 'flowerBed', at: { x0: 15, y0: 46, x1: 19, y1: 48 }, variant: 1 },
  { kind: 'flowerBed', at: { x0: 22, y0: 46, x1: 26, y1: 48 }, variant: 2 },
  { kind: 'flowerBed', at: { x0: 8, y0: 55, x1: 12, y1: 57 }, variant: 3 },
  { kind: 'flowerBed', at: { x0: 15, y0: 55, x1: 19, y1: 57 }, variant: 4 },
  { kind: 'flowerBed', at: { x0: 22, y0: 55, x1: 26, y1: 57 }, variant: 5 },
  { kind: 'soil', at: { x0: 8, y0: 59, x1: 20, y1: 61 } },
  { kind: 'stones', at: { x0: 13, y0: 49, x1: 13, y1: 49 } },
  { kind: 'stones', at: { x0: 20, y0: 53, x1: 20, y1: 53 } },
  // Lake: dock and a rowboat
  { kind: 'dock', at: { x0: 86, y0: 29, x1: 87, y1: 34 } },
  { kind: 'boat', at: { x0: 88, y0: 30, x1: 89, y1: 31 } },
  // Picnic
  { kind: 'blanket', at: { x0: 36, y0: 77, x1: 37, y1: 78 } },
]

/** Round trees placed by hand in the open areas (decor 'tree'). */
export const ACCENT_TREES: Pt[] = [
  { x: 46, y: 63 }, { x: 73, y: 70 }, { x: 44, y: 80 }, { x: 79, y: 61 }, { x: 70, y: 79 },
  { x: 34, y: 74 }, { x: 16, y: 69 }, { x: 40, y: 67 }, { x: 33, y: 57 }, { x: 70, y: 37 },
  { x: 48, y: 42 }, { x: 74, y: 49 }, { x: 99, y: 22 }, { x: 81, y: 46 },
]
/** Round bushes placed by hand (decor 'bush'). */
export const ACCENT_BUSHES: Pt[] = [
  { x: 52, y: 60 }, { x: 53, y: 60 }, { x: 68, y: 75 }, { x: 69, y: 75 }, { x: 56, y: 44 }, { x: 65, y: 44 },
  { x: 47, y: 72 }, { x: 77, y: 58 }, { x: 36, y: 66 }, { x: 10, y: 66 }, { x: 18, y: 81 }, { x: 81, y: 41 },
]

/** Where each zone gathers first: slots fill outward from here. */
export const ZONE_FOCUS: Record<ZoneId, Pt> = {
  casa: { x: 66, y: 46 },
  prado: { x: 53, y: 65 },
  lago: { x: 85, y: 35 },
  bosque: { x: 22, y: 27 },
  flores: { x: 17, y: 51 },
  rocas: { x: 58, y: 17 },
  corrales: { x: 96, y: 62 },
  descanso: { x: 25, y: 74 },
}

/** Zone regions, first match wins (paddock interiors are handled separately). */
export const ZONE_REGIONS: [ZoneId, TileRect][] = [
  ['casa', { x0: 46, y0: 38, x1: 76, y1: 52 }],
  ['flores', { x0: 4, y0: 42, x1: 37, y1: 63 }],
  ['descanso', { x0: 4, y0: 64, x1: 45, y1: 87 }],
  ['bosque', { x0: 4, y0: 4, x1: 40, y1: 41 }],
  ['rocas', { x0: 41, y0: 4, x1: 76, y1: 37 }],
]
/** The lake zone is the shore ring around it (normalized ellipse distance). */
export const LAKE_ZONE_REACH = 1.9

/** Map labels shown in the overview. */
export const ZONE_LABELS: Record<ZoneId, Pt> = {
  casa: { x: 60.5, y: 39 },
  prado: { x: 60, y: 70 },
  lago: { x: 94, y: 25 },
  bosque: { x: 22, y: 20 },
  flores: { x: 18, y: 51 },
  rocas: { x: 58, y: 12 },
  corrales: { x: 102.5, y: 75 },
  descanso: { x: 24, y: 72 },
}
