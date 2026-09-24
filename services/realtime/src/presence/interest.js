export const SECTOR_SIZE = 12
export const WILD_RADIUS = 1
/**
 * At the 3x camera zoom a 1920 px window shows ~20 tiles either side of the
 * player: the town radius, and the floor of the wild one. Wild sectors alone
 * could drop an actor 13 tiles away, in plain view (PERF-1 §13.8).
 */
export const TOWN_RADIUS_TILES = 20
export const NEAR_RADIUS_TILES = 20
/**
 * Hysteresis (PERF-2.4): an actor already visible stays until it is this many
 * tiles beyond the entry radius. Remotes moving along the edge used to leave
 * and re-enter within a second, recreated each time; 6 covers the back and
 * forth measured there (5-tile loops) and ~0.8 s of running.
 */
export const RETAIN_MARGIN_TILES = 6

const chebyshev = (a, b) => Math.max(Math.abs(a.tx - b.tx), Math.abs(a.ty - b.ty))

export function sectorFor(tx, ty) { return { x: Math.floor(tx / SECTOR_SIZE), y: Math.floor(ty / SECTOR_SIZE) } }

function inSectors(viewer, actor) {
  const a = sectorFor(viewer.tx, viewer.ty); const b = sectorFor(actor.tx, actor.ty)
  return Math.abs(a.x - b.x) <= WILD_RADIUS && Math.abs(a.y - b.y) <= WILD_RADIUS
}

/** Whether a viewer that does not see `actor` yet should start seeing it. */
export function isVisible(viewer, actor) {
  if (viewer.areaId !== actor.areaId) return false
  if (viewer.areaId === 'ciudad-corazon') return chebyshev(viewer, actor) <= TOWN_RADIUS_TILES
  return chebyshev(viewer, actor) <= NEAR_RADIUS_TILES || inSectors(viewer, actor)
}

/** Whether a viewer that already sees `actor` keeps seeing it. */
export function isRetained(viewer, actor) {
  if (viewer.areaId !== actor.areaId) return false
  if (viewer.areaId === 'ciudad-corazon') return chebyshev(viewer, actor) <= TOWN_RADIUS_TILES + RETAIN_MARGIN_TILES
  return chebyshev(viewer, actor) <= NEAR_RADIUS_TILES + RETAIN_MARGIN_TILES || inSectors(viewer, actor)
}

/** `seen`: ids the viewer already holds, which get the wider retention test. */
export function visibleActors(viewer, actors, seen = null) {
  return [...actors.values()].filter(actor => actor.id !== viewer.id
    && (seen?.has(actor.id) ? isRetained(viewer, actor) : isVisible(viewer, actor)))
}
