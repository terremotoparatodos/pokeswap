// Agricultura: crops and the plot lifecycle, 1–50.
//
// Farming is not "mining with plants": its reward is split over time. A
// Pokémon plants (small XP), may tend once while it grows (small XP, +1 unit
// at harvest), and harvests when the plot is ready (the big XP and the
// items). While a plot grows the player is free to chop or mine, which is
// the whole point of the skill. Because the waiting is the cost, one harvest
// is worth many gathering actions: XP per cycle is sized so four plots keep
// pace with active gathering (scripts/skills/pacing.ts).
//
//   EMPTY ──plant──▶ PLANTED ──(time)──▶ GROWING ──(time)──▶ READY ──harvest──▶ EMPTY
//                       └──────── tend (once) ────────┘
//
// WORLD owns the plot: its stage, its timer, whether it was tended. Skills
// owns which transitions an action may request and what each one is worth.
// "Preparar" is folded into planting: the Pokémon turns the soil and sows in
// one action. A separate prepare step added a click, not a decision.

import type { Aptitude } from './aptitude/aptitudeScale'
import type { MaterialId } from './materials'

export type CropId = 'oran' | 'medicinal' | 'leppa' | 'sitrus' | 'revival'

export const PLOT_STAGES = ['EMPTY', 'PLANTED', 'GROWING', 'READY'] as const
export type PlotStage = (typeof PLOT_STAGES)[number]

/** `town`: the huerta comunal. `fertile`: wild soil further out, needed by the best crops. */
export type PlotKind = 'town' | 'fertile'

export type FarmAction = 'plant' | 'tend' | 'harvest'

export interface CropDefinition {
  readonly id: CropId
  readonly name: string
  readonly requiredLevel: number
  readonly minAptitude: Aptitude
  readonly plotKinds: readonly PlotKind[]
  /** From planting to READY. WORLD runs the clock; this is the rule it runs. */
  readonly growMs: number
  readonly xp: { readonly plant: number; readonly tend: number; readonly harvest: number }
  readonly harvest: { readonly itemId: MaterialId; readonly min: number; readonly max: number }
}

/** Base duration of each farm action for an aptitude-3 worker with no Ritmo. */
export const FARM_ACTION_MS: Readonly<Record<FarmAction, number>> = { plant: 3000, tend: 2000, harvest: 2600 }

/** Units a tended crop adds at harvest. */
export const TEND_BONUS_UNITS = 1

const MIN = 60_000

export const CROPS: readonly CropDefinition[] = [
  {
    id: 'oran', name: 'Baya Aranja', requiredLevel: 1, minAptitude: 1, plotKinds: ['town', 'fertile'],
    growMs: 1.5 * MIN, xp: { plant: 8, tend: 4, harvest: 25 }, harvest: { itemId: 'oran_berry', min: 2, max: 3 },
  },
  {
    id: 'medicinal', name: 'Hierba medicinal', requiredLevel: 10, minAptitude: 1, plotKinds: ['town', 'fertile'],
    growMs: 3 * MIN, xp: { plant: 25, tend: 12, harvest: 100 }, harvest: { itemId: 'medicinal_herb', min: 2, max: 3 },
  },
  {
    id: 'leppa', name: 'Baya Zanama', requiredLevel: 20, minAptitude: 1, plotKinds: ['town', 'fertile'],
    growMs: 5 * MIN, xp: { plant: 60, tend: 30, harvest: 240 }, harvest: { itemId: 'leppa_berry', min: 2, max: 4 },
  },
  {
    id: 'sitrus', name: 'Baya Zidra', requiredLevel: 30, minAptitude: 1, plotKinds: ['fertile'],
    growMs: 8 * MIN, xp: { plant: 140, tend: 70, harvest: 550 }, harvest: { itemId: 'sitrus_berry', min: 2, max: 4 },
  },
  {
    id: 'revival', name: 'Hierba Revivir', requiredLevel: 42, minAptitude: 2, plotKinds: ['fertile'],
    growMs: 12 * MIN, xp: { plant: 280, tend: 130, harvest: 1120 }, harvest: { itemId: 'revival_herb', min: 1, max: 2 },
  },
]

export const CROP_BY_ID: ReadonlyMap<string, CropDefinition> = new Map(CROPS.map(entry => [entry.id, entry]))

/** Advisory for WORLD-1: where plots should be. */
export const PLOT_WORLD_HINTS: Readonly<Record<PlotKind, { readonly where: string; readonly perPlayer: number }>> = {
  town: { where: 'Huerta comunal de Ciudad Corazón, junto a la salida a Pradera Brisa', perPlayer: 4 },
  fertile: { where: 'Claros de tierra fértil en Bosque Umbrío (anillo 1+) y Costa Coral', perPlayer: 4 },
}

/** What the plot has to look like for an action to make sense. WORLD reports it; Skills checks it. */
export interface PlotSnapshot {
  readonly plotId: string
  readonly kind: PlotKind
  readonly stage: PlotStage
  /** Set from PLANTED onwards. */
  readonly cropId: CropId | null
  readonly tended: boolean
}

export type PlotRejection = 'plot_not_empty' | 'plot_not_growing' | 'plot_not_ready' | 'already_tended' | 'wrong_plot_kind' | 'unknown_crop'

/** Whether `action` is a legal transition from the reported plot. Pure; changes nothing. */
export function checkPlotTransition(action: FarmAction, plot: PlotSnapshot, cropId: CropId | null): PlotRejection | null {
  switch (action) {
    case 'plant': {
      if (plot.stage !== 'EMPTY') return 'plot_not_empty'
      const crop = cropId ? CROP_BY_ID.get(cropId) : undefined
      if (!crop) return 'unknown_crop'
      return crop.plotKinds.includes(plot.kind) ? null : 'wrong_plot_kind'
    }
    case 'tend':
      if (plot.stage !== 'PLANTED' && plot.stage !== 'GROWING') return 'plot_not_growing'
      if (!plot.cropId || !CROP_BY_ID.has(plot.cropId)) return 'unknown_crop'
      return plot.tended ? 'already_tended' : null
    case 'harvest':
      if (plot.stage !== 'READY') return 'plot_not_ready'
      return plot.cropId && CROP_BY_ID.has(plot.cropId) ? null : 'unknown_crop'
  }
}
