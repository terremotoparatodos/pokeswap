// SC-R1 (ECO-BATTLE-SCENE-1 review): where an ECO encounter is SEEN, for the distance the card and
// the debug panel show and gate «Combatir» with.
//
// The server measures the 3-tile start range from the encounter's pose on its shared patrol at the
// server's time (`wildPoseAt`, ecoBattles.js), not from its home tile. The map draws that same patrol
// at the same shared clock (ecoPopulace.ts, SharedWorld.serverNow), so measuring here from the same
// pose keeps the card, the debug panel, the map and the server in agreement. This is presentation:
// the server still decides when «Combatir» is pressed.

import { wildPoseAt } from '../../../../services/realtime/src/world/ecoScene.js'
import type { EcoEncounter } from '../../../../services/realtime/src/world/worldProtocol.js'

export interface Tile { readonly tx: number; readonly ty: number }

/**
 * The tile an encounter is seen on: where the server froze it while busy (`stand`); before the
 * shared clock is known, its home tile (the map draws it there too); otherwise its patrol pose at
 * server time `serverNow`.
 */
export function ecoSeenTile(encounter: EcoEncounter, areaId: string, serverNow: number | null): Tile {
  if (encounter.busy) return encounter.stand ?? { tx: encounter.tx, ty: encounter.ty }
  if (serverNow === null) return { tx: encounter.tx, ty: encounter.ty }
  return wildPoseAt({ id: encounter.id, areaId, tx: encounter.tx, ty: encounter.ty }, serverNow)
}

/** Chebyshev distance in tiles, the metric of the server's range check. */
export function tileDistance(a: Tile, b: Tile): number {
  return Math.max(Math.abs(a.tx - b.tx), Math.abs(a.ty - b.ty))
}
