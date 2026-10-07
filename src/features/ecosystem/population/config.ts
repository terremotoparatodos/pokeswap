// Population configuration: provisional defaults and validation (ECO-2A).
//
// The numbers below are PROVISIONAL starting points taken from
// POKEMON_ECOSYSTEM_1_PROPOSAL.md §B (75 s ± 20 % surface respawn, 5 min to
// dormancy, 5–15 s stagger). They are not approved balance. No nest positions
// are defined here: tiles come from the integration, which owns the map.

import { HABITAT_ZONE_KIND } from '../encounters/validation'
import type { EncounterCatalog, EncounterHabitat } from '../encounters/types'
import type { AreaConfig, IdleConfig, NestConfig, PopulationConfig, RespawnConfig } from './types'

export const PROVISIONAL_RESPAWN: RespawnConfig = { policy: 'per-group', delayMs: 75_000, jitter: 0.2, retryMs: 15_000 }
export const PROVISIONAL_IDLE: IdleConfig = { dormantAfterMs: 5 * 60_000, staggerMinMs: 5_000, staggerMaxMs: 15_000 }

export type PopulationConfigIssueCode =
  | 'invalid-namespace' | 'invalid-id' | 'duplicate-area' | 'duplicate-nest'
  | 'invalid-limit' | 'invalid-respawn' | 'invalid-idle'
  | 'unknown-zone' | 'zone-area-mismatch' | 'unknown-habitat' | 'habitat-without-entries'
  | 'no-tiles' | 'invalid-tile' | 'duplicate-tile'
  | 'duplicate-population-zone' | 'unknown-population-zone'

export interface PopulationConfigIssue {
  readonly code: PopulationConfigIssueCode
  readonly message: string
  readonly areaId?: string
  readonly nestId?: string
}

const ID = /^[A-Za-z0-9._-]+$/
const isInt = (v: unknown, min: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min
const isFiniteIn = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max

export function validatePopulationConfig(config: PopulationConfig, catalog: EncounterCatalog): PopulationConfigIssue[] {
  const issues: PopulationConfigIssue[] = []
  if (typeof config.namespace !== 'string' || !ID.test(config.namespace)) {
    issues.push({ code: 'invalid-namespace', message: `namespace ${String(config.namespace)} must match ${ID}` })
  }
  const areas = new Set<string>()
  for (const area of config.areas) {
    const at = { areaId: area.areaId }
    if (!ID.test(area.areaId)) issues.push({ code: 'invalid-id', message: `area id ${area.areaId}`, ...at })
    if (areas.has(area.areaId)) issues.push({ code: 'duplicate-area', message: `area ${area.areaId} twice`, ...at })
    areas.add(area.areaId)
    if (!isInt(area.maxAlive, 1)) issues.push({ code: 'invalid-limit', message: `area ${area.areaId} maxAlive ${String(area.maxAlive)}`, ...at })
    validateIdle(area, issues)
    const zones = new Set<string>()
    for (const zone of area.zones ?? []) {
      const at = { areaId: area.areaId }
      if (typeof zone.id !== 'string' || !ID.test(zone.id)) issues.push({ code: 'invalid-id', message: `population zone id ${String(zone.id)}`, ...at })
      if (zones.has(zone.id)) issues.push({ code: 'duplicate-population-zone', message: `population zone ${zone.id} twice in ${area.areaId}`, ...at })
      zones.add(zone.id)
      if (zone.maxAlive !== undefined && !isInt(zone.maxAlive, 1)) issues.push({ code: 'invalid-limit', message: `population zone ${zone.id} maxAlive ${String(zone.maxAlive)}`, ...at })
    }
    const nests = new Set<string>()
    for (const nest of area.nests) {
      if (nests.has(nest.id)) issues.push({ code: 'duplicate-nest', message: `nest ${nest.id} twice in ${area.areaId}`, ...at, nestId: nest.id })
      nests.add(nest.id)
      validateNest(area, nest, catalog, issues)
      if (nest.populationZoneId !== undefined && !zones.has(nest.populationZoneId)) {
        issues.push({ code: 'unknown-population-zone', message: `nest ${nest.id} names population zone ${String(nest.populationZoneId)}, not defined in ${area.areaId}`, areaId: area.areaId, nestId: nest.id })
      }
    }
  }
  return issues
}

function validateIdle(area: AreaConfig, issues: PopulationConfigIssue[]): void {
  const { dormantAfterMs, staggerMinMs, staggerMaxMs } = area.idle
  if (!isFiniteIn(dormantAfterMs, 0, Number.MAX_SAFE_INTEGER) || !isFiniteIn(staggerMinMs, 0, Number.MAX_SAFE_INTEGER)
    || !isFiniteIn(staggerMaxMs, staggerMinMs, Number.MAX_SAFE_INTEGER)) {
    issues.push({ code: 'invalid-idle', message: `area ${area.areaId} idle ${JSON.stringify(area.idle)}`, areaId: area.areaId })
  }
}

function validateNest(area: AreaConfig, nest: NestConfig, catalog: EncounterCatalog, issues: PopulationConfigIssue[]): void {
  const at = { areaId: area.areaId, nestId: nest.id }
  const add = (code: PopulationConfigIssueCode, message: string) => issues.push({ code, message, ...at })
  if (!ID.test(nest.id)) add('invalid-id', `nest id ${nest.id}`)
  if (!isInt(nest.maxAlive, 1)) add('invalid-limit', `nest ${nest.id} maxAlive ${String(nest.maxAlive)}`)
  if (!isInt(nest.groupCap, 1)) add('invalid-limit', `nest ${nest.id} groupCap ${String(nest.groupCap)}`)

  const r = nest.respawn
  const respawnOk = (r.policy === 'per-group' || r.policy === 'per-member') && isFiniteIn(r.delayMs, 0, Number.MAX_SAFE_INTEGER)
    && isFiniteIn(r.jitter, 0, 0.5) && isFiniteIn(r.retryMs, 1, Number.MAX_SAFE_INTEGER)
  if (!respawnOk) add('invalid-respawn', `nest ${nest.id} respawn ${JSON.stringify(r)}`)

  const zone = catalog.zones.find(z => z.id === nest.zoneId)
  if (!zone) add('unknown-zone', `nest ${nest.id} names unknown zone ${nest.zoneId}`)
  else if (zone.areaId !== area.areaId) add('zone-area-mismatch', `zone ${zone.id} is in ${zone.areaId}, nest is in ${area.areaId}`)

  if (nest.habitats.length === 0) add('unknown-habitat', `nest ${nest.id} lists no habitat`)
  for (const habitat of nest.habitats) {
    if (!(habitat in HABITAT_ZONE_KIND)) add('unknown-habitat', `nest ${nest.id} habitat ${String(habitat)}`)
    else if (zone && !catalog.entries.some(e => e.zoneId === zone.id && e.habitat === (habitat as EncounterHabitat))) {
      add('habitat-without-entries', `nest ${nest.id}: zone ${zone.id} has no ${habitat} entry`)
    }
  }

  if (nest.tiles.length === 0) add('no-tiles', `nest ${nest.id} has no candidate tile`)
  const seen = new Set<string>()
  for (const tile of nest.tiles) {
    if (!Number.isInteger(tile.tx) || !Number.isInteger(tile.ty)) add('invalid-tile', `nest ${nest.id} tile ${JSON.stringify(tile)}`)
    const key = `${tile.tx},${tile.ty}`
    if (seen.has(key)) add('duplicate-tile', `nest ${nest.id} tile ${key} twice`)
    seen.add(key)
  }
}
