// The room, empty (R32.4).
//
// R32's audit asked for `PresenceRoom → future ExpeditionRoom`. This is that
// room with **nothing in it**: it joins participants, routes one message kind
// to a `BattleAuthority`, runs a fixed-step update and hands back what to
// broadcast. There is no floor, no encounter, no spawn, no loot, no key, no
// boss, no co-op and no persistence, and adding any of them here is R34/R35
// work pretending to be R32.4 (§26, §37).
//
// **Why `Core`, and why it is TypeScript here.** `services/realtime` is
// CommonJS JavaScript with no build step: it cannot import Shared Battle
// Rules, which are TypeScript under `src/`. Writing the room over there today
// would mean either a second copy of the rules — the one thing R32.3 exists to
// prevent — or a bundler decision made in a hurry at the end of a release. So
// the room lives where the rules live, with no transport dependency at all.
//
// R34 will almost certainly declare `class ExpeditionRoom extends Room` in
// that service, and two different things called `ExpeditionRoom` in one
// codebase is a collision worth spending a word to avoid. This one is the
// **core**: the part that owns no socket and can be tested without one. The
// Colyseus room will wrap it —
//
//     class ExpeditionRoom extends Room {
//       onCreate() { this.core = createExpeditionRoomCore({ … }) }
//     }
//
// — calling `join`, `message`, `update` and `leave` and forwarding what they
// return. Nothing in this file has to change when that happens.
//
// The lifecycle mirrors `PresenceRoom` on purpose, down to the vocabulary, so
// the two read as the same kind of object.

import type { BattleRulesCatalog, BattleRulesConfig, BattleSideInput } from '../rules'
import { createBattleAuthority } from './authority'
import type { BattleAuthority, SupportedVersions } from './authority'
import type { AuthorityClock } from './clock'
import type { AuthorityEventEnvelope, AuthoritySubmitResult, JoinAck, RejectionReason } from './protocol'
import { REJECTION } from './protocol'
import type { AuthoritySeedSource } from './seed'
import type { ClientBattleSnapshot } from './snapshot'

/** The one message an R32.4 room understands. Everything else is refused. */
export const EXPEDITION_MESSAGE = { ACTION: 'expedition:action' } as const

/**
 * A connected participant.
 *
 * `controllerId` is whoever the **transport** authenticated — R30 derives it
 * from a Supabase token in `supabaseAuth.js` — and a room never reads it off a
 * payload. `sessionId` is the socket; the two differ because a reconnect gets
 * a new socket and keeps the same controller, which is also why the `actionId`
 * namespace is keyed on the controller and not on the session.
 */
export interface ExpeditionParticipant {
  readonly sessionId: string
  readonly controllerId: string
}

export interface CreateExpeditionRoomCoreInput {
  readonly roomId: string
  readonly clock: AuthorityClock
  readonly seedSource: AuthoritySeedSource
  readonly catalog: BattleRulesCatalog
  readonly supported?: SupportedVersions
}

export interface StartBattleInput {
  readonly battleId: string
  readonly sides: readonly BattleSideInput[]
  readonly config?: BattleRulesConfig
}

/** What one `update` produced: broadcast the events, keep the snapshot. */
export interface RoomUpdate {
  readonly events: readonly AuthorityEventEnvelope[]
  readonly snapshot: ClientBattleSnapshot | null
}

export interface ExpeditionRoomCore {
  readonly roomId: string
  /**
   * Admits a participant and returns its handshake, or `null` when there is no
   * battle to hand one out for yet.
   *
   * The `JoinAck` is what a reconnecting client needs and cannot work out: the
   * sequence its next `actionId` should carry (A-1). Sending it is R34's job;
   * producing it correctly is this release's.
   */
  join(participant: ExpeditionParticipant): JoinAck | null
  leave(sessionId: string): void
  /** Participants currently connected, in join order. */
  participants(): readonly ExpeditionParticipant[]
  /** Starts the room's one battle. R32.4 has exactly one, and no encounter picks it. */
  startBattle(input: StartBattleInput): BattleAuthority
  battle(): BattleAuthority | null
  /**
   * One message off a socket. `payload` is `unknown` because it is: the room
   * hands it straight to the authority, which is the only thing allowed to
   * decide what it was.
   */
  message(sessionId: string, type: string, payload: unknown): AuthoritySubmitResult
  /**
   * One step of the room loop: advance the server clock, collect what to
   * broadcast. A Colyseus room calls this from `setSimulationInterval`; a test
   * calls it after moving a manual clock. Domain logic never sits in a timer.
   */
  update(): RoomUpdate
}

export function createExpeditionRoomCore(input: CreateExpeditionRoomCoreInput): ExpeditionRoomCore {
  const bySession = new Map<string, ExpeditionParticipant>()
  let authority: BattleAuthority | null = null

  // The room's own refusals never reach the authority, so they carry no
  // diagnostic either — there is nothing to diagnose but the transport.
  const refuse = (reason: RejectionReason, actionId: string | null = null): AuthoritySubmitResult => ({
    kind: 'rejected',
    reason,
    actionId,
    revision: authority?.revision() ?? 0,
  })

  return {
    roomId: input.roomId,

    join(participant) {
      // A reconnecting controller replaces its old socket, as `PresenceRoom`
      // does: two live sockets for one controller would each believe they own
      // the same Pokémon.
      for (const [sessionId, existing] of bySession) {
        if (existing.controllerId === participant.controllerId) bySession.delete(sessionId)
      }
      bySession.set(participant.sessionId, participant)
      return authority?.joinAck(participant.controllerId) ?? null
    },

    leave(sessionId) {
      bySession.delete(sessionId)
    },

    participants: () => [...bySession.values()],

    startBattle(battleInput) {
      if (authority) throw new Error('this room already has a battle')
      authority = createBattleAuthority({
        battleId: battleInput.battleId,
        sides: battleInput.sides,
        config: battleInput.config,
        catalog: input.catalog,
        clock: input.clock,
        seedSource: input.seedSource,
        supported: input.supported,
      })
      return authority
    },

    battle: () => authority,

    message(sessionId, type, payload) {
      const participant = bySession.get(sessionId)
      // An unknown socket is not a controller. It gets the same code a wrong
      // controller gets, and learns nothing about who is in the room.
      if (!participant) return refuse(REJECTION.NOT_CONTROLLER)
      if (type !== EXPEDITION_MESSAGE.ACTION) return refuse(REJECTION.UNKNOWN_ACTION)
      if (!authority) return refuse(REJECTION.UNKNOWN_BATTLE)
      return authority.submit(participant.controllerId, payload)
    },

    update() {
      if (!authority) return { events: [], snapshot: null }
      return { events: authority.tick(), snapshot: authority.snapshot() }
    },
  }
}
