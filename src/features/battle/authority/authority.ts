// The server's copy of the truth (R32.4).
//
// One battle, one authority. It owns the seed, the clock and the canonical
// state; it runs Shared Battle Rules — the same module a client runs, not a
// second implementation — and it is the only thing in PokeSwap allowed to say
// what happened in a fight.
//
// The shape is deliberately the one R30 proved with `PresenceRoom`:
//
//     client intent → validate → authoritative reduction → events + snapshot
//
// and the four things that make it authoritative rather than decorative:
//
//   **the clock is ours.** `tick()` reads `AuthorityClock` and hands the rules
//   the elapsed milliseconds. No delta ever arrives from a client, so there is
//   nothing to lie about. A submission executes at the battle time the last
//   tick established; the room loop ticks before it drains its messages, which
//   is an ordinary fixed-step game loop and not a subtlety.
//
//   **the seed is ours.** Picked once, at creation, from `AuthoritySeedSource`,
//   and never exposed (`snapshot.ts`).
//
//   **every id is checked against who is asking.** The `actionId` namespace,
//   the acting combatant, the target. A controller acts for its own Pokémon or
//   it does not act.
//
//   **an action runs once.** The ledger and its floor (`idempotency.ts`).
//
// What is deliberately *not* here (§37): no Supabase, no inventory, no
// ownership, no loot, no capture persistence, no dungeon, no matchmaking, no
// AI. This is the floor those stand on.

import { BATTLE_RULES_VERSION, createBattleState, currentTargetOf, reduceBattle } from '../rules'
import type {
  BattleCommand, BattleEvent, BattleRulesCatalog, BattleRulesConfig, BattleSideInput, BattleState,
} from '../rules'
import { parseActionId } from './actionId'
import type { ParsedActionId } from './actionId'
import type { AuthorityClock } from './clock'
import { createIdempotencyLedger } from './idempotency'
import type { IdempotencyLedger } from './idempotency'
import { createAuthorityItemCatalog } from './itemCatalog'
import type { AuthorityItemCatalog } from './itemCatalog'
import { REJECTION } from './protocol'
import type {
  AuthorityEventEnvelope, AuthorityRejected, AuthoritySubmitResult, BattleIntent, RejectionReason,
  TransportAction,
} from './protocol'
import type { AuthoritySeedSource } from './seed'
import { projectClientSnapshot } from './snapshot'
import type { ClientBattleSnapshot } from './snapshot'
import { validateTransportAction } from './validate'

/**
 * The canonical state, RNG included.
 *
 * It never leaves the server. Everything a client is shown goes through
 * `projectClientSnapshot`, and the difference between these two types is the
 * whole of §22.
 */
export interface InternalAuthoritativeBattleState {
  readonly battleId: string
  readonly revision: number
  readonly serverTimeMs: number
  /** The clock reading the battle started at; battle time is measured from it. */
  readonly startedAtMs: number
  /** Shared Battle Rules' own state. Carries `rng`. */
  readonly state: BattleState
  readonly controls: Readonly<Record<string, readonly string[]>>
}

/** Which versions this build of the server will run. Never negotiated downward. */
export interface SupportedVersions {
  readonly catalogVersions: readonly string[]
  readonly battleRulesVersions: readonly string[]
}

export interface CreateBattleAuthorityInput {
  readonly battleId: string
  /** Exactly the rules' side input, minus the seed: that one is not the caller's. */
  readonly sides: readonly BattleSideInput[]
  readonly catalog: BattleRulesCatalog
  readonly clock: AuthorityClock
  readonly seedSource: AuthoritySeedSource
  readonly config?: BattleRulesConfig
  readonly items?: AuthorityItemCatalog
  readonly ledger?: IdempotencyLedger
  /** Defaults to what this build ships. A test narrows it to prove a mismatch. */
  readonly supported?: SupportedVersions
}

export interface BattleAuthority {
  readonly battleId: string
  /** Canonical, monotonic, and what a stale snapshot is detected against. */
  revision(): number
  /** What a client may see. Never contains the RNG. */
  snapshot(): ClientBattleSnapshot
  /**
   * Advances the battle to the server's clock and returns what happened.
   *
   * Idempotent in the sense that matters: called twice with no time passed, it
   * does nothing the second time. Slicing does not change the outcome either —
   * that is R32.3's `ADVANCE_TIME` contract, inherited here.
   */
  tick(): readonly AuthorityEventEnvelope[]
  /**
   * Takes one untrusted payload from a named controller.
   *
   * `controllerId` comes from the **transport's** authentication — in R30 that
   * is `supabaseAuth.js` — and never from the payload. Nothing a client writes
   * can change who it is.
   */
  submit(controllerId: string, payload: unknown): AuthoritySubmitResult
  /** Server-side only, for a room, a test and a future audit log. */
  internal(): InternalAuthoritativeBattleState
  /** Who may act for whom. */
  controls(): Readonly<Record<string, readonly string[]>>
  /**
   * The highest `actionId` sequence this controller has had accepted, or `0`.
   *
   * A reconnecting client — a reload, a second tab, a dropped socket — starts
   * counting from scratch, and its `controller:1` would land under the floor
   * and come back `STALE_ACTION`. So the join handshake tells it where to
   * resume, and the counter is a **continuation** rather than a fresh count.
   * Resetting the floor instead would throw away the dedupe window, which is
   * exactly what a reconnect must not do.
   */
  acceptedFloor(controllerId: string): number
}

const buildControls = (state: BattleState): Record<string, readonly string[]> => {
  const controls: Record<string, string[]> = {}
  for (const side of state.sides) {
    // A `null` controller is the wild side: server-owned, and no client's.
    if (side.controllerId === null) continue
    const owned = controls[side.controllerId] ?? (controls[side.controllerId] = [])
    owned.push(...side.partyIds)
  }
  return controls
}

export function createBattleAuthority(input: CreateBattleAuthorityInput): BattleAuthority {
  const supported = input.supported ?? {
    catalogVersions: [input.catalog.catalogVersion],
    battleRulesVersions: [BATTLE_RULES_VERSION],
  }
  // Refused at creation, loudly. A server that starts a battle on a catalog it
  // cannot run would only find out three actions later, inside a reducer, with
  // the fight already on screen.
  if (!supported.catalogVersions.includes(input.catalog.catalogVersion)) {
    throw new Error(`catalog ${input.catalog.catalogVersion} is not supported by this server`)
  }
  if (!supported.battleRulesVersions.includes(BATTLE_RULES_VERSION)) {
    throw new Error(`battle rules ${BATTLE_RULES_VERSION} are not supported by this server`)
  }

  const items = input.items ?? createAuthorityItemCatalog()
  const ledger = input.ledger ?? createIdempotencyLedger()
  const context = { catalog: input.catalog }
  const startedAtMs = input.clock.nowMs()

  let state = createBattleState({
    battleId: input.battleId,
    // The one place a seed is chosen, and the client is not in the room for it.
    seed: input.seedSource.createSeed(),
    sides: input.sides,
    catalog: input.catalog,
    config: input.config,
  })
  const controls = buildControls(state)
  let revision = 0
  let sequence = 0
  let serverTimeMs = startedAtMs

  const envelope = (event: BattleEvent, actionId: string | null): AuthorityEventEnvelope => ({
    battleId: input.battleId,
    sequence: (sequence += 1),
    revision,
    actionId,
    serverTimeMs,
    event,
  })

  const snapshot = (): ClientBattleSnapshot =>
    projectClientSnapshot(state, { revision, serverTimeMs, controls })

  const reject = (
    reason: RejectionReason, detail: string, actionId: string | null,
  ): AuthorityRejected => ({ kind: 'rejected', reason, actionId, revision, detail })

  /**
   * Runs a command and commits it — or does not.
   *
   * `reduceBattle` returns the **same state object** when it refuses, and that
   * is what this reads: an untouched state is a refusal, and a refusal neither
   * advances the revision nor enters the ledger (§20). A refusal the rules
   * made is still a rejection at this boundary — the client asked for
   * something the rules do not allow, and it should hear a code.
   */
  function commit(command: BattleCommand, actionId: string | null): {
    events: AuthorityEventEnvelope[]
    refused: BattleEvent | null
  } {
    const step = reduceBattle(state, command, context)
    if (step.state === state) {
      return { events: [], refused: step.events.find(e => e.type === 'COMMAND_REJECTED') ?? null }
    }
    state = step.state
    revision += 1
    return { events: step.events.map(event => envelope(event, actionId)), refused: null }
  }

  function tick(): readonly AuthorityEventEnvelope[] {
    const now = input.clock.nowMs()
    const deltaMs = Math.floor(now - serverTimeMs)
    if (deltaMs <= 0) return []
    serverTimeMs = now
    // The rules refuse a finished battle's clock quietly; `commit` reads that
    // as "nothing happened", which is exactly right.
    return commit({ type: 'ADVANCE_TIME', deltaMs }, null).events
  }

  function toCommand(
    intent: BattleIntent, owned: readonly string[],
  ): RejectionReason | { readonly command: BattleCommand } {
    switch (intent.kind) {
      case 'useMove': {
        if (intent.targetId !== undefined) {
          const target = currentTargetOf(state, intent.combatantId)
          // Aiming at something the rules would not hit means the client is
          // looking at a different battle than the server is.
          if (!target || target.combatantId !== intent.targetId) return REJECTION.INVALID_TARGET
        }
        return { command: { type: 'USE_MOVE', combatantId: intent.combatantId, moveId: intent.moveId } }
      }
      case 'switch': {
        // Its own bench, or nobody's. The rules check the side as well; this
        // check is the one that survives a controller owning two sides.
        if (!owned.includes(intent.incomingId)) return REJECTION.NOT_CONTROLLER
        return {
          command: { type: 'SWITCH', combatantId: intent.combatantId, incomingId: intent.incomingId },
        }
      }
      case 'useItem': {
        if (!owned.includes(intent.targetId)) return REJECTION.NOT_CONTROLLER
        const effect = items.itemEffect(intent.item.itemId, intent.item.moveId ?? null)
        // The amount is the server's. A client naming an item we do not stock
        // gets nothing, rather than the effect it proposed.
        if (!effect) return REJECTION.INVALID_SCHEMA
        return {
          command: {
            type: 'USE_ITEM', combatantId: intent.combatantId, targetId: intent.targetId, item: effect,
          },
        }
      }
      case 'capture': {
        if (!state.combatants[intent.targetId]) return REJECTION.INVALID_TARGET
        // Capturing something you already command is not a capture, and R35
        // will read ownership off exactly this line.
        if (owned.includes(intent.targetId)) return REJECTION.INVALID_TARGET
        const ball = items.ball(intent.ballId)
        if (!ball) return REJECTION.INVALID_SCHEMA
        return {
          command: {
            type: 'CAPTURE', combatantId: intent.combatantId, targetId: intent.targetId, ball,
          },
        }
      }
      case 'clearSelection':
        return { command: { type: 'CLEAR_SELECTION', combatantId: intent.combatantId } }
    }
  }

  /** Context-dependent checks: everything `validate.ts` could not know alone. */
  function authorize(
    controllerId: string, action: TransportAction, parsed: ParsedActionId,
  ): RejectionReason | { readonly command: BattleCommand } {
    if (parsed.controllerId !== controllerId) return REJECTION.NOT_CONTROLLER
    if (action.battleId !== input.battleId) return REJECTION.UNKNOWN_BATTLE
    if (!supported.catalogVersions.includes(action.catalogVersion)) return REJECTION.INVALID_VERSION
    if (action.catalogVersion !== state.catalogVersion) return REJECTION.INVALID_VERSION
    if (!supported.battleRulesVersions.includes(action.battleRulesVersion)) return REJECTION.INVALID_VERSION
    if (action.battleRulesVersion !== state.battleRulesVersion) return REJECTION.INVALID_VERSION
    if (state.outcome.kind !== 'ongoing') return REJECTION.BATTLE_FINISHED

    const owned = controls[controllerId] ?? []
    if (!owned.includes(action.intent.combatantId)) return REJECTION.NOT_CONTROLLER
    return toCommand(action.intent, owned)
  }

  function submit(controllerId: string, payload: unknown): AuthoritySubmitResult {
    const validation = validateTransportAction(payload)
    if (!validation.ok) return reject(validation.reason, validation.detail, null)
    const action = validation.action
    const parsed = parseActionId(action.actionId)
    if (!parsed) return reject(REJECTION.INVALID_ACTION_ID, 'unreadable actionId', null)

    // Before anything else is spent: an action we already ran is answered from
    // the ledger and never reaches the rules a second time.
    const remembered = ledger.recall(action.actionId)
    if (remembered) {
      return {
        kind: 'duplicate',
        actionId: remembered.actionId,
        revision: remembered.revision,
        events: remembered.events,
        snapshot: snapshot(),
      }
    }
    // Evicted, or simply late. Either way this controller has had a later
    // action accepted, so running this one would undo a decision it has moved
    // on from — and if it *was* the evicted original, running it would double
    // it. This is what lets the ledger be bounded at all.
    if (parsed.controllerId === controllerId && parsed.sequence <= ledger.acceptedFloor(controllerId)) {
      return reject(
        REJECTION.STALE_ACTION,
        'a later action from this controller was already accepted',
        action.actionId,
      )
    }

    const authorized = authorize(controllerId, action, parsed)
    if (typeof authorized === 'string') {
      return reject(authorized, 'the authority refused this action', action.actionId)
    }

    const { events, refused } = commit(authorized.command, action.actionId)
    if (refused) {
      return reject(
        REJECTION.ACTION_NOT_ALLOWED,
        refused.type === 'COMMAND_REJECTED' ? refused.reason : 'the rules refused this command',
        action.actionId,
      )
    }
    ledger.remember(parsed, { actionId: action.actionId, revision, events })
    return { kind: 'accepted', actionId: action.actionId, revision, events, snapshot: snapshot() }
  }

  return {
    battleId: input.battleId,
    revision: () => revision,
    snapshot,
    tick,
    submit,
    controls: () => controls,
    acceptedFloor: controllerId => ledger.acceptedFloor(controllerId),
    internal: () => ({ battleId: input.battleId, revision, serverTimeMs, startedAtMs, state, controls }),
  }
}
