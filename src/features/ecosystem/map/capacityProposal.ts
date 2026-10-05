// ECO-CAPACITY-1 — proposed initial capacity for the ten ECO-MAP-1 nests.
// PROVISIONAL numbers for review, not approved balance. Positions, habitats
// and species are those of ECO-MAP-1, unchanged.
//
//   pradera (one presence area): total 18
//     zone abierta  max 12  (its 5 nests could hold 15: the zone maximum binds)
//     zone bosque   max 6   (= its 2 nests' total; the clearings are the real limit)
//     12 + 6 = 18 = area total → no numeric contention: when abierta is at its maximum,
//     6 stay available for bosque. A maximum, not a reservation: this holds only because
//     area − max(abierta) ≥ bosque's ceiling. It is numbers, not free tiles: geometry and
//     the pool can still stop a forest spawn.
//   cueva-inicial: total 6, one zone without its own maximum (its 3 nests could hold 9).

import type { AreaConfig, IdleConfig, NestConfig, RespawnConfig } from '../population/types'
import { nestValidation } from './nestData'
import { NEST_PROPOSALS } from './nestProposals'
import { PROVISIONAL_CAPACITY } from './capacityLimits'

export { PROVISIONAL_CAPACITY }

/** The engine area config of one presence area, built from the ECO-MAP-1 nests and the proposed capacity. */
export function proposedAreaConfig(areaId: string, respawn: RespawnConfig, idle: IdleConfig): AreaConfig {
  const capacity = PROVISIONAL_CAPACITY[areaId]
  if (!capacity) throw new Error(`no capacity proposal for area ${areaId}`)
  const { reports } = nestValidation()
  const zoneOf = new Map(capacity.zones.map(z => [z.catalogZone, z.id]))
  const nests: NestConfig[] = NEST_PROPOSALS.filter(n => n.areaId === areaId).map(n => ({
    id: n.id, zoneId: n.zoneId, habitats: n.habitats, tiles: reports.find(r => r.id === n.id)!.candidates,
    maxAlive: n.maxAlive, groupCap: n.groupCap, respawn, populationZoneId: zoneOf.get(n.zoneId),
  }))
  return {
    areaId, maxAlive: capacity.maxAlive, idle, nests,
    zones: capacity.zones.map(z => (z.maxAlive === undefined ? { id: z.id } : { id: z.id, maxAlive: z.maxAlive })),
  }
}
