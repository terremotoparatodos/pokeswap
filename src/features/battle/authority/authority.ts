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
  AuthorityDiagnostic, AuthorityEventEnvelope, AuthorityRejected, AuthoritySubmitResult, BattleIntent,
  JoinAck, RejectionReason, TransportAction,
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
  /**
   * The handshake a controller gets when it joins or rejoins (A-1).
   *
   * Transport-safe and per-controller: it tells one client its own position in
   * its own sequence. It is not the snapshot and does not belong in one.
   */
  joinAck(controllerId: string): JoinAck
  /**
   * Why the last rejections were rejected, in detail. **Server-side only.**
   *
   * Bounded, in memory, and never sent to a client (A-4). A test reads it; a
   * future observability layer will drain it.
   */
  diagnostics(): readonly AuthorityDiagnostic[]
}

/** How much detail the authority keeps before the oldest of it falls off. */
const MAX_DIAGNOSTICS = 64

/**
 * A refusal, before it is split in two.
 *
 * `reason` and the public numbers go to the client; `check` and `detail` go to
 * the diagnostics. Carrying both in one value means a new rejection cannot be
 * added without saying what tripped it.
 */
interface Refusal {
  readonly reason: RejectionReason
  readonly check: string
  readonly detail: string
}

const refuse = (reason: RejectionReason, check: string, detail: string): Refusal =>
  ({ reason, check, detail })

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

  const diagnostics: AuthorityDiagnostic[] = []

  /**
   * Splits a refusal: a thin public envelope out, the detail into the log.
   *
   * The client learns *that* it was refused and, where it could not work it
   * out alone, where to resume counting. It does not learn which of a dozen
   * checks caught it — that is a map of the boundary, drawn for whoever is
   * probing it.
   */
  function reject(
    refusal: Refusal,
    actionId: string | null,
    controllerId: string | null,
    extra: { readonly nextActionSequence?: number } = {},
  ): AuthorityRejected {
    diagnostics.push({
      serverTimeMs,
      controllerId,
      actionId,
      reason: refusal.reason,
      check: refusal.check,
      detail: refusal.detail,
    })
    if (diagnostics.length > MAX_DIAGNOSTICS) {
      diagnostics.splice(0, diagnostics.length - MAX_DIAGNOSTICS)
    }
    return { kind: 'rejected', reason: refusal.reason, actionId, revision, ...extra }
  }

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

  /**
   * Whether a move is aimed at its user or at the other side (A-3).
   *
   * Read off the catalog's own `target` column — `user` for Swords Dance,
   * Protect and Recover; a selected opponent for everything else R32.3 runs.
   * It is data, not a guess: the authority never decides what a move is for.
   */
  function targetProblem(intent: Extract<BattleIntent, { kind: 'useMove' }>): Refusal | null {
    const target = state.combatants[intent.targetId]
    if (!target) return refuse(REJECTION.INVALID_TARGET, 'target.exists', 'no such combatant in this battle')

    const move = input.catalog.move(intent.moveId)
    // Not in the catalog: nothing to classify, and the rules refuse it a few
    // lines later because no Pokémon can know it.
    if (!move) return null

    if (move.target === 'user') {
      // Explicitly itself, or nothing. Never inferred from "there is only one
      // sensible reading".
      return intent.targetId === intent.combatantId
        ? null
        : refuse(REJECTION.INVALID_TARGET, 'target.self', 'this move is aimed at its user')
    }

    if (intent.targetId === intent.combatantId) {
      return refuse(REJECTION.INVALID_TARGET, 'target.notSelf', 'this move is aimed at an opponent')
    }
    // Under the 1-vs-1 baseline the rules would hit exactly one combatant, and
    // the client has to name that one. Naming anybody else — a fainted
    // opponent, a Pokémon that switched out, an ally — means the two are
    // looking at different battles, and guessing on the client's behalf is how
    // an attack silently lands on whoever happens to be standing there.
    const wouldHit = currentTargetOf(state, intent.combatantId)
    if (!wouldHit) return refuse(REJECTION.INVALID_TARGET, 'target.none', 'there is nothing to aim at')
    if (wouldHit.combatantId !== intent.targetId) {
      return refuse(REJECTION.INVALID_TARGET, 'target.mismatch', 'that is not the combatant this would hit')
    }
    return null
  }

  function toCommand(
    intent: BattleIntent, owned: readonly string[],
  ): Refusal | { readonly command: BattleCommand } {
    switch (intent.kind) {
      case 'useMove': {
        const problem = targetProblem(intent)
        if (problem) return problem
        return { command: { type: 'USE_MOVE', combatantId: intent.combatantId, moveId: intent.moveId } }
      }
      case 'switch': {
        // Its own bench, or nobody's. The rules check the side as well; this
        // check is the one that survives a controller owning two sides.
        if (!owned.includes(intent.incomingId)) {
          return refuse(REJECTION.NOT_CONTROLLER, 'switch.owned', 'that Pokémon is not this controller s')
        }
        return {
          command: { type: 'SWITCH', combatantId: intent.combatantId, incomingId: intent.incomingId },
        }
      }
      case 'useItem': {
        if (!owned.includes(intent.targetId)) {
          return refuse(REJECTION.NOT_CONTROLLER, 'item.owned', 'an item goes on this controller s own team')
        }
        const effect = items.itemEffect(intent.item.itemId, intent.item.moveId ?? null)
        // The amount is the server's. A client naming an item we do not stock
        // gets nothing, rather than the effect it proposed.
        if (!effect) {
          return refuse(REJECTION.INVALID_SCHEMA, 'item.unknown', 'this server does not stock that item')
        }
        return {
          command: {
            type: 'USE_ITEM', combatantId: intent.combatantId, targetId: intent.targetId, item: effect,
          },
        }
      }
      case 'capture': {
        if (!state.combatants[intent.targetId]) {
          return refuse(REJECTION.INVALID_TARGET, 'capture.exists', 'no such combatant in this battle')
        }
        // Capturing something you already command is not a capture, and R35
        // will read ownership off exactly this line.
        if (owned.includes(intent.targetId)) {
          return refuse(REJECTION.INVALID_TARGET, 'capture.own', 'this controller already commands that one')
        }
        const ball = items.ball(intent.ballId)
        if (!ball) return refuse(REJECTION.INVALID_SCHEMA, 'capture.ball', 'this server has no such ball')
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
  ): Refusal | { readonly command: BattleCommand } {
    if (parsed.controllerId !== controllerId) {
      return refuse(REJECTION.NOT_CONTROLLER, 'actionId.namespace', 'the actionId names another controller')
    }
    if (action.battleId !== input.battleId) {
      return refuse(REJECTION.UNKNOWN_BATTLE, 'battleId', 'this authority runs a different battle')
    }
    if (!supported.catalogVersions.includes(action.catalogVersion)) {
      return refuse(REJECTION.INVALID_VERSION, 'version.catalogSupported', 'this server does not run that catalog')
    }
    if (action.catalogVersion !== state.catalogVersion) {
      return refuse(REJECTION.INVALID_VERSION, 'version.catalogBattle', 'this battle runs a different catalog')
    }
    if (!supported.battleRulesVersions.includes(action.battleRulesVersion)) {
      return refuse(REJECTION.INVALID_VERSION, 'version.rulesSupported', 'this server does not run those rules')
    }
    if (action.battleRulesVersion !== state.battleRulesVersion) {
      return refuse(REJECTION.INVALID_VERSION, 'version.rulesBattle', 'this battle runs different rules')
    }
    if (state.outcome.kind !== 'ongoing') {
      return refuse(REJECTION.BATTLE_FINISHED, 'outcome', `the battle is ${state.outcome.kind}`)
    }

    const owned = controls[controllerId] ?? []
    if (!owned.includes(action.intent.combatantId)) {
      return refuse(REJECTION.NOT_CONTROLLER, 'controls', 'this controller does not command that combatant')
    }
    return toCommand(action.intent, owned)
  }

  function submit(controllerId: string, payload: unknown): AuthoritySubmitResult {
    const validation = validateTransportAction(payload)
    if (!validation.ok) {
      return reject(
        refuse(validation.reason, 'schema', validation.detail), null, controllerId,
      )
    }
    const action = validation.action
    const parsed = parseActionId(action.actionId)
    if (!parsed) {
      return reject(
        refuse(REJECTION.INVALID_ACTION_ID, 'actionId.parse', 'unreadable actionId'), null, controllerId,
      )
    }

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
      // The one rejection a client cannot recover from on its own: it does not
      // know the floor. So this one carries the way out (A-1).
      return reject(
        refuse(REJECTION.STALE_ACTION, 'sequence.floor', `sequence ${parsed.sequence} is at or below the floor`),
        action.actionId,
        controllerId,
        { nextActionSequence: ledger.acceptedFloor(controllerId) + 1 },
      )
    }

    const authorized = authorize(controllerId, action, parsed)
    if ('reason' in authorized) return reject(authorized, action.actionId, controllerId)

    const { events, refused } = commit(authorized.command, action.actionId)
    if (refused) {
      return reject(
        refuse(
          REJECTION.ACTION_NOT_ALLOWED,
          'rules',
          refused.type === 'COMMAND_REJECTED' ? refused.reason : 'the rules refused this command',
        ),
        action.actionId,
        controllerId,
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
    joinAck: controllerId => ({
      battleId: input.battleId,
      controllerId,
      currentRevision: revision,
      nextActionSequence: ledger.acceptedFloor(controllerId) + 1,
      catalogVersion: state.catalogVersion,
      battleRulesVersion: state.battleRulesVersion,
      controlledCombatantIds: controls[controllerId] ?? [],
    }),
    diagnostics: () => diagnostics,
    internal: () => ({ battleId: input.battleId, revision, serverTimeMs, startedAtMs, state, controls }),
  }
}
