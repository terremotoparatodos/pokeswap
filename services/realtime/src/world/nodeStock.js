import { randomInt } from 'node:crypto'
import { RESPAWN_MS } from './resourceLayout.js'

/**
 * RESOURCE YIELD-2: a gathered node's hidden stock, and the identifiers and
 * database contract of its units. Pure helpers; the authority owns the state.
 *
 * A SEQUENCE is one reservation of a node (one base `actionId`, private to the
 * server). It yields units, each settled on its own with
 * `settlementId = <actionId>-<hex2 index>`; the database keeps the last one
 * applied as the node's GENERATION TOKEN (world_node_overrides.action_id).
 *
 * Stock lives only on the server: a partial node is private (never projected,
 * never in a snapshot), and its refill instant (90 s after its last settled
 * unit) never travels either.
 */

/** Most units one sequence may settle (index 0..19). Stock is at most 4 today. */
export const MAX_UNITS = 20

/** How long a partial node keeps its stock after its last settled unit (then it is full again). */
export const REFILL_MS = RESPAWN_MS.tree

/** `settlementId` of unit `index` of sequence `actionId`. Stable: every retry of a unit uses the same id. */
export function settlementIdOf(actionId, index) {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_UNITS) throw new RangeError(`unit index ${index} out of [0, ${MAX_UNITS})`)
  return `${actionId}-${index.toString(16).padStart(2, '0')}`
}

/** Server randomness in [0, 1) that no client can predict. Tests inject a script instead. */
export function cryptoRandom() {
  return randomInt(0, 2 ** 32) / 2 ** 32
}

/** A new generation's stock: uniform in [min, max] (SKILLS' range), 1 when SKILLS gave none. */
export function drawStock(range, random = cryptoRandom) {
  if (!range) return 1
  const span = range.max - range.min + 1
  return range.min + Math.min(span - 1, Math.floor(random() * span))
}

/** A private partial node: available, with stock left, not reserved. */
export function isPartial(record) {
  return !!record && record.stock !== null && record.stock !== undefined && record.actionId === null
}

/**
 * Where the next sequence on this node starts from, at the reservation instant:
 * the live partial's token and stock, or a new generation (token null).
 * A partial whose refill instant has passed counts as absent (rule B).
 */
export function generationAt(record, reservedAt) {
  if (isPartial(record) && record.respawnAt !== null && record.respawnAt > reservedAt) {
    return { expectedToken: record.token, stockBefore: record.stock, fresh: false }
  }
  return { expectedToken: null, stockBefore: null, fresh: true }
}

/**
 * The node after unit `settlementId` takes one from `before`, and the p_node
 * world_commit_work receives. `endsAt` is the unit's end on WORLD's clock (the
 * same clock as `reservedAt`); the next refill or respawn counts from it.
 */
export function stockedUnit(node, { settlementId, before, expectedToken, reservedAt, endsAt }) {
  const after = before - 1
  const next = after > 0
    ? { state: 'available', stock: after, token: settlementId, respawnAt: endsAt + REFILL_MS }
    : { state: 'depleted', stock: null, token: settlementId, respawnAt: endsAt + RESPAWN_MS[node.resourceKind] }
  const world = {
    nodeId: node.id, areaId: node.areaId, chunkId: node.chunkId, plot: null, base: false,
    state: next.state, respawnAt: next.respawnAt,
    stock: { before, after }, expectedToken, reservedAt,
  }
  return { next, world }
}
