import { ARRIVALS } from '../protocol/arrival.js'
import { WORLD_AREAS } from './areas.js'
import { CAVES, CAVE_ENTRANCE } from './caves.js'
import { caveInterior, isCaveFloor } from './caveLayouts.js'
import { isSolidAtArea } from './resourceZones.js'
import { TOWN_AREA_ID, TOWN_GATES, isTownWalkable } from './townLayout.js'

/**
 * Where a player can stand and where each portal leads, for every shared
 * presence area (CAVES-4).
 *
 * One answer for both sides, built only from the shared sources: the town
 * layout (`townLayout.js`), Pradera's terrain and authored layer
 * (`resourceZones.js`, which includes the cave rock) and the cave interiors
 * (`caveLayouts.js`). The presence service validates every step and every
 * crossing with it; the browser's areas collide with exactly the same tiles
 * (the parity tests prove it), so a legitimate client is never refused.
 *
 * Water is not solid here on purpose: the player avatar walks on it in every
 * build (`habitat: 'any'`); only wanderers keep to their habitat.
 *
 * Dependency-free on purpose, like everything it reads: Vite may bundle it.
 */

/**
 * Pradera is procedural and unbounded in the art. The service still needs a
 * hard edge: past it, every tile is solid for the browser and the service
 * alike. Thousands of tiles from the arrival, far beyond any authored place.
 */
export const AREA_BOUNDS = Object.freeze({
  pradera: Object.freeze({ minTx: -4096, minTy: -4096, maxTx: 4095, maxTy: 4095 }),
})

/** Whether a tile lies inside the hard edge of a procedural area (always true elsewhere). */
export function insideAreaBounds(areaId, tx, ty) {
  const bounds = Object.hasOwn(AREA_BOUNDS, areaId) ? AREA_BOUNDS[areaId] : null
  if (!bounds) return true
  return tx >= bounds.minTx && tx <= bounds.maxTx && ty >= bounds.minTy && ty <= bounds.maxTy
}

/** Pradera's pad back to town: the tile north of the arrival (`WildArea`'s first portal). */
export const PRADERA_RETURN_PAD = Object.freeze({ tx: ARRIVALS.pradera.tx, ty: ARRIVALS.pradera.ty - 1 })

/**
 * Whether a tile of a shared area can be stood on. False for anything that is
 * not an integer tile of a known shared area.
 */
export function isWalkable(areaId, tx, ty) {
  if (!Number.isSafeInteger(tx) || !Number.isSafeInteger(ty)) return false
  if (areaId === TOWN_AREA_ID) return isTownWalkable(tx, ty)
  if (caveInterior(areaId)) return isCaveFloor(areaId, tx, ty)
  if (areaId === 'pradera') return insideAreaBounds(areaId, tx, ty) && !isSolidAtArea(areaId, WORLD_AREAS.pradera.seed, tx, ty)
  return false
}

const portal = (areaId, tx, ty, to) => Object.freeze({ areaId, tx, ty, to })

/**
 * Every portal tile of every shared area and the area it leads to: the town
 * gates (also those to worlds that are not shared, which the service never
 * crosses), Pradera's pad back to town, each open cave mouth and each cave's
 * exit pad. Standing exactly on one is the only way to cross by walking.
 */
export const PORTALS = Object.freeze([
  ...TOWN_GATES.flatMap(gate => gate.tiles.map(t => portal(TOWN_AREA_ID, t.tx, t.ty, gate.to))),
  portal('pradera', PRADERA_RETURN_PAD.tx, PRADERA_RETURN_PAD.ty, TOWN_AREA_ID),
  ...CAVES.filter(cave => cave.entrance === CAVE_ENTRANCE.OPEN).flatMap(cave => {
    const interior = caveInterior(cave.interiorAreaId)
    return [
      portal(cave.areaId, cave.mouth.tx, cave.mouth.ty, cave.interiorAreaId),
      ...(interior ? [portal(interior.id, interior.exit.tx, interior.exit.ty, cave.areaId)] : []),
    ]
  }),
])

const PORTAL_BY_TILE = new Map(PORTALS.map(p => [`${p.areaId}:${p.tx}:${p.ty}`, p.to]))

/**
 * The area the portal on a tile leads to, or null. Only the tile itself
 * counts: standing next to a portal, or anywhere else, leads nowhere.
 */
export function portalAt(areaId, tx, ty) {
  return PORTAL_BY_TILE.get(`${areaId}:${tx}:${ty}`) ?? null
}

/** The first portal tile of `from` that leads to `to`, or null (tests, tools and the benchmark). */
export function portalTo(from, to) {
  return PORTALS.find(p => p.areaId === from && p.to === to) ?? null
}

/**
 * A tile a player may be put on without walking there: walkable and not a
 * portal (landing on one would carry it straight across). Arrivals, recalls
 * and restored positions must all be one.
 */
export function isSafeLanding(areaId, tx, ty) {
  return isWalkable(areaId, tx, ty) && portalAt(areaId, tx, ty) === null
}
