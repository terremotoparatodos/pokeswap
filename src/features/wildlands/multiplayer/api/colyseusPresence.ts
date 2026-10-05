import { Client, type Room } from '@colyseus/sdk'
import { supabase } from '../../../../shared/api/supabase'
import type { Dir } from '../../engine/characters'
import type { ChatTransportPort, LocalPresencePort, PresenceConnectionStatus, RemoteActorsPort, RemotePresenceActor } from '../domain/presence'
import type { PlayerVisualIdentity } from '../../identity/playerIdentity'
import type { WorldTransportSink } from '../../../world/api/worldTransport'
import { WORLD_MESSAGE, WORLD_PROTOCOL } from '../../../../../services/realtime/src/world/worldProtocol.js'
import { OWNER_UNREACHABLE_ATTEMPTS, PRESENCE_PROTOCOL, closeDecision, joinRefusalDecision, type CloseDecision, type ClosingReason } from '../domain/closePolicy'

const SNAPSHOT = 'presence:snapshot'
const SELF = 'presence:self'
const DELTA = 'presence:delta'
const BATCH = 'presence:batch'
const ERROR = 'presence:error'
const CLOSING = 'presence:closing'
// Community Playtest 0.1 — area chat rides the same socket.
const CHAT = 'chat'
const CHAT_HISTORY = 'chat:history'
const CHAT_LINE = 'chat:line'
const REALTIME_URL = import.meta.env.VITE_REALTIME_URL as string | undefined
/** Without a realtime URL the world is the local one (PRESENCE UX-1 `offline`). */
export const REALTIME_CONFIGURED = !!REALTIME_URL
// Synthetic identities exist only in the local BenchmarkPresenceRoom; a
// production server ignores the option. PERF-1 measurement builds use it too,
// so captures run on production-built code without accounts.
const BENCHMARK_PLAYER = (import.meta.env.DEV || import.meta.env.VITE_PERF === 'on') && import.meta.env.VITE_PRESENCE_BENCHMARK === 'on'
/**
 * WORLD LOCATION-4: this page load's tab, sent on every join. It only lets an automatic
 * reconnection (`resume`) yield to another live tab; it never takes part in who owns the
 * account's session (the server and the database decide that).
 */
const TAB_ID = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
/** The last ambiguous 4001 taken as a restart, for the whole page (at most one a minute). */
let lastAmbiguousCloseAt: number | null = null

interface Snapshot { access: 'player' | 'guest'; self?: RemotePresenceActor; actors: RemotePresenceActor[]; presenceProtocol?: number }
type StepFields = Pick<RemotePresenceActor, 'id' | 'tx' | 'ty' | 'dir' | 'speed' | 'moveSequence'>
type Delta =
  | { type: 'upsert' | 'leave'; actor: RemotePresenceActor }
  /**
   * Protocol 2: a move of an actor whose identity this client already holds.
   * `via`: earlier moves of the same actor that fell in the same 50 ms batch
   * window, oldest first (services/realtime protocol/messages.js stackStep).
   */
  | { type: 'step'; actor: StepFields; via?: Omit<StepFields, 'id'>[] }

/** Socket adapter: no polling, no persistence and no Supabase writes. */
export class ColyseusPresence implements LocalPresencePort {
  private room: Room | null = null
  private stopped = false
  private suspended = false
  private connecting = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  /** CLOUD READINESS-3: consecutive closes because the session's previous server does not answer. */
  private ownerUnreachable = 0
  /** Last full actor per id, so a compact step can be expanded before it reaches the engine. */
  private readonly known = new Map<string, RemotePresenceActor>()

  /**
   * `chat` is optional on purpose: without one, the adapter never installs the
   * chat receivers and `sendChat` is a no-op, so a build with no chat carries
   * no chat behaviour rather than dormant chat behaviour.
   */
  constructor(
    private readonly remote: RemoteActorsPort,
    private readonly chat: ChatTransportPort | null = null,
    /** WORLD-1: shared resources and dynamic entities. Same rule as chat: absent means not declared. */
    private readonly world: WorldTransportSink | null = null,
    /** PRESENCE UX-1: how far this socket got, for the world-entry controller. */
    private readonly status: PresenceConnectionStatus | null = null,
  ) {}

  /**
   * `resume`: an automatic join (a reconnection, a retry, a renewed session). It never
   * displaces another tab's live session: the server refuses it with 4409 and this stops as
   * replaced. Only the page's first join and «Jugar acá» go without it.
   * `takeover` (CLOUD READINESS-3): «Jugar acá» only — the player chose to play here even if the
   * server that held the session does not answer. Never sent with `resume`, never automatic.
   */
  async connect(identity?: PlayerVisualIdentity, { resume = false, takeover = false }: { resume?: boolean; takeover?: boolean } = {}): Promise<void> {
    if (!REALTIME_URL || this.room || this.stopped || this.suspended || this.connecting) return
    this.connecting = true
    try {
      const { data } = await supabase.auth.getSession()
      if (this.stopped || this.suspended) return
      const client = new Client(REALTIME_URL)
      const query = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search)
      const requestedArea = query?.get('area') ?? null
      const requestedBenchmarkId = query?.get('benchmarkId') ?? ''
      const benchmarkId = /^[a-z0-9][a-z0-9-]{0,39}$/.test(requestedBenchmarkId)
        ? requestedBenchmarkId
        : 'browser-player'
      const room = await client.joinOrCreate('presence', {
        token: data.session?.access_token ?? null,
        presenceProtocol: PRESENCE_PROTOCOL,
        tabId: TAB_ID,
        ...(resume ? { resume: true } : takeover ? { takeover: true } : {}),
        ...(this.world ? { worldProtocol: WORLD_PROTOCOL } : {}),
        visual: identity ? { characterId: identity.character.id, companionPokemonId: identity.companion?.id ?? null } : null,
        ...(BENCHMARK_PLAYER ? {
          benchmark: {
            id: benchmarkId, username: identity?.username || 'Jugador local',
            area: requestedArea === 'pradera' ? 'pradera' : 'ciudad-corazon',
          },
        } : {}),
      })
      if (this.stopped || this.suspended) { await room.leave(); return }
      // Rejoin with a fresh room after a transport drop. The service keeps
      // presence only in memory and deliberately does not reserve Colyseus
      // reconnection tokens, so SDK-level session restoration cannot succeed.
      room.reconnection.enabled = false
      // The backoff is NOT reset here (review F7): only a ready connection (its snapshot) resets it.
      this.room = room
      const joinedAt = Date.now()
      let serverProtocol: number | null = null
      let closing: ClosingReason | null = null
      room.onMessage<{ reason?: unknown }>(CLOSING, message => {
        if (message?.reason === 'replaced' || message?.reason === 'draining' || message?.reason === 'owner-unreachable') closing = message.reason
      })
      room.onMessage<Snapshot>(SNAPSHOT, snapshot => {
        // A room this adapter already left must not place the player or reveal the scene.
        if (this.room !== room) return
        if (typeof snapshot.presenceProtocol === 'number') serverProtocol = snapshot.presenceProtocol
        // Authoritative and placed: the connection is stable, so the reconnect backoff starts over.
        this.reconnectAttempt = 0
        this.ownerUnreachable = 0
        this.remote.setPresenceAccess(snapshot.access)
        // A guest reads the area and cannot speak into it, which the panel
        // has to know in order to say so instead of dropping the message.
        this.chat?.setAccess(snapshot.access)
        this.remote.setAuthoritativeActor(snapshot.self ?? null, 'snapshot')
        this.replace(snapshot.actors)
        // After the engine has the area: the controller then prepares it.
        this.status?.snapshot(snapshot.access)
      })
      room.onMessage<RemotePresenceActor>(SELF, actor => this.remote.setAuthoritativeActor(actor, 'self'))
      room.onMessage<Delta>(DELTA, delta => this.apply(delta))
      room.onMessage<Delta[]>(BATCH, deltas => this.applyBatch(deltas))
      // Refusals were unhandled (an SDK warning each); they are diagnostics now.
      room.onMessage<{ reason?: unknown }>(ERROR, error => {
        if (typeof error?.reason === 'string') this.remote.presenceRejected?.(error.reason.slice(0, 64))
      })
      if (this.chat) {
        const chat = this.chat
        chat.setAccess('connecting')
        room.onMessage<{ areaId: string; lines: unknown }>(CHAT_HISTORY, payload => chat.history(payload.areaId, payload.lines))
        room.onMessage<unknown>(CHAT_LINE, line => chat.line(line))
      }
      if (this.world) {
        const world = this.world
        room.onMessage(WORLD_MESSAGE.SNAPSHOT, snapshot => world.snapshot(snapshot))
        room.onMessage(WORLD_MESSAGE.BATCH, batch => world.batch(batch))
        room.onMessage(WORLD_MESSAGE.WORK_RESULT, result => world.workResult(result))
        room.onMessage(WORLD_MESSAGE.WORK_YIELD, unit => world.workYield(unit))
        room.onMessage(WORLD_MESSAGE.WORK_DONE, done => world.workDone(done))
        room.onMessage(WORLD_MESSAGE.WILD, message => world.wild(message))
        room.onMessage(WORLD_MESSAGE.PLAYER_STATE, message => world.playerState(message))
        world.attach((type, payload) => { if (this.room === room) room.send(type, payload) })
      }
      // Install every receiver first. The server only sends the initial
      // authoritative position after this explicit readiness acknowledgement.
      room.send('presence:ready')
      const recoverTransport = () => {
        // `onDrop` runs before the SDK tears down room listeners. Recover with
        // a fresh join because this service has no server-side reservation.
        if (this.room !== room) return
        this.room = null
        this.clearActors()
        this.status?.lost()
        this.scheduleReconnect(identity)
      }
      room.onDrop(recoverTransport)
      room.onError(recoverTransport)
      room.onLeave(code => {
        if (this.room !== room) return
        this.room = null
        this.clearActors()
        const now = Date.now()
        const decision = closeDecision({ code, closing, serverProtocol, livedMs: now - joinedAt, now, lastAmbiguousAt: lastAmbiguousCloseAt })
        if (decision.ambiguous) lastAmbiguousCloseAt = now
        this.follow(decision, identity)
      })
    } catch (error) {
      // A refused join: a resume that yields to another tab (4409) stops; a draining host is retried.
      this.follow(joinRefusalDecision((error as { code?: unknown } | null)?.code), identity)
    } finally {
      this.connecting = false
    }
  }

  move(direction: Dir, running: boolean, sequence: number): void { this.room?.send('move', { direction, running, sequence }) }
  /** Intent, not a fact: the room may refuse it, and only what comes back is shown. */
  sendChat(text: string): void { this.room?.send(CHAT, { text }) }
  changeArea(areaId: string): void { this.room?.send('area', { areaId }) }
  observe(areaId: string, tx: number, ty: number): void { this.room?.send('observe', { areaId, tx, ty }) }
  disconnect(): void {
    this.stopped = true
    this.clearReconnect()
    const room = this.room; this.room = null; this.clearActors()
    if (room) void room.leave()
  }

  suspend(): void {
    if (this.stopped || this.suspended) return
    this.suspended = true; this.clearReconnect()
    const room = this.room; this.room = null; this.clearActors()
    if (room) void room.leave()
  }

  resume(identity?: PlayerVisualIdentity): void {
    if (this.stopped) return
    this.suspended = false
    void this.connect(identity, { resume: true })
  }

  private replace(next: readonly RemotePresenceActor[]): void {
    this.known.clear()
    for (const actor of next) this.known.set(actor.id, actor)
    this.remote.replaceRemoteActors(next)
  }
  private apply(delta: Delta): void {
    if (delta.type === 'leave') {
      this.known.delete(delta.actor.id)
      this.remote.removeRemoteActor(delta.actor.id)
      return
    }
    if (delta.type === 'step') {
      const identity = this.known.get(delta.actor.id)
      // The service only sends a step after a full actor; without one there is
      // nothing to draw, and inventing identity would be worse than waiting.
      if (!identity) return
      // Each intermediate move reaches the engine as its own step, so none is skipped on screen.
      for (const earlier of delta.via ?? []) this.remote.upsertRemoteActor({ ...identity, ...earlier, id: identity.id })
      const actor = { ...identity, ...delta.actor }
      this.known.set(actor.id, actor)
      this.remote.upsertRemoteActor(actor)
      return
    }
    this.known.set(delta.actor.id, delta.actor)
    this.remote.upsertRemoteActor(delta.actor)
  }
  private applyBatch(deltas: readonly Delta[]): void { for (const delta of deltas) this.apply(delta) }
  private clearActors(): void {
    this.known.clear()
    this.chat?.detach()
    this.world?.detach()
    this.remote.setPresenceAccess('pending')
    this.remote.setAuthoritativeActor(null)
    this.remote.replaceRemoteActors([])
  }
  private clearReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }
  /** Acts on a close or a refused join (domain/closePolicy.ts). */
  private follow(decision: CloseDecision, identity?: PlayerVisualIdentity): void {
    if (decision.action === 'replaced') {
      // Another tab or device owns this account now. Retrying here would evict it in return
      // and create an endless two-tab loop: only the player's «Jugar acá» joins again.
      this.stopped = true
      this.clearReconnect()
      this.status?.replaced()
      return
    }
    if (decision.action === 'owner-unreachable' && ++this.ownerUnreachable >= OWNER_UNREACHABLE_ATTEMPTS && this.status?.held) {
      // CLOUD READINESS-3: bounded. The player decides whether to play here («Jugar acá»); nothing does it alone.
      this.stopped = true
      this.clearReconnect()
      this.status.held()
      return
    }
    this.status?.lost()
    if (decision.action === 'none') return
    // A drain keeps backing off (bounded); repeated 4503 refusals never bring it back to 500 ms.
    this.scheduleReconnect(identity)
  }
  private scheduleReconnect(identity?: PlayerVisualIdentity): void {
    if (this.stopped || this.suspended || this.room || this.reconnectTimer) return
    const delay = Math.min(10_000, 500 * 2 ** this.reconnectAttempt++)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      // Every automatic join resumes: it never displaces another tab.
      void this.connect(identity, { resume: true })
    }, delay)
  }
}
