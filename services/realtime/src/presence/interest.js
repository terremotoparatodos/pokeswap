export const SECTOR_SIZE = 12
export const WILD_RADIUS = 1

export function sectorFor(tx, ty) { return { x: Math.floor(tx / SECTOR_SIZE), y: Math.floor(ty / SECTOR_SIZE) } }
export function isVisible(viewer, actor) {
  if (viewer.areaId !== actor.areaId) return false
  if (viewer.areaId === 'ciudad-corazon') return true
  const a = sectorFor(viewer.tx, viewer.ty); const b = sectorFor(actor.tx, actor.ty)
  return Math.abs(a.x - b.x) <= WILD_RADIUS && Math.abs(a.y - b.y) <= WILD_RADIUS
}
export function visibleActors(viewer, actors) {
  return [...actors.values()].filter(actor => actor.id !== viewer.id && isVisible(viewer, actor))
}
