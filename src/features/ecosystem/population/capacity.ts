// Capacity diagnostics (ECO-CAPACITY-1). Pure.
//
// Maxima are not reservations. A zone maximum caps that zone; it never keeps
// room free for another zone. Whether a zone can always get N encounters
// depends on the arithmetic below, and even then only NUMERICALLY: tiles,
// geometry and the pool can still prevent a spawn.

import type { AreaConfig, SpawnFailure } from './types'

export type FailureCategory = 'nest-limit' | 'zone-limit' | 'area-limit' | 'group-room' | 'geometry' | 'pool'

const CATEGORY: Readonly<Record<SpawnFailure, FailureCategory>> = {
  'nest-full': 'nest-limit', 'zone-full': 'zone-limit', 'area-full': 'area-limit', 'no-room-for-group': 'group-room',
  'no-open-tile': 'geometry', 'no-geometry': 'geometry',
  'empty-tier': 'pool', 'invalid-distribution': 'pool', 'unknown-zone': 'pool',
}

export const spawnFailureCategory = (reason: SpawnFailure): FailureCategory => CATEGORY[reason]

export interface ZoneCapacity {
  readonly zoneId: string | null
  /** The zone's own maximum, or null when it has none. */
  readonly max: number | null
  /** Σ maxAlive of its nests: more than this can never be alive, whatever the zone max. */
  readonly nestTotal: number
  /** min(zone max, nest total): the most this zone can ever hold numerically. */
  readonly ceiling: number
  /**
   * Room this zone keeps numerically even if every OTHER zone (and zone-less nest)
   * is at its ceiling: max(0, area max − Σ other ceilings), capped by its own ceiling.
   * A number, not a promise of free tiles.
   */
  readonly guaranteed: number
}

export interface CapacityReport {
  readonly areaId: string
  readonly areaMax: number
  readonly zones: readonly ZoneCapacity[]
  /** Two or more zone groups whose Σ ceilings > area max: zones can compete for the area total. */
  readonly contention: boolean
  readonly notes: readonly string[]
}

export function capacityReport(area: AreaConfig): CapacityReport {
  const groups = new Map<string | null, { max: number | null; nestTotal: number }>()
  for (const zone of area.zones ?? []) groups.set(zone.id, { max: zone.maxAlive ?? null, nestTotal: 0 })
  for (const nest of area.nests) {
    const key = nest.populationZoneId ?? null
    const g = groups.get(key) ?? { max: null, nestTotal: 0 }
    g.nestTotal += nest.maxAlive
    groups.set(key, g)
  }
  const ceilings = [...groups.entries()].map(([zoneId, g]) => ({ zoneId, max: g.max, nestTotal: g.nestTotal, ceiling: Math.min(g.max ?? Infinity, g.nestTotal) }))
  const total = ceilings.reduce((s, z) => s + z.ceiling, 0)
  const zones = ceilings.map(z => ({ ...z, guaranteed: Math.min(z.ceiling, Math.max(0, area.maxAlive - (total - z.ceiling))) }))
  const notes: string[] = []
  const contention = zones.length > 1 && total > area.maxAlive
  if (contention) notes.push(`Σ zone ceilings ${total} > area max ${area.maxAlive}: zones compete for the area total; a zone may find the area full`)
  else if (total > area.maxAlive) notes.push(`nests could hold ${total} > area max ${area.maxAlive}: the area limit binds (one zone, no competition between zones)`)
  for (const z of zones) {
    const name = z.zoneId ?? '(nests without zone)'
    if (z.max !== null && z.max > z.nestTotal) notes.push(`${name}: max ${z.max} exceeds its nests' total ${z.nestTotal}; the nests bind first`)
    if (contention && z.guaranteed < z.ceiling) notes.push(`${name}: only ${z.guaranteed} of ${z.ceiling} are numerically guaranteed when the others are at their ceiling`)
  }
  return { areaId: area.areaId, areaMax: area.maxAlive, zones, contention, notes }
}
