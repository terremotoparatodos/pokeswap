// PRE-WORLD STAND-IN. How many more actions a node allows, and when it is back.
//
// WORLD-1 owns depletion and respawn for everyone who sees a node. Until then
// the playtest client keeps a per-session ledger so trees still fall and rocks
// still empty. Pure: every function returns a new ledger.

import type { ResourceDefinition } from '../domain/resources'

export interface NodeCharge {
  /** Actions taken since the node was last full. */
  readonly used: number
  /** Charges this node had when it was last full (rolled once per cycle). */
  readonly capacity: number
  /** When the node emptied; null while it still has charges. */
  readonly depletedAt: number | null
}

export type ChargeLedger = ReadonlyMap<string, NodeCharge>

/** Deterministic capacity in [min, max] for a node, so a reload does not reshuffle it. */
export function capacityOf(nodeId: string, resource: ResourceDefinition): number {
  const [min, max] = resource.world.charges
  let hash = 0
  for (let i = 0; i < nodeId.length; i++) hash = (hash * 31 + nodeId.charCodeAt(i)) >>> 0
  return min + (hash % (max - min + 1))
}

function current(ledger: ChargeLedger, nodeId: string, resource: ResourceDefinition, now: number): NodeCharge | null {
  const charge = ledger.get(nodeId)
  if (!charge) return null
  if (charge.depletedAt !== null && now - charge.depletedAt >= resource.world.respawnSeconds * 1000) return null
  return charge
}

export function remainingCharges(ledger: ChargeLedger, nodeId: string, resource: ResourceDefinition, now: number): number {
  const charge = current(ledger, nodeId, resource, now)
  return charge ? Math.max(0, charge.capacity - charge.used) : capacityOf(nodeId, resource)
}

export function respawnInSeconds(ledger: ChargeLedger, nodeId: string, resource: ResourceDefinition, now: number): number {
  const charge = current(ledger, nodeId, resource, now)
  if (!charge || charge.depletedAt === null) return 0
  return Math.max(0, Math.ceil((charge.depletedAt + resource.world.respawnSeconds * 1000 - now) / 1000))
}

/** Uses one charge; null when the node has none left. */
export function consumeCharge(ledger: ChargeLedger, nodeId: string, resource: ResourceDefinition, now: number): ChargeLedger | null {
  const charge = current(ledger, nodeId, resource, now) ?? { used: 0, capacity: capacityOf(nodeId, resource), depletedAt: null }
  if (charge.used >= charge.capacity) return null
  const used = charge.used + 1
  const next = new Map(ledger)
  next.set(nodeId, { ...charge, used, depletedAt: used >= charge.capacity ? now : null })
  return next
}
