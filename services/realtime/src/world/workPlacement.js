import { worldArea } from './areas.js'
import { PLOTS } from './plots.js'
import { resourceAt } from './resourceLayout.js'
import { isSolidTile, isWaterTile } from './terrain.js'

/**
 * Where the worker and its trainer stand while a node is worked (WORLD VISUAL-2).
 *
 * The Pokémon takes the tile the trainer validly worked from, facing the
 * node; the trainer steps one tile away from the node to make room:
 * 1. straight back, away from the node;
 * 2. otherwise to a side of its tile — south before north, east before west
 *    (the fixed order WORLD uses everywhere);
 * 3. otherwise there is no room: null, and the attempt is refused.
 *
 * Pure and deterministic: node, validated trainer tile and a terrain
 * predicate in, the same answer for every server run. Visual placement only:
 * it grants nothing and changes no reward, reach or timing.
 */

const DIR = Object.freeze({ '0,1': 'down', '0,-1': 'up', '1,0': 'right', '-1,0': 'left' })

/**
 * @param {{ tx: number, ty: number }} node
 * @param {{ tx: number, ty: number }} trainer orthogonally beside the node (the reach rule)
 * @param {(tx: number, ty: number) => boolean} isOpen where the trainer may wait
 * @returns {{ stand: { tx: number, ty: number, dir: string }, wait: { tx: number, ty: number, dir: string } } | null}
 */
export function workPlacement(node, trainer, isOpen) {
  const dx = trainer.tx - node.tx
  const dy = trainer.ty - node.ty
  if (Math.abs(dx) + Math.abs(dy) !== 1) return null
  const facing = DIR[`${-dx},${-dy}`]
  const sides = dx === 0 ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1]]
  for (const [ox, oy] of [[dx, dy], ...sides]) {
    const wait = { tx: trainer.tx + ox, ty: trainer.ty + oy }
    if (isOpen(wait.tx, wait.ty)) return { stand: { tx: trainer.tx, ty: trainer.ty, dir: facing }, wait: { ...wait, dir: facing } }
  }
  return null
}

/**
 * Tiles of `areaId` a trainer may wait on, from the shared terrain alone: not
 * a solid prop, not water, not another resource node or farm plot. Areas the
 * world does not model offer none. Client-placed objects are unknown here.
 */
export function standableTile(areaId) {
  const area = worldArea(areaId)
  if (!area?.procedural) return () => false
  return (tx, ty) => !isSolidTile(area.seed, tx, ty) && !isWaterTile(area.seed, tx, ty)
    && !resourceAt(areaId, tx, ty) && !PLOTS.some(plot => plot.areaId === areaId && plot.tx === tx && plot.ty === ty)
}
