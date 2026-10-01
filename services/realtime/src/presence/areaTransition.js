import { ARRIVALS, arrivalFor } from '../protocol/arrival.js'
import { isReachable, isWalkable, portalAt } from '../world/navigation.js'
import { STEP_DELTA } from './movement.js'

/**
 * How the service answers an `area` request (CAVES-3, generalised in CAVES-4).
 * The client only names an area; whether it may go and where it lands are
 * decided here, from the actor's real area and tile. It never moves the actor.
 *
 * There is no "Ciudad" recall: the town is reached through its portal like
 * every other area. Fast travel will be its own feature (unlocks, allowed
 * destinations, costs or cooldowns), not an exception here.
 */
export const TRANSITION = Object.freeze({
  /** Standing on a portal that leads to the requested area: crosses to its arrival. */
  PORTAL: 'portal',
  /** The client asked for the area it already is in (its safe-point repair): no move, just the real state. */
  RESYNC: 'resync',
})

/**
 * Returns `{ kind, arrival }`, or `null` when the request is refused.
 * `arrival` is where the actor lands, or `null` for a resync that keeps it.
 *
 * - Another area: only standing **exactly** on a portal of the actor's real
 *   area whose destination is that area — Ciudad ↔ Pradera by the west gate
 *   and the return pad, Pradera ↔ `cueva-inicial` by the mouth and the exit
 *   pad. It lands on the destination's arrival for that origin, never on a
 *   portal (no loop).
 * - The area the actor already is in (any of the three): a resync, which does
 *   not move it, unless its own tile stopped being a reachable walkable tile:
 *   then the area's arrival.
 * - Anything else — the town from anywhere but its portal (an old or forged
 *   "Ciudad" request), another area from a wrong tile, an area that is not
 *   shared: refused. The caller answers once with the real state.
 */
export function areaTransition(actor, to) {
  const from = actor.areaId
  if (to === from) {
    if (isReachable(from, actor.tx, actor.ty)) return { kind: TRANSITION.RESYNC, arrival: null }
    return ARRIVALS[from] ? { kind: TRANSITION.RESYNC, arrival: ARRIVALS[from] } : null
  }
  if (portalAt(from, actor.tx, actor.ty) === to) {
    const arrival = arrivalFor(to, from)
    return arrival ? { kind: TRANSITION.PORTAL, arrival } : null
  }
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
