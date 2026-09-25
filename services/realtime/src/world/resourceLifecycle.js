/**
 * Resource node lifecycles (WORLD-1B).
 *
 * `working` is shared by every lifecycle: it is the state a node is in while a
 * reserved action runs on it, whatever the node is. Everything else is data
 * per resource kind:
 *
 * - `initial`: the base state. A node in its base state with no action is not
 *   stored at all — the layout already says it exists.
 * - `work`: the states an action may start from, and where a *completed*
 *   action leaves the node. A cancelled or failed action returns it to the
 *   state it started from.
 * - `timed`: states that change on their own at the node's timer, and to what.
 *
 * Trees and rocks: available → working → depleted → (respawn) → available.
 * A farming plot fits without touching the authority, e.g.
 * `{ initial: 'empty', work: { empty: 'planted', ready: 'empty' }, timed: { planted: 'ready' } }`
 * (exercised in resourceLifecycle.test.js, not placed in any world yet).
 */

export const WORKING = 'working'

export const NODE_STATE = Object.freeze({ AVAILABLE: 'available', WORKING, DEPLETED: 'depleted' })

export const SIMPLE_LIFECYCLE = Object.freeze({
  initial: 'available',
  work: Object.freeze({ available: 'depleted' }),
  timed: Object.freeze({ depleted: 'available' }),
})

/**
 * Farm plots (INTEGRATION-1). Every stage can host a farm action (plant, tend,
 * harvest — plots.js decides which, and whether this player may); the timed
 * stages advance by server timestamps.
 */
export const PLOT_LIFECYCLE = Object.freeze({
  initial: 'empty',
  work: Object.freeze({ empty: 'planted', planted: 'planted', growing: 'growing', ready: 'empty' }),
  timed: Object.freeze({ planted: 'growing', growing: 'ready' }),
})

const LIFECYCLES = Object.freeze({ tree: SIMPLE_LIFECYCLE, rock: SIMPLE_LIFECYCLE, plot: PLOT_LIFECYCLE })

export function lifecycleFor(resourceKind) {
  return Object.hasOwn(LIFECYCLES, resourceKind) ? LIFECYCLES[resourceKind] : null
}

export function canStartWork(lifecycle, state) {
  return Object.hasOwn(lifecycle.work, state)
}

/** Where a completed action started from `from` leaves the node. */
export function afterWork(lifecycle, from) {
  return Object.hasOwn(lifecycle.work, from) ? lifecycle.work[from] : null
}

/** The state a timed state turns into, or null when it is not timed. */
export function afterTimer(lifecycle, state) {
  return Object.hasOwn(lifecycle.timed, state) ? lifecycle.timed[state] : null
}
