// ECO-GAMEPLAY-2 (experimental, development builds only): this client's side of ONE test battle.
//
// It decides nothing. It asks the server to reserve an encounter, sends the player's move choices
// as the battle core's TransportAction, asks to flee, and shows what the server answers. Outcomes,
// timing, validation and the end of the battle are the server's; a refused action changes nothing.
//
// Only the lazily loaded battle panel imports this module, so a production build (where the
// experiment is a constant `false`) never contains it.

import type { AuthorityEventEnvelope } from '../../battle/authority'
import type {
  EcoBattleEnd, EcoBattleMessage, EcoBattleOutcome, EcoBattleStage, EcoEngageResult,
} from '../../../../services/realtime/src/world/worldProtocol.js'
import { WORLD_MESSAGE } from '../../../../services/realtime/src/world/worldProtocol.js'
import type { ClientBattleSnapshot } from '../../battle/authority'

/** The core's combatant ids for a one-against-one battle. */
export const PLAYER_COMBATANT = 'player-0'
export const WILD_COMBATANT = 'wild-0'
const ENGAGE_TIMEOUT_MS = 8_000

/** What SharedWorld offers the session: a way out, and where battle messages go. */
export interface EcoBattleHost {
  ecoSend(type: string, payload: unknown): boolean
  setEcoBattleSink(sink: EcoBattleSink | null): void
}

export interface EcoBattleSink {
  message(type: string, payload: unknown): void
  /** The socket is gone: the server pauses the battle and keeps it for the reconnection grace. */
  detached(): void
  /** A world snapshot arrived (join or area change). A running battle is re-sent right after it, if it still exists. */
  worldSnapshot(): void
}

export type EcoBattleView =
  | { readonly phase: 'idle' }
  | { readonly phase: 'engaging'; readonly encounterId: string }
  | { readonly phase: 'refused'; readonly encounterId: string | null; readonly reason: string }
  | {
    readonly phase: 'battle'
    readonly encounterId: string
    readonly battleId: string
    readonly speciesId: number
    readonly fixtureLabel: string
    readonly snapshot: ClientBattleSnapshot
    /** Local time (this session's clock) when `snapshot` arrived: the origin of any visual interpolation. */
    readonly snapshotAt: number
    /** Battle time left as of the last server message (it only passes while connected). */
    readonly expiresInMs: number
    readonly connected: boolean
    readonly lastRejection: string | null
    /** ECO-BATTLE-SCENE-1: where the battle stands, as the server decided it (null from an older server). */
    readonly stage: EcoBattleStage | null
  }
  | { readonly phase: 'ended'; readonly encounterId: string; readonly battleId: string; readonly outcome: EcoBattleOutcome; readonly retired: boolean; readonly snapshot: ClientBattleSnapshot }

type Battle = Extract<EcoBattleView, { phase: 'battle' }>

export class EcoBattleSession implements EcoBattleSink {
  private state: EcoBattleView = { phase: 'idle' }
  private readonly listeners = new Set<(view: EcoBattleView) => void>()
  private requestId = 0
  private pendingRequest: number | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  /** The controller id and the next action sequence, from the server's JoinAck. */
  private controllerId = ''
  private nextSequence = 1
  private battleTimeAt: { ms: number; at: number } | null = null
  /** ECO-OVERWORLD-BATTLE-1: the server's events, once each (by sequence), for the battlefield marks. */
  private readonly eventListeners = new Set<(events: readonly AuthorityEventEnvelope[]) => void>()
  private lastEvent = { battleId: '', sequence: -1 }

  constructor(private readonly host: EcoBattleHost, private readonly now: () => number = () => Date.now()) {
    host.setEcoBattleSink(this)
  }

  dispose(): void {
    this.clearTimer()
    this.host.setEcoBattleSink(null)
    this.listeners.clear()
    this.eventListeners.clear()
  }

  /** The current battle's new events, in order and never twice (a resent or late message adds nothing). */
  onEvents(listener: (events: readonly AuthorityEventEnvelope[]) => void): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  /** Local time, the same clock `snapshotAt` is measured with. */
  clock(): number {
    return this.now()
  }

  get view(): EcoBattleView {
    return this.state
  }

  subscribe(listener: (view: EcoBattleView) => void): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => this.listeners.delete(listener)
  }

  /** Battle time left, estimated locally between server messages (display only). */
  remainingMs(): number {
    if (this.state.phase !== 'battle' || !this.battleTimeAt) return 0
    const elapsed = this.state.connected ? this.now() - this.battleTimeAt.at : 0
    return Math.max(0, this.battleTimeAt.ms - elapsed)
  }

  /** Ask the server for this encounter. While another battle runs, the server answers with that one. */
  engage(encounterId: string): void {
    if (this.state.phase === 'engaging' || this.state.phase === 'battle') return
    const requestId = ++this.requestId
    if (!this.host.ecoSend(WORLD_MESSAGE.ECO_ENGAGE, { requestId, encounterId })) {
      this.set({ phase: 'refused', encounterId, reason: 'offline' })
      return
    }
    this.pendingRequest = requestId
    this.set({ phase: 'engaging', encounterId })
    this.clearTimer()
    this.timer = setTimeout(() => {
      if (this.pendingRequest !== requestId) return
      this.pendingRequest = null
      this.set({ phase: 'refused', encounterId, reason: 'no-answer' })
    }, ENGAGE_TIMEOUT_MS)
  }

  /** One move choice. The server validates it (and may refuse it); nothing changes here until it answers. */
  useMove(moveId: number, targetsUser: boolean): boolean {
    const battle = this.battle()
    if (!battle || !battle.connected) return false
    const sequence = this.nextSequence++
    return this.host.ecoSend(WORLD_MESSAGE.ECO_BATTLE_ACTION, {
      actionId: `${this.controllerId}:${sequence}`, battleId: battle.battleId,
      catalogVersion: battle.snapshot.catalogVersion, battleRulesVersion: battle.snapshot.battleRulesVersion,
      intent: { kind: 'useMove', combatantId: PLAYER_COMBATANT, moveId, targetId: targetsUser ? PLAYER_COMBATANT : WILD_COMBATANT },
    })
  }

  flee(): boolean {
    const battle = this.battle()
    return battle ? this.host.ecoSend(WORLD_MESSAGE.ECO_FLEE, { battleId: battle.battleId }) : false
  }

  /** Back to idle after an end or a refusal. */
  dismiss(): void {
    if (this.state.phase === 'ended' || this.state.phase === 'refused') this.set({ phase: 'idle' })
  }

  // ── EcoBattleSink ────────────────────────────────────────────────────────

  message(type: string, payload: unknown): void {
    if (type === WORLD_MESSAGE.ECO_ENGAGE_RESULT) this.engageResult(payload as EcoEngageResult)
    else if (type === WORLD_MESSAGE.ECO_BATTLE) this.battleMessage(payload as EcoBattleMessage)
    else if (type === WORLD_MESSAGE.ECO_BATTLE_END) this.battleEnd(payload as EcoBattleEnd)
  }

  detached(): void {
    if (this.state.phase === 'engaging') {
      this.pendingRequest = null
      this.clearTimer()
      this.set({ phase: 'refused', encounterId: this.state.encounterId, reason: 'offline' })
    } else if (this.state.phase === 'battle') {
      this.battleTimeAt = { ms: this.remainingMs(), at: this.now() }
      this.set({ ...this.state, connected: false })
    }
  }

  worldSnapshot(): void {
    // Back after a disconnection: the server sends the battle again right after this snapshot
    // (`resumed`). If it does not, the grace ran out and the reservation was released.
    if (this.state.phase === 'battle' && !this.state.connected) {
      const { encounterId, battleId, snapshot } = this.state
      this.battleTimeAt = null
      this.set({ phase: 'ended', encounterId, battleId, outcome: 'disconnected', retired: false, snapshot })
    }
  }

  // ── Server messages ──────────────────────────────────────────────────────

  private engageResult(result: EcoEngageResult): void {
    const resumed = result.requestId === null && result.resumed === true
    if (!resumed && result.requestId !== this.pendingRequest) return
    if (!resumed) { this.pendingRequest = null; this.clearTimer() }
    if (!result.ok || !result.battle || !result.encounterId) {
      if (!resumed) this.set({ phase: 'refused', encounterId: result.encounterId, reason: result.reason ?? 'refused' })
      return
    }
    const { battle } = result
    this.controllerId = battle.joinAck.controllerId
    // A continuation, never a fresh count: actions sent before a reconnection stay below it.
    this.nextSequence = battle.joinAck.nextActionSequence
    this.battleTimeAt = { ms: battle.expiresInMs, at: this.now() }
    if (this.lastEvent.battleId !== battle.battleId) this.lastEvent = { battleId: battle.battleId, sequence: -1 }
    this.set({
      phase: 'battle', encounterId: result.encounterId, battleId: battle.battleId, speciesId: battle.speciesId,
      fixtureLabel: battle.fixtureLabel, snapshot: battle.snapshot, snapshotAt: this.now(), expiresInMs: battle.expiresInMs, connected: true, lastRejection: null,
      stage: battle.stage ?? null,
    })
  }

  private battleMessage(message: EcoBattleMessage): void {
    const battle = this.battle()
    if (!battle || message.battleId !== battle.battleId) return
    const result = message.result
    let lastRejection = battle.lastRejection
    if (result?.kind === 'rejected') {
      lastRejection = result.reason
      // The server says where this controller's count resumes (STALE_ACTION and the like).
      if ('nextActionSequence' in result && typeof result.nextActionSequence === 'number') this.nextSequence = result.nextActionSequence
    } else if (result) {
      lastRejection = null
    }
    // The snapshot is deduplicated on its own: the rest of the message (the result above, the
    // events below) is handled whatever it brings. Only a later state replaces the one shown and
    // restarts the interpolation and the countdown from it; the same state received again (a
    // replay, a copy deserialized anew) or an older one changes neither. Resuming after a
    // reconnection is `engageResult` (`resumed`), which always restarts both from the server.
    const snapshot = message.snapshot && isLater(message.snapshot, battle.snapshot) ? message.snapshot : battle.snapshot
    const advanced = snapshot !== battle.snapshot
    if (advanced && this.battleTimeAt) {
      const passed = snapshot.timeMs - battle.snapshot.timeMs
      this.battleTimeAt = { ms: Math.max(0, battle.expiresInMs - passed), at: this.now() }
    }
    const fresh = (message.events ?? []).filter(envelope => envelope.sequence > this.lastEvent.sequence)
    if (fresh.length) this.lastEvent = { battleId: battle.battleId, sequence: fresh[fresh.length - 1].sequence }
    this.set({ ...battle, snapshot, snapshotAt: advanced ? this.now() : battle.snapshotAt, expiresInMs: this.battleTimeAt?.ms ?? battle.expiresInMs, lastRejection })
    if (fresh.length) for (const listener of this.eventListeners) listener(fresh)
  }

  private battleEnd(end: EcoBattleEnd): void {
    const battle = this.battle()
    if (!battle || end.battleId !== battle.battleId) return
    this.battleTimeAt = null
    this.set({ phase: 'ended', encounterId: end.encounterId, battleId: end.battleId, outcome: end.outcome, retired: end.retired, snapshot: end.snapshot })
  }

  private battle(): Battle | null {
    return this.state.phase === 'battle' ? this.state : null
  }

  private set(next: EcoBattleView): void {
    this.state = next
    for (const listener of this.listeners) listener(next)
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}

/**
 * A later authoritative state. The battle authority advances the revision on every change it
 * commits, the passing of time included, so an equal revision is the same state.
 */
function isLater(next: ClientBattleSnapshot, current: ClientBattleSnapshot): boolean {
  return next.revision > current.revision
}
