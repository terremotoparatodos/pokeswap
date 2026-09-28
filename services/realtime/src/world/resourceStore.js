import { isPartial } from './nodeStock.js'
import { lifecycleFor } from './resourceLifecycle.js'

/**
 * Mutable resource state — sparse, in memory (WORLD-1B).
 *
 * The base layout is derived, never stored. A record exists only while a node
 * is somewhere other than its base state (working, depleted, …); returning to
 * base deletes it. That keeps memory proportional to what players are doing,
 * not to the size of an infinite world.
 *
 * `version` comes from one monotonic counter for the whole world, so a client
 * can drop any change older than what it holds for that node — including one
 * that arrives after the node went back to base and its record was deleted.
 */
export class ResourceStore {
  #records = new Map()
  #byChunk = new Map()
  revision = 0

  /** The record for a node, or null when the node is in its base state. */
  get(id) {
    return this.#records.get(id) ?? null
  }

  /** Current state of a layout node, stored or derived. */
  stateOf(node) {
    return this.#records.get(node.id)?.state ?? lifecycleFor(node.resourceKind).initial
  }

  /**
   * Writes the node's next state. `mutable` replaces the previous mutable
   * fields entirely, so nothing from an earlier action can leak into the next.
   * Returns the record as written (deleted records are still returned, with
   * their final version, so the change can be published).
   */
  write(node, mutable) {
    const lifecycle = lifecycleFor(node.resourceKind)
    const record = {
      id: node.id, resourceKind: node.resourceKind, variantId: node.variantId, areaId: node.areaId,
      chunkId: node.chunkId, tx: node.tx, ty: node.ty, zone: node.zone, biome: node.biome,
      state: mutable.state,
      worker: mutable.worker ?? null,
      actionId: mutable.actionId ?? null,
      workKind: mutable.workKind ?? null,
      workedFrom: mutable.workedFrom ?? null,
      actionStartedAt: mutable.actionStartedAt ?? null,
      respawnAt: mutable.respawnAt ?? null,
      plot: mutable.plot ?? null,
      // YIELD-2, PRIVATE (never projected): units left on a partial node and its
      // generation token (the last settlement id applied to it).
      stock: mutable.stock ?? null,
      token: mutable.token ?? null,
      // YIELD-2, public while working: when the worker's last unit was confirmed (a flash for everyone).
      lastYieldAt: mutable.lastYieldAt ?? null,
      version: ++this.revision,
    }
    const key = chunkKey(node.areaId, node.chunkId)
    // Back to base: the record goes away and viewers are told so explicitly,
    // so no client has to know which state is "base" for which kind. A partial
    // node (available + stock) is NOT base: its stock is kept, privately.
    record.base = record.state === lifecycle.initial && record.actionId === null && record.plot === null && record.stock === null
    if (record.base) {
      this.#records.delete(node.id)
      const ids = this.#byChunk.get(key)
      ids?.delete(node.id)
      if (ids?.size === 0) this.#byChunk.delete(key)
    } else {
      this.#records.set(node.id, record)
      let ids = this.#byChunk.get(key)
      if (!ids) { ids = new Set(); this.#byChunk.set(key, ids) }
      ids.add(node.id)
    }
    return record
  }

  /**
   * Non-base records of one chunk: what a client entering it must be told.
   * Partial nodes are private (YIELD-2): to a viewer they are base, so they
   * are left out — listing them would reveal that a node has stock taken.
   */
  inChunk(areaId, chunkId) {
    const ids = this.#byChunk.get(chunkKey(areaId, chunkId))
    return ids ? [...ids].map(id => this.#records.get(id)).filter(record => !isPartial(record)) : []
  }

  /**
   * Drops a record without a new version and without anything to publish: a
   * partial node refilling (YIELD-2). To every viewer it was already base.
   */
  forget(node) {
    const key = chunkKey(node.areaId, node.chunkId)
    this.#records.delete(node.id)
    const ids = this.#byChunk.get(key)
    ids?.delete(node.id)
    if (ids?.size === 0) this.#byChunk.delete(key)
  }

  get size() {
    return this.#records.size
  }

  /** How many stored (non-base) records are in each state, e.g. `{ depleted: 3, planted: 1 }`. */
  countByState() {
    const counts = {}
    for (const record of this.#records.values()) counts[record.state] = (counts[record.state] ?? 0) + 1
    return counts
  }
}

export function chunkKey(areaId, chunkId) {
  return `${areaId}|${chunkId}`
}
