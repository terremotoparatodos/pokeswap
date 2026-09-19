// City Mapping Lab — what the palette offers (DEV only).
//
// Only art WildLands already has: the town's street furniture (with its
// hand-drawn PNGs) and the procedural world props. Solidity is never restated
// here — it is asked of the real engine, so the lab can't drift from the game.

import { TownArea } from '../../wildlands/areas/townArea'
import { isSolidDecor, type DecorKind } from '../../wildlands/engine/world'
import { CITY_TREE_ASSETS } from '../../worldAssets/trees/cityTrees'
import { isStreetProp, isTreeProp, STREET_PROP_KINDS, type LabPropKind, type StreetPropKind, type TerrainKind } from './labCity'

const TREE_GROUP = {
  forest: 'Árboles · los del bosque',
  sheet: 'Árboles · mismo tileset',
  derived: 'Árboles · siluetas nuevas',
} as const

/** Palette groups that hold city trees (the palette shows them together, with "Árbol aleatorio"). */
export const TREE_GROUPS: readonly string[] = Object.values(TREE_GROUP)

export interface PaletteEntry {
  readonly kind: LabPropKind
  readonly label: string
  readonly group: string
}

export const PALETTE: readonly PaletteEntry[] = [
  // The city tree family (worldAssets/trees), grouped by where the art comes from.
  ...CITY_TREE_ASSETS.map(t => ({ kind: t.id, label: t.short, group: TREE_GROUP[t.origin] })),
  { kind: 'lamp', label: 'Farol', group: 'Mobiliario urbano' },
  { kind: 'sign', label: 'Cartel', group: 'Mobiliario urbano' },
  { kind: 'hedge', label: 'Seto', group: 'Setos y vallas' },
  { kind: 'fenceH', label: 'Valla ─', group: 'Setos y vallas' },
  { kind: 'fenceV', label: 'Valla │', group: 'Setos y vallas' },
  { kind: 'tree', label: 'Árbol', group: 'Árboles de WildLands (actuales)' },
  { kind: 'pine', label: 'Pino', group: 'Árboles de WildLands (actuales)' },
  { kind: 'snowpine', label: 'Pino nevado', group: 'Árboles de WildLands (actuales)' },
  { kind: 'palm', label: 'Palmera', group: 'Árboles de WildLands (actuales)' },
  { kind: 'bush', label: 'Arbusto', group: 'Vegetación' },
  { kind: 'drybush', label: 'Arbusto seco', group: 'Vegetación' },
  { kind: 'cactus', label: 'Cactus', group: 'Vegetación' },
  { kind: 'coral', label: 'Coral', group: 'Vegetación' },
  { kind: 'rock', label: 'Roca', group: 'Rocas' },
  { kind: 'boulder', label: 'Peñasco', group: 'Rocas' },
  { kind: 'icerock', label: 'Roca de hielo', group: 'Rocas' },
  { kind: 'searock', label: 'Roca marina', group: 'Rocas' },
  { kind: 'crystal', label: 'Cristal', group: 'Cristales' },
  { kind: 'shell', label: 'Caracola', group: 'Decor' },
]

export const TERRAIN_LABEL: Record<TerrainKind, string> = {
  s: 'Calle', g: 'Pasto', p: 'Plaza', t: 'Bosque (sólido)',
}

export function propLabel(kind: LabPropKind): string {
  return PALETTE.find(p => p.kind === kind)?.label ?? kind
}

let streetSolidity: Map<StreetPropKind, boolean> | null = null

/**
 * Whether a prop blocks movement, answered by the engine itself: a street prop
 * is dropped on a one-tile town and `TownArea` is asked; a world prop uses the
 * world's own `isSolidDecor`.
 */
export function isSolidKind(kind: LabPropKind): boolean {
  // A city tree blocks its trunk row (see worldAssets/trees/cityTrees.ts).
  if (isTreeProp(kind)) return true
  if (!isStreetProp(kind)) return isSolidDecor(kind as DecorKind)
  if (!streetSolidity) {
    streetSolidity = new Map()
    for (const k of STREET_PROP_KINDS) {
      const probe = new TownArea({
        id: 'lab-probe', name: 'probe', terrain: ['ggg', 'ggg', 'ggg'], buildings: [], fountains: [],
        props: [{ kind: k, tx: 1, ty: 1 }], gates: [], spawn: { tx: 0, ty: 0, dir: 'down' }, residents: [], wanderers: [],
      })
      streetSolidity.set(k, probe.isSolid(1, 1))
    }
  }
  return streetSolidity.get(kind) ?? true
}
