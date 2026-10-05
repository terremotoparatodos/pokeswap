// Synthetic scenarios for the ecosystem simulator (ECO-PREVIEW-1).
//
// SIMULATION ONLY. The grid, blocked tiles and nest patches below are invented
// for observing the engine; they are not positions on the real map and must
// never be copied into the game. The catalog and engine are the real ones.

import { ECO_1_ENCOUNTER_CATALOG } from '../encounters/initialCatalog'
import type { EncounterHabitat } from '../encounters/types'
import { PROVISIONAL_IDLE, PROVISIONAL_RESPAWN } from '../population/config'
import type { AreaConfig, NestConfig, PopulationConfig, RespawnPolicy, Tile } from '../population/types'

export type PreviewZoneId = 'pradera.abierta' | 'pradera.bosque' | 'cueva-inicial'
export const PREVIEW_ZONES: readonly { readonly id: PreviewZoneId; readonly label: string }[] = [
  { id: 'pradera.abierta', label: 'Pradera abierta' },
  { id: 'pradera.bosque', label: 'Bosque' },
  { id: 'cueva-inicial', label: 'Cueva inicial' },
]

/**
 * 'mixed': every nest hosts every habitat of the zone.
 * 'by-habitat': one nest per habitat — shows that a nest whose habitats have
 * no common entry fails most attempts with `empty-tier` (no redistribution).
 */
export type NestLayout = 'mixed' | 'by-habitat'

/** Every number a reviewer may change; defaults are the provisional ones. */
export interface SimParams {
  readonly policy: RespawnPolicy
  readonly delayMs: number
  readonly jitter: number
  readonly retryMs: number
  readonly dormantAfterMs: number
  readonly staggerMinMs: number
  readonly staggerMaxMs: number
  readonly areaMaxAlive: number
  readonly nestMaxAlive: number
  readonly groupCap: number
}

const AREA_MAX: Record<PreviewZoneId, number> = { 'pradera.abierta': 12, 'pradera.bosque': 8, 'cueva-inicial': 6 }

export function defaultParams(zoneId: PreviewZoneId): SimParams {
  return {
    policy: PROVISIONAL_RESPAWN.policy, delayMs: PROVISIONAL_RESPAWN.delayMs, jitter: PROVISIONAL_RESPAWN.jitter,
    retryMs: PROVISIONAL_RESPAWN.retryMs, dormantAfterMs: PROVISIONAL_IDLE.dormantAfterMs,
    staggerMinMs: PROVISIONAL_IDLE.staggerMinMs, staggerMaxMs: PROVISIONAL_IDLE.staggerMaxMs,
    areaMaxAlive: AREA_MAX[zoneId], nestMaxAlive: 3, groupCap: 3,
  }
}

export const GRID = { width: 18, height: 12 } as const

/** Habitats the catalog actually uses in a zone, in catalog order. */
export function zoneHabitats(zoneId: PreviewZoneId): EncounterHabitat[] {
  return [...new Set(ECO_1_ENCOUNTER_CATALOG.entries.filter(entry => entry.zoneId === zoneId).map(entry => entry.habitat))]
}

/** Synthetic rocks: a fixed pattern, the same for every zone. */
export function blockedTiles(): Tile[] {
  const out: Tile[] = []
  for (let ty = 0; ty < GRID.height; ty++) for (let tx = 0; tx < GRID.width; tx++) if ((tx * 7 + ty * 3) % 11 === 0) out.push({ tx, ty })
  return out
}

/** Patch i of a 3 × 2 layout of 4 × 4 patches. */
function patch(i: number): Tile[] {
  const x0 = 1 + (i % 3) * 6
  const y0 = 1 + Math.floor(i / 3) * 6
  const out: Tile[] = []
  for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) out.push({ tx: x0 + dx, ty: y0 + dy })
  return out
}

export interface Scenario {
  readonly zoneId: PreviewZoneId
  readonly layout: NestLayout
  readonly config: PopulationConfig
  readonly blocked: readonly Tile[]
}

export function buildScenario(zoneId: PreviewZoneId, layout: NestLayout, params: SimParams, seed: number): Scenario {
  const habitats = zoneHabitats(zoneId)
  const groups: EncounterHabitat[][] = layout === 'mixed' ? [habitats, habitats, habitats, habitats] : habitats.map(h => [h])
  const nests: NestConfig[] = groups.slice(0, 6).map((nestHabitats, i) => ({
    id: layout === 'mixed' ? `nido-${i + 1}` : `nido-${nestHabitats[0]}`,
    zoneId, habitats: nestHabitats, tiles: patch(i), maxAlive: params.nestMaxAlive, groupCap: params.groupCap,
    respawn: { policy: params.policy, delayMs: params.delayMs, jitter: params.jitter, retryMs: params.retryMs },
  }))
  const zone = ECO_1_ENCOUNTER_CATALOG.zones.find(z => z.id === zoneId)!
  const area: AreaConfig = {
    areaId: zone.areaId, maxAlive: params.areaMaxAlive, nests,
    idle: { dormantAfterMs: params.dormantAfterMs, staggerMinMs: params.staggerMinMs, staggerMaxMs: params.staggerMaxMs },
  }
  return { zoneId, layout, config: { namespace: `preview-${seed}`, areas: [area] }, blocked: blockedTiles() }
}
