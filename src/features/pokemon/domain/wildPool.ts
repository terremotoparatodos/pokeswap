// Wild pool membership — WildLands display rule.
//
// WORLD-1D: the pool itself is rolled once per hour by the realtime service
// (services/realtime/src/world/wildPopulation.js) and is the same for every
// player; no browser rolls one any more. `slots` remains the ownership
// authority: a pool member this client already sees owned is hidden at once.

import type { Slot } from '../../../shared/types/database'

/** Current members of the shared pool that the server still reports as free. */
export function availableWildPool(pool: readonly number[], slots: Readonly<Record<number, Slot>>): number[] {
  return pool.filter(id => !slots[id]?.owner_id)
}
