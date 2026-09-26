import { decorAt, isSolidDecor } from './terrain.js'
import { AUTHORED_DECOR } from './resourceZoneLayout.js'

/**
 * Resource zones of the shared world (MAP-2).
 *
 * Pradera has one forest and one quarry near the arrival. Inside a zone every
 * prop that looks like a resource *is* one (every round tree and every pine
 * in the forest, every rock in the quarry); outside the zones, in an area that
 * has zones, no prop is a resource node. The rule a player learns is where to
 * go, not which prop to try.
 *
 * The procedural generator (`terrain.js`) is not touched: its fingerprint is
 * frozen. Zones sit on top of it as an *authored layer*: a few tiles cleared
 * (corridors, the quarry floor), trees planted in the forest, rocks placed in
 * the quarry. `resourceZoneLayout.js` holds that data, generated once by
 * `scripts/map/zone-layout.ts` and reviewed as data. Both sides read it here,
 * so the browser draws exactly the props and collisions the server validates.
 *
 * Dependency-free on purpose: Vite bundles it into the client, Node runs it.
 */

/** `x0..x1 · y0..y1`, inclusive. */
const box = (x0, y0, x1, y1) => Object.freeze({ x0, y0, x1, y1 })
const inBox = (b, tx, ty) => tx >= b.x0 && tx <= b.x1 && ty >= b.y0 && ty <= b.y1

/**
 * `nodes`: the props that are resource nodes inside the zone. What they yield
 * is SKILLS' (see `worldSkills/resourceMapping.ts`).
 * `lanes`: two-tile corridors kept clear of props; `buffers`: rows kept free
 * of trees so no canopy covers a corridor (a canopy covers the tile above its
 * trunk). `entry`: where the route from the arrival reaches the zone.
 */
export const RESOURCE_ZONES = Object.freeze([
  Object.freeze({
    id: 'bosque', areaId: 'pradera', label: 'Bosque · Talar', box: box(-19, -54, 2, -37), nodes: Object.freeze(['tree', 'pine']),
    lanes: Object.freeze([box(-5, -54, -4, -37), box(-19, -47, 2, -46)]), buffers: Object.freeze([box(-19, -45, 2, -45)]),
    entry: Object.freeze({ tx: -5, ty: -54 }),
  }),
  Object.freeze({
    id: 'cantera', areaId: 'pradera', label: 'Cantera · Minería', box: box(3, -76, 18, -63), nodes: Object.freeze(['rock']),
    lanes: Object.freeze([box(10, -76, 11, -63), box(3, -70, 18, -69)]), buffers: Object.freeze([]),
    entry: Object.freeze({ tx: 3, ty: -70 }),
  }),
])

/** Kept free for later: higher-tier minerals toward the snow, and the huerta's growth. */
export const RESERVED_AREAS = Object.freeze([
  Object.freeze({ id: 'reserva-minerales', areaId: 'pradera', box: box(-14, -91, 1, -78) }),
  Object.freeze({ id: 'reserva-huerta', areaId: 'pradera', box: box(-12, -75, -8, -70) }),
])

/** Arrival pad, portal and huerta: no zone, lane or prop change comes closer than this box plus three tiles. */
export const ARRIVAL_CLEARANCE = Object.freeze({ areaId: 'pradera', box: box(-9, -73, -1, -65), margin: 3 })

/** Two-tile routes from the arrival to each zone entry, clear of props. */
export const ROUTES = Object.freeze([
  Object.freeze({ id: 'al-bosque', areaId: 'pradera', to: 'bosque', box: box(-5, -64, -4, -55) }),
  Object.freeze({ id: 'a-la-cantera', areaId: 'pradera', to: 'cantera', box: box(0, -70, 2, -69) }),
])

const ZONE_AREAS = new Set(RESOURCE_ZONES.map(zone => zone.areaId))

/** Whether an area's resource nodes come from zones (then there are none outside them). */
export function hasResourceZones(areaId) {
  return ZONE_AREAS.has(areaId)
}

/** The resource zone on a tile, or null. */
export function resourceZoneAt(areaId, tx, ty) {
  for (const zone of RESOURCE_ZONES) if (zone.areaId === areaId && inBox(zone.box, tx, ty)) return zone
  return null
}

/** Whether a tile belongs to a zone, a route, a reserve or the arrival clearance (nothing else may be placed there). */
export function isPlannedTile(areaId, tx, ty) {
  return !!resourceZoneAt(areaId, tx, ty)
    || ROUTES.some(route => route.areaId === areaId && inBox(route.box, tx, ty))
    || RESERVED_AREAS.some(area => area.areaId === areaId && inBox(area.box, tx, ty))
}

/** Whether a tile is part of a zone lane or buffer, or of a route. */
export function isCorridorTile(areaId, tx, ty) {
  for (const zone of RESOURCE_ZONES) {
    if (zone.areaId !== areaId) continue
    if (zone.lanes.some(lane => inBox(lane, tx, ty)) || zone.buffers.some(buffer => inBox(buffer, tx, ty))) return true
  }
  return ROUTES.some(route => route.areaId === areaId && inBox(route.box, tx, ty))
}

const authored = AUTHORED_DECOR

/**
 * The prop on a tile of an area: the authored layer where it says something
 * (a kind, or null for a cleared tile), the procedural generator elsewhere.
 * `corners` is forwarded to the generator (the client passes them from its
 * vertex grid); authored props are only ever placed where all four agree.
 */
export function decorAtArea(areaId, seed, tx, ty, corners) {
  const key = `${areaId}:${tx}:${ty}`
  if (authored.has(key)) return authored.get(key)
  return decorAt(seed, tx, ty, corners)
}

/** Collision of the shared layer: the same answer the browser's World gives for the area. */
export function isSolidAtArea(areaId, seed, tx, ty) {
  return isSolidDecor(decorAtArea(areaId, seed, tx, ty))
}
