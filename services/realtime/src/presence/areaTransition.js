import { AREA } from '../protocol/messages.js'
import { ARRIVALS, arrivalFor } from '../protocol/arrival.js'
import { isWalkable, portalAt } from '../world/navigation.js'
import { STEP_DELTA } from './movement.js'

/**
 * How the service answers an `area` request (CAVES-3, generalised in CAVES-4).
 * The client only names an area; whether it may go and where it lands are
 * decided here, from the actor's real area and tile. It never moves the actor.
 */
export const TRANSITION = Object.freeze({
  /** Standing on a portal that leads to the requested area: crosses to its arrival. */
  PORTAL: 'portal',
  /** The "Ciudad" button: back to the town from anywhere, to a landing the service picks. */
  RECALL: 'recall',
  /** The client asked for the area it already is in (its safe-point repair): no move, just the real state. */
  RESYNC: 'resync',
})

/**
 * Returns `{ kind, arrival }`, or `null` when the request is refused.
 * `arrival` is where the actor lands, or `null` for a resync that keeps it.
 *
 * - Another area through a portal: only standing **exactly** on a portal of
 *   the actor's real area whose destination is that area (a town gate, the
 *   Pradera pad, an open cave mouth, a cave exit pad). It lands on the
 *   destination's arrival for that origin, never on a portal (no loop).
 * - The town from anywhere else: the recall. The landing is the one the
 *   client already predicts for that origin (`arrivalFor`): by the west gate
 *   from Pradera, the town spawn from the cave.
 * - The town while in the town: the recall to the spawn.
 * - Any other area the actor already is in: a resync, which does not move
 *   it, unless its own tile stopped being walkable: then the area's arrival.
 * - Anything else (another area from a wrong tile, or one that is not
 *   shared): refused.
 */
export function areaTransition(actor, to) {
  const from = actor.areaId
  if (to === from) {
    if (to === AREA.TOWN) return { kind: TRANSITION.RECALL, arrival: ARRIVALS[AREA.TOWN] }
    if (isWalkable(from, actor.tx, actor.ty)) return { kind: TRANSITION.RESYNC, arrival: null }
    return ARRIVALS[from] ? { kind: TRANSITION.RESYNC, arrival: ARRIVALS[from] } : null
  }
  if (portalAt(from, actor.tx, actor.ty) === to) {
    const arrival = arrivalFor(to, from)
    return arrival ? { kind: TRANSITION.PORTAL, arrival } : null
  }
  if (to === AREA.TOWN) return { kind: TRANSITION.RECALL, arrival: arrivalFor(AREA.TOWN, from) }
  return null
}

/**
 * Whether one step is allowed by the shared collision of the actor's area:
 * the target tile must be walkable (`world/navigation.js`). Every shared area
 * is validated since CAVES-4, and the browser collides with the same tiles.
 */
export function stepAllowed(actor, direction) {
  const [dx, dy] = STEP_DELTA[direction]
  return isWalkable(actor.areaId, actor.tx + dx, actor.ty + dy)
}
