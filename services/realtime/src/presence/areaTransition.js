import { arrivalFor } from '../protocol/arrival.js'
import { CAVE_ENTRANCE, caveByInterior } from '../world/caves.js'
import { caveInterior, isCaveFloor } from '../world/caveLayouts.js'
import { STEP_DELTA } from './movement.js'

/**
 * CAVES-3: the service decides who may cross into or out of a cave.
 *
 * A client asks for an area (`area` message); this answers where the actor
 * lands, or `null` when the change is refused. It never moves the actor.
 *
 * - Into a cave interior: only from the cave's own area, through an open
 *   entrance, standing on the mouth tile itself (where the client's portal
 *   is). Asking from anywhere else, or from another area, is refused.
 * - Out of a cave interior to the cave's area: only standing on the exit pad.
 *   It lands on the approach, in front of the mouth — never on the mouth, so
 *   leaving cannot loop straight back in.
 * - Everything else keeps the behaviour it had before CAVES-3: the Ciudad ↔
 *   Pradera trip, the "Ciudad" escape hatch (also from inside a cave) and the
 *   same-area reset to the area's arrival.
 */
export function areaTransition(actor, to) {
  const from = actor.areaId
  const entering = caveByInterior(to)
  if (entering && from !== to) {
    if (from !== entering.areaId || entering.entrance !== CAVE_ENTRANCE.OPEN) return null
    if (actor.tx !== entering.mouth.tx || actor.ty !== entering.mouth.ty) return null
  }
  const leaving = caveByInterior(from)
  if (leaving && to === leaving.areaId) {
    const { exit } = caveInterior(from)
    if (actor.tx !== exit.tx || actor.ty !== exit.ty) return null
  }
  return arrivalFor(to, from)
}

/**
 * Whether one step is allowed by the shared collision of the actor's area.
 * The service checks it where it holds the whole map: cave interiors, whose
 * walls and edges come from `caveLayouts.js`. Elsewhere walkability is still
 * decided by the client (see `movement.js`); this only ever refuses more.
 */
export function stepAllowed(actor, direction) {
  if (!caveInterior(actor.areaId)) return true
  const [dx, dy] = STEP_DELTA[direction]
  return isCaveFloor(actor.areaId, actor.tx + dx, actor.ty + dy)
}
