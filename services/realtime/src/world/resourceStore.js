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
      actionEndsAt: mutable.actionEndsAt ?? null,
      respawnAt: mutable.respawnAt ?? null,
      version: ++this.revision,
    }
    const key = chunkKey(node.areaId, node.chunkId)
    if (record.state === lifecycle.initial && record.actionId === null) {
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

  /** Non-base records of one chunk: what a client entering it must be told. */
  inChunk(areaId, chunkId) {
    const ids = this.#byChunk.get(chunkKey(areaId, chunkId))
    return ids ? [...ids].map(id => this.#records.get(id)) : []
  }

  get size() {
    return this.#records.size
  }
}

export function chunkKey(areaId, chunkId) {
  return `${areaId}|${chunkId}`
}
