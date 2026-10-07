// Test helpers for the population engine. Fixtures only: the tiles here are
// synthetic test geometry, NOT proposed positions on the real map.

import { ECO_1_ENCOUNTER_CATALOG } from '../encounters/initialCatalog'
import type { EncounterHabitat } from '../encounters/types'
import { PROVISIONAL_IDLE, PROVISIONAL_RESPAWN } from './config'
import { encounterIdParts, nestKey } from './ids'
import type { AreaConfig, AreaGeometry, NestConfig, PopulationConfig, PopulationState, RandomSource, Tile } from './types'

/** mulberry32: seeded, test-local. */
export function seeded(seed: number): RandomSource {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Returns the given numbers in order, then repeats the last one. */
export function scripted(...values: number[]): RandomSource {
  let i = 0
  return () => values[Math.min(i++, values.length - 1)]
}

export const row = (ty: number, from: number, to: number): Tile[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ tx: from + i, ty }))

export function gridGeometry(blocked: readonly Tile[] = []): AreaGeometry {
  const closed = new Set(blocked.map(t => `${t.tx},${t.ty}`))
  return { isOpenTile: (tx, ty) => !closed.has(`${tx},${ty}`) }
}

export const CAVE_HABITATS: readonly EncounterHabitat[] = ['cave-ceiling', 'cave-rocky-floor', 'cave-nook', 'cave-floor', 'cave-damp-corner', 'cave-dry-floor']

export const caveNest = (id: string, tiles: readonly Tile[], over: Partial<NestConfig> = {}): NestConfig => ({
  id, zoneId: 'cueva-inicial', habitats: CAVE_HABITATS, tiles, maxAlive: 3, groupCap: 3,
  respawn: { ...PROVISIONAL_RESPAWN, jitter: 0 }, ...over,
})

export const caveArea = (nests: readonly NestConfig[], over: Partial<AreaConfig> = {}): AreaConfig => ({
  areaId: 'cueva-inicial', maxAlive: 6, idle: PROVISIONAL_IDLE, nests, ...over,
})

export const populationConfig = (areas: readonly AreaConfig[], namespace = 'test-epoch-1'): PopulationConfig => ({ namespace, areas })

export const deps = { catalog: ECO_1_ENCOUNTER_CATALOG }

/**
 * Every invariant the engine promises, checked on a state. Returns the
 * violations (empty = healthy). Used by the tests and by its own negative controls.
 */
export function populationViolations(state: PopulationState, config: PopulationConfig, geometry: (areaId: string) => AreaGeometry | null): string[] {
  const out: string[] = []
  const ids = new Set<string>()
  for (const area of config.areas) {
    const tiles = new Set<string>()
    let areaAlive = 0
    const geo = geometry(area.areaId)
    for (const nest of area.nests) {
      const nestState = state.nests[nestKey(area.areaId, nest.id)]
      areaAlive += nestState.alive.length
      if (nestState.alive.length > nest.maxAlive) out.push(`nest ${nest.id} holds ${nestState.alive.length} > ${nest.maxAlive}`)
      const own = new Set(nest.tiles.map(t => `${t.tx},${t.ty}`))
      for (const encounter of nestState.alive) {
        const key = `${encounter.tile.tx},${encounter.tile.ty}`
        if (ids.has(encounter.id)) out.push(`duplicate id ${encounter.id}`)
        ids.add(encounter.id)
        if (tiles.has(key)) out.push(`two encounters on ${key}`)
        tiles.add(key)
        if (!own.has(key)) out.push(`${encounter.id} outside its nest tiles`)
        if (geo && !geo.isOpenTile(encounter.tile.tx, encounter.tile.ty)) out.push(`${encounter.id} on a blocked tile`)
        const parts = encounterIdParts(encounter.id)
        if (!parts || parts.namespace !== state.namespace) out.push(`${encounter.id} malformed`)
        if (encounter.generation > nestState.generation) out.push(`${encounter.id} from a future generation`)
      }
    }
    if (areaAlive > area.maxAlive) out.push(`area ${area.areaId} holds ${areaAlive} > ${area.maxAlive}`)
    for (const zone of area.zones ?? []) {
      if (zone.maxAlive === undefined) continue
      const inZone = area.nests.filter(n => n.populationZoneId === zone.id).reduce((sum, n) => sum + state.nests[nestKey(area.areaId, n.id)].alive.length, 0)
      if (inZone > zone.maxAlive) out.push(`zone ${zone.id} holds ${inZone} > ${zone.maxAlive}`)
    }
  }
  return out
}
