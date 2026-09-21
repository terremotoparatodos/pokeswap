export const SECTOR_SIZE = 12
export const WILD_RADIUS = 1
/** At the town's 3x camera zoom this covers the viewport with an off-screen margin. */
export const TOWN_RADIUS_TILES = 20

export function sectorFor(tx, ty) { return { x: Math.floor(tx / SECTOR_SIZE), y: Math.floor(ty / SECTOR_SIZE) } }
export function isVisible(viewer, actor) {
  if (viewer.areaId !== actor.areaId) return false
  if (viewer.areaId === 'ciudad-corazon') {
    return Math.abs(viewer.tx - actor.tx) <= TOWN_RADIUS_TILES && Math.abs(viewer.ty - actor.ty) <= TOWN_RADIUS_TILES
  }
  const a = sectorFor(viewer.tx, viewer.ty); const b = sectorFor(actor.tx, actor.ty)
  return Math.abs(a.x - b.x) <= WILD_RADIUS && Math.abs(a.y - b.y) <= WILD_RADIUS
}
export function visibleActors(viewer, actors) {
  return [...actors.values()].filter(actor => actor.id !== viewer.id && isVisible(viewer, actor))
}
