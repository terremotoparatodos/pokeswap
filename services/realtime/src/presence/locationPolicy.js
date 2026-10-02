import { ARRIVALS, arrivalFor } from '../protocol/arrival.js'
import { CAVES, caveByInterior } from '../world/caves.js'
import { isPersistableArea, layoutVersion } from '../world/layoutVersion.js'
import { isSafeLanding } from '../world/navigation.js'
import { TOWN_AREA_ID, TOWN_SPAWN } from '../world/townLayout.js'
import { WORLD_PROTOCOL } from '../world/worldProtocol.js'

/**
 * WORLD LOCATION-2: what is saved for an actor, and where a saved location
 * puts a player back. Pure functions over the canonical navigation.
 */

/** A Dungeon floor area (SHARED_DUNGEON_ARCHITECTURE §2.3): `dg:<dungeonId>:<n>`. */
const DUNGEON_FLOOR = /^dg:([a-z0-9][a-z0-9-]{0,47}):([1-9][0-9]{0,2})$/

/**
 * dungeonId → the id of the cave that offers it. Empty until Dungeons exist
 * (`dungeonDefinitions.js` will own it); tests pass their own.
 */
export const DUNGEON_CAVES = Object.freeze({})

/**
 * D-L9: a Dungeon floor is temporary, so a player on one is saved at the
 * floor's permanent exterior anchor — the approach in front of its cave's
 * mouth — never at the floor itself. Null for an unknown Dungeon.
 */
export function dungeonAnchor(areaId, dungeonCaves = DUNGEON_CAVES) {
  const match = typeof areaId === 'string' ? DUNGEON_FLOOR.exec(areaId) : null
  if (!match || !Object.hasOwn(dungeonCaves, match[1])) return null
  const cave = CAVES.find(c => c.id === dungeonCaves[match[1]])
  return cave ? { areaId: cave.areaId, tx: cave.approach.tx, ty: cave.approach.ty } : null
}

/**
 * The location the journal saves for an actor (its `locate`): the actor's own
 * area and tile with that area's layout version; a Dungeon floor's anchor; or
 * null for any area that is not saved (the last saved location then stands).
 * Always read from the server's actor, never from a client payload.
 */
export function savedLocationOf(actor, dungeonCaves = DUNGEON_CAVES) {
  const place = isPersistableArea(actor?.areaId) ? { areaId: actor.areaId, tx: actor.tx, ty: actor.ty } : dungeonAnchor(actor?.areaId, dungeonCaves)
  if (!place || !Number.isSafeInteger(place.tx) || !Number.isSafeInteger(place.ty)) return null
  return { ...place, layoutVersion: layoutVersion(place.areaId) }
}

const placed = (areaId, at, repair) => ({ areaId, tx: at.tx, ty: at.ty, dir: at.dir ?? 'down', repair })

/**
 * Where a stored location puts a player now, validated against the current
 * navigation. Null when there is no stored location (the caller uses Ciudad).
 *   unknown or retired area                → Ciudad spawn            repair 'area'
 *   cave interior, client older than CAVES-3
 *     (worldProtocol < 3 or none)            → the cave's approach     repair 'protocol'  (D-L6)
 *   layout version differs                 → the area's arrival      repair 'layout'    (D-L8)
 *   solid, unreachable, portal, off-edge   → the area's arrival      repair 'tile'
 *   otherwise                              → the tile, facing down   repair null        (D-L7)
 */
export function restoreFromRow(location, { worldProtocol } = {}) {
  if (!location) return null
  const { areaId, tx, ty } = location
  if (!isPersistableArea(areaId)) return placed(TOWN_AREA_ID, TOWN_SPAWN, 'area')
  const cave = caveByInterior(areaId)
  if (cave && !(Number.isInteger(worldProtocol) && worldProtocol >= WORLD_PROTOCOL)) {
    const outside = arrivalFor(cave.areaId, areaId)
    return outside && isSafeLanding(cave.areaId, outside.tx, outside.ty)
      ? placed(cave.areaId, outside, 'protocol')
      : placed(TOWN_AREA_ID, TOWN_SPAWN, 'protocol')
  }
  const arrival = ARRIVALS[areaId]
  if (location.layoutVersion !== layoutVersion(areaId)) return placed(areaId, arrival, 'layout')
  if (!isSafeLanding(areaId, tx, ty)) return placed(areaId, arrival, 'tile')
  return { areaId, tx, ty, dir: 'down', repair: null }
}
