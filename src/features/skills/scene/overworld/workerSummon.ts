// Worker summon (R31-Z): bringing the assigned Pokémon beside the player once
// per action. Every profession overlay did this the same way; they still say
// what is being worked on and which extra tile is taken (a node, the bench),
// while the placement rule itself stays in `workerSpot`.

import type { Area } from '../../../wildlands/engine/area'
import type { WorkerCompanion } from './workerCompanion'
import { workerSpot, type TilePoint } from './workerPresence'

/** The part of a running action the summon reads and marks. */
export interface SummonableAction {
  summoned: boolean
  readonly workerSpeciesId: number | null
}

/**
 * Summons the worker for this action, at most once. The action is marked even
 * when it has no worker or no free spot, so later frames do not retry.
 */
export function summonWorkerOnce(
  companion: WorkerCompanion,
  action: SummonableAction,
  player: TilePoint,
  target: TilePoint,
  isFree: (tx: number, ty: number) => boolean,
): void {
  if (action.summoned) return
  action.summoned = true
  if (action.workerSpeciesId === null) return
  const spot = workerSpot(player, target, isFree)
  if (spot) companion.summon(action.workerSpeciesId, spot)
}

/** Dry, walkable ground that `taken` does not claim: where a worker may stand. */
export function openGround(area: Pick<Area, 'isSolid' | 'isWater'>, taken: (tx: number, ty: number) => boolean) {
  return (tx: number, ty: number): boolean => !area.isSolid(tx, ty) && !area.isWater(tx, ty) && !taken(tx, ty)
}
