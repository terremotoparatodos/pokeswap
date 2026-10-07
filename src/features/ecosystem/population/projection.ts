// What a viewer of an area may eventually be shown (ECO-2A).
//
// Deliberately narrow: identity, species, place and group. Never the due
// times, the rarity tier, the catalog entry, the generation counter as a
// field, the namespace's source, or anything about the random source.
// (Ids embed the generation by design, so an engage on a stale id can be
// refused; that reveals nothing about the future.)

import type { PopulationState, Tile } from './types'

export interface PublicEncounter {
  readonly id: string
  readonly groupId: string
  readonly speciesId: number
  readonly tile: Tile
}

export interface PublicArea {
  /** False while the area is not simulated (idle or dormant): a viewer sees nothing, not "everything was defeated". */
  readonly simulated: boolean
  readonly encounters: readonly PublicEncounter[]
}

export function publicArea(state: PopulationState, areaId: string): PublicArea {
  const area = state.areas[areaId]
  if (!area || area.status !== 'active') return { simulated: false, encounters: [] }
  const encounters = Object.values(state.nests)
    .flatMap(nest => nest.alive)
    .filter(encounter => encounter.areaId === areaId)
    .map(({ id, groupId, speciesId, tile }) => ({ id, groupId, speciesId, tile }))
  return { simulated: true, encounters }
}
