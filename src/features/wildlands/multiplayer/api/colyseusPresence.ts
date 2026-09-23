import { Client, type Room } from '@colyseus/sdk'
import { supabase } from '../../../../shared/api/supabase'
import type { Dir } from '../../engine/characters'
import type { ChatTransportPort, LocalPresencePort, RemoteActorsPort, RemotePresenceActor } from '../domain/presence'
import type { PlayerVisualIdentity } from '../../identity/playerIdentity'

const SNAPSHOT = 'presence:snapshot'
const SELF = 'presence:self'
const DELTA = 'presence:delta'
const BATCH = 'presence:batch'
// Community Playtest 0.1 — area chat rides the same socket.
const CHAT = 'chat'
const CHAT_HISTORY = 'chat:history'
const CHAT_LINE = 'chat:line'
const REALTIME_URL = import.meta.env.VITE_REALTIME_URL as string | undefined
const BENCHMARK_PLAYER = import.meta.env.DEV && import.meta.env.VITE_PRESENCE_BENCHMARK === 'on'
/** Server code used when a newer browser replaces this authenticated session. */
const REPLACED_SESSION_CODE = 4001

interface Snapshot { access: 'player' | 'guest'; self?: RemotePresenceActor; actors: RemotePresenceActor[] }
interface Delta { type: 'upsert' | 'leave'; actor: RemotePresenceActor }

/** Socket adapter: no polling, no persistence and no Supabase writes. */
export class ColyseusPresence implements LocalPresencePort {
  private room: Room | null = null
  private stopped = false
  private suspended = false
  private connecting = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0

  /**
   * `chat` is optional on purpose: without one, the adapter never installs the
   * chat receivers and `sendChat` is a no-op, so a build with no chat carries
   * no chat behaviour rather than dormant chat behaviour.
   */
  constructor(private readonly remote: RemoteActorsPort, private readonly chat: ChatTransportPort | null = null) {}

  async connect(identity?: PlayerVisualIdentity): Promise<void> {
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
      this.room = room; this.reconnectAttempt = 0
      room.onMessage<Snapshot>(SNAPSHOT, snapshot => {
        this.remote.setPresenceAccess(snapshot.access)
        // A guest reads the area and cannot speak into it, which the panel
        // has to know in order to say so instead of dropping the message.
        this.chat?.setAccess(snapshot.access)
        this.remote.setAuthoritativeActor(snapshot.self ?? null, 'snapshot')
        this.replace(snapshot.actors)
      })
      room.onMessage<RemotePresenceActor>(SELF, actor => this.remote.setAuthoritativeActor(actor, 'self'))
      room.onMessage<Delta>(DELTA, delta => this.apply(delta))
      room.onMessage<Delta[]>(BATCH, deltas => this.applyBatch(deltas))
      if (this.chat) {
        const chat = this.chat
        chat.setAccess('connecting')
        room.onMessage<{ areaId: string; lines: unknown }>(CHAT_HISTORY, payload => chat.history(payload.areaId, payload.lines))
        room.onMessage<unknown>(CHAT_LINE, line => chat.line(line))
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
        this.scheduleReconnect(identity)
      }
      room.onDrop(recoverTransport)
      room.onError(recoverTransport)
      room.onLeave(code => {
        if (this.room !== room) return
        this.room = null
        this.clearActors()
        // The newer browser owns this account now. Retrying here would evict it
        // in return and create an endless two-tab reconnect loop.
        if (code === REPLACED_SESSION_CODE) {
          this.stopped = true
          this.clearReconnect()
          return
        }
        this.scheduleReconnect(identity)
      })
    } catch {
      this.scheduleReconnect(identity)
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
    void this.connect(identity)
  }

  private replace(next: readonly RemotePresenceActor[]): void { this.remote.replaceRemoteActors(next) }
  private apply(delta: Delta): void {
    if (delta.type === 'leave') this.remote.removeRemoteActor(delta.actor.id)
    else this.remote.upsertRemoteActor(delta.actor)
  }
  private applyBatch(deltas: readonly Delta[]): void { for (const delta of deltas) this.apply(delta) }
  private clearActors(): void {
    this.chat?.detach()
    this.remote.setPresenceAccess('pending')
    this.remote.setAuthoritativeActor(null)
    this.remote.replaceRemoteActors([])
  }
  private clearReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }
  private scheduleReconnect(identity?: PlayerVisualIdentity): void {
    if (this.stopped || this.suspended || this.room || this.reconnectTimer) return
    const delay = Math.min(10_000, 500 * 2 ** this.reconnectAttempt++)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connect(identity)
    }, delay)
  }
}
