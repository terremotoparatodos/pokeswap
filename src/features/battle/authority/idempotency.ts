// Remembering what already ran (R32.4).
//
// A websocket delivers at-most-once and a client retries, so the same action
// arrives twice all the time — a flaky link, a lost acknowledgement, a user
// hammering the button. Executing it twice spends the PP twice, deals the
// damage twice and, once R35 exists, captures the Pokémon twice. AGENTS §12
// already demands this of payments; a battle action is the same problem with
// a shorter fuse.
//
// Two structures, and the second is what makes the first safe to bound:
//
//   **the ledger** — `actionId` → what it produced. Bounded, FIFO. A hit is a
//   duplicate and the remembered result is replayed instead of the action.
//   **the floor** — per controller, the highest sequence ever accepted. It
//   only grows, and it costs one number per controller.
//
// An unbounded ledger is a memory leak with a battle attached; a bounded one
// alone would forget an old action and happily run it again. Together they
// cannot: an id old enough to have been evicted is, by construction, below its
// controller's floor, so it comes back as `STALE_ACTION` — refused, not
// re-executed. The bound costs recall, never correctness.
//
// In memory, per battle. No Redis, no database: R32.4 is the foundation those
// would sit on, and choosing one now would be choosing it without a load
// profile to choose it from.

import type { ParsedActionId } from './actionId'
import type { AuthorityEventEnvelope } from './protocol'

/** What one accepted action produced, kept so a retry can be answered. */
export interface RememberedAction {
  readonly actionId: string
  readonly revision: number
  readonly events: readonly AuthorityEventEnvelope[]
}

export interface IdempotencyLedger {
  /** The remembered result of an id, or `null` — unseen, or evicted. */
  recall(actionId: string): RememberedAction | null
  /** Records an accepted action and raises its controller's floor. */
  remember(parsed: ParsedActionId, entry: RememberedAction): void
  /**
   * The highest sequence ever accepted for a controller; `0` when none was.
   * Anything at or below it that the ledger no longer holds is superseded.
   */
  acceptedFloor(controllerId: string): number
  /** How many entries are held. For a test and for a future metric. */
  readonly size: number
}

export interface IdempotencyLedgerOptions {
  /**
   * How many accepted actions to remember. 256 is roughly a long fight's worth
   * of actions at R32.3's Action Bar, which is the window a retry realistically
   * arrives in; the floor covers everything older.
   */
  readonly maxEntries?: number
}

export function createIdempotencyLedger(options: IdempotencyLedgerOptions = {}): IdempotencyLedger {
  const maxEntries = Math.max(1, Math.floor(options.maxEntries ?? 256))
  // Insertion-ordered, which is what makes the first key the oldest one.
  const entries = new Map<string, RememberedAction>()
  const floors = new Map<string, number>()

  return {
    recall: actionId => entries.get(actionId) ?? null,
    remember(parsed, entry) {
      entries.set(entry.actionId, entry)
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next()
        if (oldest.done) break
        entries.delete(oldest.value)
      }
      const floor = floors.get(parsed.controllerId) ?? 0
      if (parsed.sequence > floor) floors.set(parsed.controllerId, parsed.sequence)
    },
    acceptedFloor: controllerId => floors.get(controllerId) ?? 0,
    get size() {
      return entries.size
    },
  }
}
