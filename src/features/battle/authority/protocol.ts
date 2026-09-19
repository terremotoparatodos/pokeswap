// The wire contract of an authoritative battle (R32.4).
//
// Two vocabularies meet here and the whole point is that they never blur:
//
//   **intent**  what a client *asks for*. Untrusted, arrives as `unknown`,
//               carries no results — no damage, no HP, no roll, no capture
//               outcome, no elapsed time.
//   **truth**   what the server *decides*. Events, a revision and a snapshot,
//               produced by running Shared Battle Rules server-side.
//
// A client may say `USE_MOVE(combatantId, moveId, targetId)`. A client may not
// say "Thunderbolt dealt 73 damage": there is no field in this file that could
// carry it, which is the cheapest way to make it impossible.
//
// Everything here is plain JSON: no `Map`, no `Set`, no class, no function, no
// `Date`. It has to survive a websocket, and R30 already pays for that
// discipline in `services/realtime/src/protocol/messages.js`.

import type { BattleEvent } from '../rules'
import type { ClientBattleSnapshot } from './snapshot'

// ── What a client may ask for ───────────────────────────────────────────────

/**
 * The intents a client may send.
 *
 * `ADVANCE_TIME` is **not** here, and its absence is a rule: the clock belongs
 * to the server (`clock.ts`). A client cannot ask for time to pass any more
 * than it can ask for a critical hit.
 */
export type BattleIntent =
  | {
      readonly kind: 'useMove'
      readonly combatantId: string
      readonly moveId: number
      /**
       * **Mandatory** (A-3, closed), even though R32.3's baseline is 1 vs 1.
       *
       * The rules can derive the single opponent, and the authority refuses to
       * let them: a command whose shape depends on how many combatants are on
       * the field is a command that has to change when an Alpha or a co-op
       * fight arrives, and every caller changes with it. Making it mandatory
       * now costs one field and keeps the wire contract stable.
       *
       * It is not a formality either. A client that names its target is a
       * client the server can catch disagreeing with it — aiming at a Pokémon
       * that already fainted, or at one that switched out — instead of
       * silently attacking whoever happens to be there now.
       *
       * A self-targeted move names the user itself, explicitly. Nothing is
       * ever inferred (§7).
       */
      readonly targetId: string
    }
  | { readonly kind: 'switch'; readonly combatantId: string; readonly incomingId: string }
  | {
      readonly kind: 'useItem'
      readonly combatantId: string
      readonly targetId: string
      readonly item: BattleIntentItem
    }
  | {
      readonly kind: 'capture'
      readonly combatantId: string
      readonly targetId: string
      readonly ballId: string
    }
  | { readonly kind: 'clearSelection'; readonly combatantId: string }

export type BattleIntentKind = BattleIntent['kind']

/**
 * An item, as a client is allowed to describe it: *which* item, never what it
 * does. The authority looks the effect up (`items.ts`), so a client cannot
 * invent a potion that heals for nine thousand.
 */
export interface BattleIntentItem {
  readonly itemId: string
  /** Only for an Ether: which of the user's own moves to restore. */
  readonly moveId?: number
}

/** One submission, exactly as it comes off a socket: every field untrusted. */
export interface TransportAction {
  /** `<controllerId>:<sequence>`. See `actionId.ts`. */
  readonly actionId: string
  readonly battleId: string
  /** What the client believes it is running. Compared, never adopted. */
  readonly catalogVersion: string
  readonly battleRulesVersion: string
  readonly intent: BattleIntent
}

// ── Why the server said no ──────────────────────────────────────────────────

/**
 * Structured refusals. Codes, not sentences and not exceptions: a rejection is
 * an ordinary outcome of an untrusted boundary, and `throw` as a protocol
 * makes the common case look like a bug (AGENTS §19).
 */
export const REJECTION = {
  /** The payload is not shaped like a `TransportAction`. */
  INVALID_SCHEMA: 'INVALID_SCHEMA',
  /** Well-formed, but not an intent this server knows. */
  UNKNOWN_ACTION: 'UNKNOWN_ACTION',
  /** The `actionId` is not `<controllerId>:<positive integer>`. */
  INVALID_ACTION_ID: 'INVALID_ACTION_ID',
  /** Right shape, wrong battle. */
  UNKNOWN_BATTLE: 'UNKNOWN_BATTLE',
  /** The client's catalog or rules version is not one this server runs. */
  INVALID_VERSION: 'INVALID_VERSION',
  /** This controller does not command that combatant. */
  NOT_CONTROLLER: 'NOT_CONTROLLER',
  /** The target is not in this battle, or not a legal target for the intent. */
  INVALID_TARGET: 'INVALID_TARGET',
  /** Superseded: this controller already had a later action accepted. */
  STALE_ACTION: 'STALE_ACTION',
  /** The battle is decided; nothing more is accepted. */
  BATTLE_FINISHED: 'BATTLE_FINISHED',
  /** Shared Battle Rules refused it — no PP, unknown move, illegal switch. */
  ACTION_NOT_ALLOWED: 'ACTION_NOT_ALLOWED',
} as const

export type RejectionReason = (typeof REJECTION)[keyof typeof REJECTION]

// ── What the server sends back ──────────────────────────────────────────────

/**
 * A domain event with the transport metadata it needs to be ordered and
 * deduplicated on the far side.
 *
 * The `BattleEvent` inside is untouched R32.3: the envelope adds context, it
 * does not reinterpret the event. A client that wants to know what happened
 * reads the same event a test reads.
 */
export interface AuthorityEventEnvelope {
  readonly battleId: string
  /** Monotonic across the battle, over every event the authority ever emitted. */
  readonly sequence: number
  /** The canonical revision this event belongs to. */
  readonly revision: number
  /** The action that caused it, or `null` when the server's own clock did. */
  readonly actionId: string | null
  /** Server time, in ms since the epoch of the authority's clock. */
  readonly serverTimeMs: number
  readonly event: BattleEvent
}

/** Accepted: it ran, exactly once, and this is what it did. */
export interface AuthorityAccepted {
  readonly kind: 'accepted'
  readonly actionId: string
  readonly revision: number
  readonly events: readonly AuthorityEventEnvelope[]
  readonly snapshot: ClientBattleSnapshot
}

/**
 * Duplicate: the same `actionId` arrived again and **nothing** was executed a
 * second time. The events and the revision are the remembered ones; the
 * snapshot is current, because a client retrying wants to be caught up, not
 * shown a stale board.
 */
export interface AuthorityDuplicate {
  readonly kind: 'duplicate'
  readonly actionId: string
  /** The revision the original submission produced. */
  readonly revision: number
  readonly events: readonly AuthorityEventEnvelope[]
  readonly snapshot: ClientBattleSnapshot
}

/**
 * Rejected: nothing ran, nothing mutated, and the revision did not move.
 *
 * **Public and deliberately thin** (A-4, closed). It carries a stable code and
 * the two numbers a client needs to recover, and nothing else. The earlier
 * version carried a `detail` sentence straight from the validator, which is
 * two mistakes in one field: it tells whoever is probing the boundary exactly
 * which check they tripped, and it invites a client to match on prose that was
 * never a protocol. The sentence still exists — it goes to
 * `AuthorityDiagnostic`, server-side.
 */
export interface AuthorityRejected {
  readonly kind: 'rejected'
  readonly reason: RejectionReason
  /** The `actionId` when one could be read off the payload at all. */
  readonly actionId: string | null
  /** The canonical revision right now, so a client can tell how far behind it is. */
  readonly revision: number
  /**
   * Where to resume counting, on the rejections where a client cannot work it
   * out for itself — `STALE_ACTION` above all. It is the same number
   * `JoinAck` carries, and it is not a secret: it is this controller's own
   * counter, told to the controller it belongs to.
   */
  readonly nextActionSequence?: number
}

export type AuthoritySubmitResult = AuthorityAccepted | AuthorityDuplicate | AuthorityRejected

// ── Joining, and rejoining ──────────────────────────────────────────────────

/**
 * What a controller is told when it joins or rejoins (A-1, closed).
 *
 * A reconnecting client — a reload, a second tab, a dropped socket — starts
 * its counter at 1, and that `controller:1` lands under its own accepted
 * floor. Resetting the floor would fix it by throwing away the dedupe window,
 * which is precisely what a reconnect must not do: the actions in flight when
 * the socket died are the ones most likely to arrive twice.
 *
 * So the server tells the client where to resume. `nextActionSequence` is
 * `acceptedFloor + 1`, and the counter becomes a **continuation** rather than
 * a fresh count.
 *
 * This is per-controller handshake metadata and **not** part of
 * `ClientBattleSnapshot`: a snapshot describes the battle and goes to
 * everyone, while this describes one controller's own position in its own
 * sequence. Putting it in the snapshot would mean either sending every
 * controller's counter to every client, or a snapshot whose contents depend on
 * who asked — and a snapshot that is different per viewer is not a snapshot.
 *
 * R32.4 does not implement a handshake; it fixes the shape of one, and proves
 * that a client following it recovers. Delivering it is R34's.
 */
export interface JoinAck {
  readonly battleId: string
  readonly controllerId: string
  /** The canonical revision at the moment of the join. */
  readonly currentRevision: number
  /** `acceptedFloor + 1`. Where this controller's next `actionId` starts. */
  readonly nextActionSequence: number
  readonly catalogVersion: string
  readonly battleRulesVersion: string
  /** What this controller may act for. Empty when it commands nothing. */
  readonly controlledCombatantIds: readonly string[]
}

// ── What the server keeps to itself ─────────────────────────────────────────

/**
 * The detail a rejection used to leak (A-4, closed).
 *
 * Which check failed, on what, and why — the things that make an incident
 * readable at three in the morning, and exactly the things that make a
 * boundary easy to probe from outside. It stays server-side: a test reads it,
 * and a future observability layer will. It is never sent to a client, and it
 * is never written with `console.*` (AGENTS, R21).
 */
export interface AuthorityDiagnostic {
  readonly serverTimeMs: number
  /** Whoever the transport authenticated, when the rejection got that far. */
  readonly controllerId: string | null
  readonly actionId: string | null
  readonly reason: RejectionReason
  /** Which check refused it, as a short stable slug. */
  readonly check: string
  /** The sentence. Diagnostics, not a protocol: nothing may match on it. */
  readonly detail: string
}
