// Boss rewards: eligibility, personal loot and the full-inventory decision (D4).
//
// APPROVED: bosses drop rare loot; in co-op the loot is PERSONAL, so nobody
// competes for the single rare drop — every eligible player gets their own
// roll; and if a reward does not fit in the inventory it must **not** be
// destroyed: the player decides.
//
// SERVER AUTHORITY: every roll here changes persistent value, so the server
// owns the RNG, the eligibility verdict and the escrow. This module is the
// contract and the client-side preview of it.

import { streamFor, type Rng } from './rng'

export type LootRarity = 'common' | 'rare' | 'veryRare'

export interface LootEntry {
  readonly itemId: string
  readonly name: string
  readonly rarity: LootRarity
  readonly quantity: number
  readonly weight: number
}

export interface LootTable {
  readonly id: string
  readonly entries: readonly LootEntry[]
}

// ── Participation ──────────────────────────────────────────────────────────

export interface ParticipationInput {
  readonly playerId: string
  readonly damage: number
  /** Actions resolved during the fight: attacks, items, switches. */
  readonly actions: number
  /** Seconds with at least one Pokémon on the field. */
  readonly activeSeconds: number
  readonly presentAtKill: boolean
}

export interface ParticipationRule {
  readonly minDamageShare: number
  readonly minActions: number
  readonly minActiveSeconds: number
}

/**
 * PROTOTYPE ASSUMPTION. The rule has to stop "walk in, stand still, collect"
 * without punishing a support role that does little damage — and support does
 * not exist yet, which is exactly why the rule is deliberately generous: be
 * present at the kill **and** either have done a meaningful share of the damage
 * or have actually acted. When healing and support land, `actions` and
 * `activeSeconds` are where they plug in.
 */
export const DEFAULT_PARTICIPATION: ParticipationRule = {
  minDamageShare: 0.05, minActions: 3, minActiveSeconds: 10,
}

export interface Eligibility {
  readonly playerId: string
  readonly eligible: boolean
  readonly damageShare: number
  readonly reason: 'ok' | 'absent' | 'inactive'
}

export function participation(
  players: readonly ParticipationInput[], rule: ParticipationRule = DEFAULT_PARTICIPATION,
): Eligibility[] {
  const total = players.reduce((sum, player) => sum + Math.max(0, player.damage), 0)
  return players.map(player => {
    const damageShare = total > 0 ? player.damage / total : 0
    if (!player.presentAtKill) return { playerId: player.playerId, eligible: false, damageShare, reason: 'absent' }
    const contributed = damageShare >= rule.minDamageShare
      || (player.actions >= rule.minActions && player.activeSeconds >= rule.minActiveSeconds)
    return {
      playerId: player.playerId,
      eligible: contributed,
      damageShare: Math.round(damageShare * 1000) / 1000,
      reason: contributed ? 'ok' : 'inactive',
    }
  })
}

// ── Personal loot ──────────────────────────────────────────────────────────

function rollEntry(table: LootTable, rng: Rng): LootEntry | null {
  const total = table.entries.reduce((sum, entry) => sum + entry.weight, 0)
  if (total <= 0) return null
  let roll = rng.next() * total
  for (const entry of table.entries) {
    roll -= entry.weight
    if (roll <= 0) return entry
  }
  return table.entries[table.entries.length - 1] ?? null
}

export interface PersonalReward {
  readonly playerId: string
  readonly entry: LootEntry | null
}

/**
 * One independent roll per eligible player, each from its own stream keyed by
 * the player id — so two players in the same fight neither share nor influence
 * each other's result, and a replay of the same expedition reproduces both.
 */
export function personalLoot(
  seed: number, expeditionId: string, eligible: readonly Eligibility[], table: LootTable,
): PersonalReward[] {
  return eligible
    .filter(player => player.eligible)
    .map(player => ({
      playerId: player.playerId,
      entry: rollEntry(table, streamFor(seed, 'bossLoot', expeditionId, player.playerId)),
    }))
}

// ── Full inventory ─────────────────────────────────────────────────────────

export type PendingDecision = 'keep' | 'discardOther' | 'discardReward'

export interface PendingReward {
  readonly id: string
  readonly playerId: string
  readonly entry: LootEntry
  readonly reason: 'inventory-full'
}

export interface DeliveryResult {
  readonly delivered: readonly PersonalReward[]
  /** Held in escrow until the player answers. Nothing is ever destroyed here. */
  readonly pending: readonly PendingReward[]
}

/**
 * Hands out what fits and escrows what does not. `freeSlots` is how many slots
 * that player has left; a reward that does not fit becomes a pending decision
 * instead of vanishing.
 */
export function deliverRewards(
  rewards: readonly PersonalReward[], freeSlots: Readonly<Record<string, number>>,
): DeliveryResult {
  const delivered: PersonalReward[] = []
  const pending: PendingReward[] = []
  const slots = { ...freeSlots }
  for (const reward of rewards) {
    if (!reward.entry) continue
    const available = slots[reward.playerId] ?? 0
    if (available > 0) {
      slots[reward.playerId] = available - 1
      delivered.push(reward)
    } else {
      pending.push({
        id: `${reward.playerId}:${reward.entry.itemId}`,
        playerId: reward.playerId,
        entry: reward.entry,
        reason: 'inventory-full',
      })
    }
  }
  return { delivered, pending }
}

export interface ResolvedPending {
  readonly pending: readonly PendingReward[]
  readonly granted: LootEntry | null
  /** True when the player chose to make room; the UI then asks what to drop. */
  readonly needsDiscard: boolean
}

/** The player answers the "inventory lleno" prompt. */
export function resolvePending(
  pending: readonly PendingReward[], id: string, decision: PendingDecision,
): ResolvedPending {
  const target = pending.find(entry => entry.id === id)
  const rest = pending.filter(entry => entry.id !== id)
  if (!target) return { pending, granted: null, needsDiscard: false }
  if (decision === 'discardReward') return { pending: rest, granted: null, needsDiscard: false }
  if (decision === 'discardOther') return { pending: rest, granted: target.entry, needsDiscard: true }
  // 'keep' leaves it in escrow: the reward survives until the player frees space.
  return { pending, granted: null, needsDiscard: false }
}
