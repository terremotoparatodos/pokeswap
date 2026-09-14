import { isPortalTile, type Area } from '../engine/area'
import { doorAt } from '../engine/doors'
import type { TownPosition } from './playerPreferences'

/** Only ordinary walkable town tiles are safe reload positions. */
export function isRestorableTownPosition(area: Area, position: TownPosition): boolean {
  return area.kind === 'town' &&
    !area.isSolid(position.tx, position.ty) &&
    !isPortalTile(area, position.tx, position.ty) &&
    !doorAt(area.doors ?? [], position.tx, position.ty)
}
