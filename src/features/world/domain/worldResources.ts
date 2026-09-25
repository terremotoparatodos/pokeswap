// Client mirror of the server's resource state (WORLD-1B).
//
// Holds only what the server sent for the chunks it said this client holds:
// nodes not in their base state. A node of a held chunk that is not here *is*
// in its base state — the server's snapshot and enter messages are complete
// for their chunks. A node of a chunk that is not held is unknown, never
// invented: leaving and re-entering a chunk always waits for the server.

import type { PublicNode, WorldBatch, WorldSnapshot } from '../../../../services/realtime/src/world/worldProtocol.js'
import { chunkOf } from '../../../../services/realtime/src/world/areas.js'

export type NodeView = PublicNode

export class WorldResourceMirror {
  areaId: string | null = null
  private readonly chunks = new Set<string>()
  private readonly nodes = new Map<string, NodeView>()
  /** Highest version seen per node, kept while its chunk is held: drops stale deltas. */
  private readonly versions = new Map<string, number>()
  /** Bumped on every change, so a renderer can skip work when nothing moved. */
  revision = 0

  applySnapshot(snapshot: WorldSnapshot): void {
    this.areaId = snapshot.areaId
    this.chunks.clear()
    this.nodes.clear()
    this.versions.clear()
    for (const chunk of snapshot.chunks) this.chunks.add(chunk)
    for (const node of snapshot.nodes) this.put(node)
    this.revision++
  }

  applyBatch(batch: WorldBatch): void {
    for (const chunk of batch.leave ?? []) this.dropChunk(chunk)
    for (const entry of batch.enter ?? []) {
      this.dropChunk(entry.chunk)
      this.chunks.add(entry.chunk)
      for (const node of entry.nodes) this.put(node)
    }
    for (const node of batch.nodes ?? []) {
      if (this.chunks.has(chunkOfId(node.id))) this.put(node)
    }
    this.revision++
  }

  clear(): void {
    this.areaId = null
    this.chunks.clear()
    this.nodes.clear()
    this.versions.clear()
    this.revision++
  }

  /** The node's non-base state; null when it is in its base state *or* unknown (see `knows`). */
  node(id: string): NodeView | null {
    return this.nodes.get(id) ?? null
  }

  /** Whether the server has told this client about the chunk of (tx, ty) in `areaId`. */
  knows(areaId: string, tx: number, ty: number): boolean {
    return this.areaId === areaId && this.chunks.has(chunkOf(tx, ty))
  }

  /** Every node currently away from its base state. */
  active(): IterableIterator<NodeView> {
    return this.nodes.values()
  }

  get heldChunks(): number {
    return this.chunks.size
  }

  get activeNodes(): number {
    return this.nodes.size
  }

  private put(node: NodeView): void {
    if ((this.versions.get(node.id) ?? -1) >= node.version) return
    this.versions.set(node.id, node.version)
    if (node.base) this.nodes.delete(node.id)
    else this.nodes.set(node.id, node)
  }

  private dropChunk(chunk: string): void {
    this.chunks.delete(chunk)
    for (const id of [...this.versions.keys()]) {
      if (chunkOfId(id) !== chunk) continue
      this.versions.delete(id)
      this.nodes.delete(id)
    }
  }
}

function chunkOfId(id: string): string {
  const [, tx, ty] = id.split(':')
  return chunkOf(Number(tx), Number(ty))
}
