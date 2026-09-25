// View-models for the Agricultura card (INTEGRATION-1). Pure: the numbers come
// from the SKILLS catalogs and formulas the server uses to authorize, so what
// the card shows is what the server will say. The server still decides.

import { resolveAptitude } from '../domain/aptitude/aptitude'
import { speciesDisplayName } from '../domain/aptitude/speciesFacts'
import type { Aptitude } from '../domain/aptitude/aptitudeScale'
import { CROPS, CROP_BY_ID, FARM_ACTION_MS, type CropDefinition, type FarmAction, type PlotKind } from '../domain/farming'
import { workDuration } from '../domain/workRules'
import type { WorkerRef } from './workerRef'

export type PlotStageName = 'empty' | 'planted' | 'growing' | 'ready' | 'working'

export const FARM_VERB: Readonly<Record<FarmAction, string>> = { plant: 'Plantar', tend: 'Cuidar', harvest: 'Cosechar' }

export const STAGE_LINE: Readonly<Record<PlotStageName, string>> = {
  empty: 'Parcela libre', planted: 'Recién plantada', growing: 'Creciendo', ready: '¡Lista para cosechar!', working: 'Alguien está trabajando acá',
}

export interface CropOption {
  readonly crop: CropDefinition
  readonly locked: boolean
  readonly line: string
}

/** What can go in this plot at this level: the huerta's crops, locked ones saying why. */
export function cropOptions(plotKind: PlotKind, farmingLevel: number): readonly CropOption[] {
  return CROPS.filter(crop => crop.plotKinds.includes(plotKind)).map(crop => ({
    crop, locked: farmingLevel < crop.requiredLevel,
    line: farmingLevel < crop.requiredLevel ? `Requiere Agricultura ${crop.requiredLevel}` : `Crece en ${Math.round(crop.growMs / 60_000 * 10) / 10} min`,
  }))
}

export interface FarmWorkerOption {
  readonly instanceId: string
  readonly speciesId: number
  readonly name: string
  readonly aptitude: Aptitude
  readonly unable: boolean
  readonly seconds: number
}

export function farmWorkerOptions(workers: readonly WorkerRef[], action: FarmAction, cropId: string | null, farmingLevel: number): readonly FarmWorkerOption[] {
  const minAptitude = (cropId ? CROP_BY_ID.get(cropId)?.minAptitude : 1) ?? 1
  return workers
    .map((worker, index) => {
      const aptitude = resolveAptitude(worker.speciesId, 'farming').value
      return {
        index,
        option: {
          instanceId: worker.instanceId, speciesId: worker.speciesId, name: speciesDisplayName(worker.speciesId), aptitude,
          unable: aptitude < minAptitude, seconds: Math.round(workDuration(FARM_ACTION_MS[action], aptitude, farmingLevel) / 100) / 10,
        },
      }
    })
    .sort((a, b) => b.option.aptitude - a.option.aptitude || a.index - b.index)
    .map(entry => entry.option)
}

/** "vuelve en 1 min 20 s" — the time left until a crop is ready. */
export function timeLeft(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  return seconds % 60 ? `${minutes} min ${seconds % 60} s` : `${minutes} min`
}
