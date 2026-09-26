import { worldArea } from './areas.js'
import { PLOTS } from './plots.js'
import { resourceAt } from './resourceLayout.js'
import { decorAt, isSolidTile, isWaterTile } from './terrain.js'

/**
 * Where a worker Pokémon stands while it works a node (WORLD VISUAL-1).
 *
 * Visual only: it decides no reward, no reach and no ownership. The server
 * picks it once, when it acquires the node, from facts every client already
 * trusts (the node, the trainer's validated tile at that instant, the terrain)
 * and publishes it with the worker. It is never recomputed: the trainer
 * walking around the node or disconnecting does not move the Pokémon.
 *
 * Rule, fully deterministic (no RNG, no other players):
 * 1. an open cardinal neighbour of the node, never the trainer's own tile.
 *    Ranked by: visible before hidden behind a tree canopy (a tree right
 *    below a tile is drawn over it — the node's own canopy hides its north
 *    side); then nearest the trainer (the two sides flanking the side it
 *    worked from, then the opposite side); then the fixed order below;
 * 2. none open → an open diagonal neighbour, ranked the same way;
 * 3. none open → the trainer's tile itself, which is walkable by definition.
 * Fixed order: south (drawn in front of the node), east, west, north. The
 * Pokémon always faces the node.
 */

/** [dx, dy, facing toward the node], in tie-break order. */
const CARDINAL = Object.freeze([[0, 1, 'up'], [1, 0, 'left'], [-1, 0, 'right'], [0, -1, 'down']])
/** Diagonals face along x: a side view reads as "working it" better than a back. */
const DIAGONAL = Object.freeze([[1, 1, 'left'], [-1, 1, 'right'], [1, -1, 'left'], [-1, -1, 'right']])

const chebyshev = (a, b) => Math.max(Math.abs(a.tx - b.tx), Math.abs(a.ty - b.ty))

/**
 * @param {{ tx: number, ty: number }} node
 * @param {{ tx: number, ty: number }} trainer the trainer's validated tile when the work was acquired
 * @param {(tx: number, ty: number) => boolean} isOpen dry, walkable, not another node
 * @param {(tx: number, ty: number) => boolean} [isHidden] drawn behind a prop in front of it
 * @returns {{ tx: number, ty: number, dir: 'up' | 'down' | 'left' | 'right' }}
 */
export function workerStand(node, trainer, isOpen, isHidden = () => false) {
  const rank = spot => (isHidden(spot.tx, spot.ty) ? 10 : 0) + chebyshev(spot, trainer)
  const best = offsets => {
    let pick = null
    for (const [dx, dy, dir] of offsets) {
      const spot = { tx: node.tx + dx, ty: node.ty + dy, dir }
      if ((spot.tx === trainer.tx && spot.ty === trainer.ty) || !isOpen(spot.tx, spot.ty)) continue
      // Strictly better wins; a tie keeps the earlier (fixed) order.
      if (!pick || rank(spot) < rank(pick)) pick = spot
    }
    return pick
  }
  return best(CARDINAL) ?? best(DIAGONAL) ?? { tx: trainer.tx, ty: trainer.ty, dir: facing(trainer, node) }
}

/** Dominant-axis direction from one tile toward another (x wins ties). */
function facing(from, to) {
  const dx = to.tx - from.tx
  const dy = to.ty - from.ty
  if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) return dx > 0 ? 'right' : 'left'
  return dy < 0 ? 'up' : 'down'
}

/**
 * Tiles a worker may stand on in `areaId`, from the shared terrain alone: not
 * a solid prop, not water, not another resource node or farm plot. Placed
 * client-side objects are unknown here (see WORLD_VISUAL_1_REPORT.md).
 */
export function standableTile(areaId) {
  const area = worldArea(areaId)
  if (!area?.procedural) return () => false
  return (tx, ty) => !isSolidTile(area.seed, tx, ty) && !isWaterTile(area.seed, tx, ty)
    && !resourceAt(areaId, tx, ty) && !PLOTS.some(plot => plot.areaId === areaId && plot.tx === tx && plot.ty === ty)
}

/** Props tall enough that their canopy covers the tile right above their own. */
const CANOPY = new Set(['tree', 'pine', 'snowpine', 'palm'])

/** Tiles of `areaId` a worker would be drawn behind: a tree stands right below them. */
export function hiddenBehindCanopy(areaId) {
  const area = worldArea(areaId)
  if (!area?.procedural) return () => false
  return (tx, ty) => CANOPY.has(decorAt(area.seed, tx, ty + 1))
}
