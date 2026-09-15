// Personal node charges — the contention model for shared worlds.
//
// Every player sees the same node, but charges are counted per player, so
// nobody can camp or deny a node to others. The ledger is in-memory runtime
// state for the realtime authority: it is not persisted and not broadcast.

import type { GatheringNodeDefinition } from './types'

export interface ChargeWindow {
  readonly used: number
  readonly startedAt: number
}

export type ChargeLedger = ReadonlyMap<string, ChargeWindow>

export function chargeKey(nodeId: string, userId: string): string {
  return `${nodeId}|${userId}`
}

function activeCharge(ledger: ChargeLedger, key: string, node: GatheringNodeDefinition, now: number): ChargeWindow | null {
  const charge = ledger.get(key)
  return charge && now - charge.startedAt < node.respawnSeconds * 1000 ? charge : null
}

export function remainingCharges(ledger: ChargeLedger, nodeId: string, userId: string, node: GatheringNodeDefinition, now: number): number {
  const charge = activeCharge(ledger, chargeKey(nodeId, userId), node, now)
  return charge ? Math.max(0, node.personalCharges - charge.used) : node.personalCharges
}

/** Returns null when this player has depleted the node until it respawns. */
export function consumeCharge(
  ledger: ChargeLedger, nodeId: string, userId: string, node: GatheringNodeDefinition, now: number,
): { ledger: ChargeLedger; remaining: number } | null {
  const key = chargeKey(nodeId, userId)
  const charge = activeCharge(ledger, key, node, now)
  const used = charge?.used ?? 0
  if (used >= node.personalCharges) return null
  const next = new Map(ledger)
  next.set(key, { used: used + 1, startedAt: charge?.startedAt ?? now })
  return { ledger: next, remaining: node.personalCharges - used - 1 }
}

/** Drops charges older than the longest respawn; bounds memory on the server. */
export function pruneLedger(ledger: ChargeLedger, now: number, maxRespawnSeconds: number): ChargeLedger {
  const next = new Map<string, ChargeWindow>()
  for (const [key, charge] of ledger) if (now - charge.startedAt < maxRespawnSeconds * 1000) next.set(key, charge)
  return next
}
