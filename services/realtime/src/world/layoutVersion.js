import { createHash } from 'node:crypto'
import { ARRIVALS } from '../protocol/arrival.js'
import { WORLD_AREAS } from './areas.js'
import { CAVES } from './caves.js'
import { CAVE_INTERIORS, caveInterior } from './caveLayouts.js'
import { AREA_BOUNDS, PORTALS, isReachable, isWalkable, portalAt } from './navigation.js'
import { ARRIVAL_CLEARANCE, RESERVED_AREAS, RESOURCE_ZONES, ROUTES } from './resourceZones.js'
import { TOWN_AREA_ID, TOWN_HEIGHT, TOWN_WIDTH } from './townLayout.js'

/**
 * WORLD LOCATION-2: the layout version of each persistable area (D-L8).
 *
 * A saved location carries the version of its area at save time. On restore,
 * a different version means the map changed under the saved tile: the player
 * goes to the area's arrival even if the tile still looks valid (a fenced
 * pocket, for instance, stays "walkable" in Pradera, where reachable equals
 * walkable — audit H4).
 *
 * The version is a fingerprint of what the service navigates by, never sent
 * to a client: `1.<first 12 hex of sha256>`.
 *   Ciudad and cave interiors: every tile of the grid (plus a one-tile rim),
 *     classified as solid, walkable-unreachable, safe or portal.
 *   Pradera (procedural, ±4096): the authored facts (seed, bounds, zones,
 *     reserves, routes, caves, portals, arrival), every tile of the authored
 *     region plus a margin, and a sparse 64-tile lattice over the whole area.
 *     A procedural change far from every authored place and between lattice
 *     points could slip through; `isSafeLanding` still guards the tile itself.
 *
 * Computed once per area, on first use (Pradera: ~60 ms), then cached.
 */

export const LAYOUT_VERSION_ALGORITHM = '1'

/** Areas whose location is saved as is: Ciudad, Pradera and every open cave interior. */
export const PERSISTABLE_AREAS = Object.freeze([TOWN_AREA_ID, 'pradera', ...Object.keys(CAVE_INTERIORS)])
const PERSISTABLE = new Set(PERSISTABLE_AREAS)

export function isPersistableArea(areaId) {
  return typeof areaId === 'string' && PERSISTABLE.has(areaId)
}

/** The navigation a fingerprint reads; tests swap one tile to prove the version follows it. */
export const CANONICAL_NAVIGATION = Object.freeze({ isWalkable, isReachable, portalAt })

const PRADERA_MARGIN = 24
const PRADERA_LATTICE = 64

function tileClass(nav, areaId, tx, ty) {
  if (!nav.isWalkable(areaId, tx, ty)) return '#'
  if (nav.portalAt(areaId, tx, ty) !== null) return 'p'
  return nav.isReachable(areaId, tx, ty) ? '.' : 'u'
}

function scan(nav, areaId, minTx, minTy, maxTx, maxTy, step = 1) {
  const rows = []
  for (let ty = minTy; ty <= maxTy; ty += step) {
    let line = ''
    for (let tx = minTx; tx <= maxTx; tx += step) line += tileClass(nav, areaId, tx, ty)
    rows.push(line)
  }
  return rows.join('\n')
}

/** The authored region of Pradera: every box and tile the service treats as a fixed place. */
function praderaAuthoredBox() {
  const boxes = [
    ...RESOURCE_ZONES.filter(z => z.areaId === 'pradera').map(z => z.box),
    ...RESERVED_AREAS.filter(r => r.areaId === 'pradera').map(r => r.box),
    ...ROUTES.filter(r => r.areaId === 'pradera').map(r => r.box),
    ARRIVAL_CLEARANCE.box,
  ]
  const tiles = [
    ...CAVES.filter(c => c.areaId === 'pradera').flatMap(c => [...c.footprint, ...c.clearance, c.approach, c.mouth]),
    ...PORTALS.filter(p => p.areaId === 'pradera'), ARRIVALS.pradera,
  ]
  let minTx = Infinity, minTy = Infinity, maxTx = -Infinity, maxTy = -Infinity
  // resourceZones boxes are { x0, y0, x1, y1 }, inclusive.
  for (const b of boxes) { minTx = Math.min(minTx, b.x0); minTy = Math.min(minTy, b.y0); maxTx = Math.max(maxTx, b.x1); maxTy = Math.max(maxTy, b.y1) }
  for (const t of tiles) { minTx = Math.min(minTx, t.tx); minTy = Math.min(minTy, t.ty); maxTx = Math.max(maxTx, t.tx); maxTy = Math.max(maxTy, t.ty) }
  if (![minTx, minTy, maxTx, maxTy].every(Number.isFinite)) throw new Error('Pradera authored region is empty')
  return { minTx: minTx - PRADERA_MARGIN, minTy: minTy - PRADERA_MARGIN, maxTx: maxTx + PRADERA_MARGIN, maxTy: maxTy + PRADERA_MARGIN }
}

/** The dense window of Pradera's fingerprint (guard tests). */
export const praderaFingerprintWindow = () => praderaAuthoredBox()

/** What the fingerprint of an area hashes. Exported for the guard tests only. */
export function layoutSource(areaId, nav = CANONICAL_NAVIGATION) {
  if (areaId === TOWN_AREA_ID) {
    return JSON.stringify({ areaId, arrival: ARRIVALS[areaId] }) + '\n' + scan(nav, areaId, -1, -1, TOWN_WIDTH, TOWN_HEIGHT)
  }
  const interior = caveInterior(areaId)
  if (interior) {
    return JSON.stringify({ areaId, arrival: interior.arrival, exit: interior.exit }) + '\n' + scan(nav, areaId, -1, -1, interior.width, interior.height)
  }
  if (areaId === 'pradera') {
    const authored = praderaAuthoredBox()
    const bounds = AREA_BOUNDS.pradera
    const facts = {
      areaId, seed: WORLD_AREAS.pradera.seed, bounds, arrival: ARRIVALS.pradera, authored,
      zones: RESOURCE_ZONES.filter(z => z.areaId === areaId), reserved: RESERVED_AREAS.filter(r => r.areaId === areaId),
      routes: ROUTES.filter(r => r.areaId === areaId), caves: CAVES.filter(c => c.areaId === areaId),
      portals: PORTALS.filter(p => p.areaId === areaId),
    }
    return JSON.stringify(facts) + '\n' + scan(nav, areaId, authored.minTx, authored.minTy, authored.maxTx, authored.maxTy) +
      '\n' + scan(nav, areaId, bounds.minTx, bounds.minTy, bounds.maxTx, bounds.maxTy, PRADERA_LATTICE)
  }
  return null
}

/** The version string of a fingerprint source. */
export function versionOf(source) {
  return `${LAYOUT_VERSION_ALGORITHM}.${createHash('sha256').update(source).digest('hex').slice(0, 12)}`
}

const cache = new Map()

/** The current layout version of a persistable area, or null for any other area. */
export function layoutVersion(areaId) {
  if (!isPersistableArea(areaId)) return null
  if (!cache.has(areaId)) cache.set(areaId, versionOf(layoutSource(areaId)))
  return cache.get(areaId)
}
