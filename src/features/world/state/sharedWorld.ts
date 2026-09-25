// The shared world on this client (WORLD-1): one object that is the socket's
// world sink, the engine's world layer and the scene's resource overlay.
//
// Authority stays on the server. This holds the latest truth it was sent,
// the server clock, and the intents this client has in flight.

import type { Actor } from '../../wildlands/engine/actors'
import type { WorldLayer, WorldLayerContext } from '../../wildlands/engine/worldLayer'
import type { PlayerStateMessage, WildMessage, WildRoster, WildStatus, WorkDone, WorkResult, WorldBatch, WorldSnapshot } from '../../../../services/realtime/src/world/worldProtocol.js'
import { WORLD_MESSAGE } from '../../../../services/realtime/src/world/worldProtocol.js'
import type { WorldSend, WorldTransportSink } from '../api/worldTransport'
import { devWarn } from '../../../shared/utils/devTools'
import { WorldClock } from '../domain/worldClock'
import { WorldResourceMirror } from '../domain/worldResources'
import { WorkerActors, type LoadPokemon, type PlaceholderPokemon } from '../render/workerActors'
import { WorldResourceOverlay } from '../render/worldResourceOverlay'

/** Past this, an unanswered intent is given up locally (the server still decides). */
const INTENT_TIMEOUT_MS = 8_000

export interface OwnAction {
  readonly actionId: string
  readonly nodeId: string
  readonly startedAt: number
  readonly endsAt: number
}

export class SharedWorld implements WorldTransportSink, WorldLayer {
  readonly clock = new WorldClock()
  readonly resources = new WorldResourceMirror()
  readonly overlay: WorldResourceOverlay
  private readonly workers: WorkerActors
  private send: WorldSend | null = null
  private nextRequestId = 1
  private readonly pending = new Map<number, { resolve: (result: WorkResult) => void; timer: ReturnType<typeof setTimeout> }>()
  private workersKey = ''
  private own: OwnAction | null = null
  private readonly doneListeners = new Set<(done: WorkDone) => void>()
  private roster: WildRoster | null = null
  /** Why there are (no) wild Pokémon here. Without 'ready' the world shows none: fail closed. */
  wildStatus: WildStatus | null = null
  private readonly wildListeners = new Set<(roster: WildRoster | null) => void>()
  private player: PlayerStateMessage | null = null
  private readonly playerListeners = new Set<(state: PlayerStateMessage) => void>()

  constructor(load: LoadPokemon, placeholder: PlaceholderPokemon) {
    this.workers = new WorkerActors(load, placeholder)
    // The local player's own action is drawn by its Skills layer; WORLD draws everyone else's.
    this.overlay = new WorldResourceOverlay(this.resources, this.clock, () => this.player?.playerId ?? null)
  }

  playerState(message: PlayerStateMessage): void {
    this.player = message
    this.workersKey = ''
    for (const listener of this.playerListeners) listener(message)
  }

  /** The session's own data as the server last sent it; null before the first message. */
  get playerData(): PlayerStateMessage | null {
    return this.player
  }

  onPlayerState(listener: (state: PlayerStateMessage) => void): () => void {
    this.playerListeners.add(listener)
    if (this.player) listener(this.player)
    return () => this.playerListeners.delete(listener)
  }

  // ── Transport sink ───────────────────────────────────────────────────────

  attach(send: WorldSend): void {
    this.send = send
  }

  detach(): void {
    this.send = null
    this.resources.clear()
    this.own = null
    // The roster stays: it is still this hour's truth, and dropping it would
    // flash the legacy local population until the rejoin's snapshot.
    for (const [requestId, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.resolve({ requestId, ok: false, reason: 'disconnected' })
    }
    this.pending.clear()
  }

  snapshot(snapshot: WorldSnapshot): void {
    this.clock.sample(snapshot.now)
    this.resources.applySnapshot(snapshot)
    this.own = snapshot.ownAction ?? null
    this.setRoster(snapshot.wild ?? null)
    this.setWildStatus(snapshot.wildStatus ?? null)
  }

  wild(message: WildMessage): void {
    this.clock.sample(message.now)
    if (message.wild && message.wild.areaId !== this.resources.areaId) return
    this.setRoster(message.wild)
    this.setWildStatus(message.status)
  }

  private setWildStatus(status: WildStatus | null): void {
    if (status === this.wildStatus) return
    this.wildStatus = status
    // Diagnostic, not a fallback: the area stays without wild Pokémon. In
    // production the server logs the cause and counts it in /metrics.
    if (status === 'unavailable') devWarn('[world] the server has no shared wild population for this area; no wild Pokémon are shown')
  }

  /** The current area's wild roster, as the server sent it. */
  get wildRosterValue(): WildRoster | null {
    return this.roster
  }

  onWildRoster(listener: (roster: WildRoster | null) => void): () => void {
    this.wildListeners.add(listener)
    return () => this.wildListeners.delete(listener)
  }

  private setRoster(roster: WildRoster | null): void {
    if (roster === this.roster || (roster && this.roster && roster.areaId === this.roster.areaId && roster.epoch === this.roster.epoch)) return
    this.roster = roster
    for (const listener of this.wildListeners) listener(roster)
  }

  batch(batch: WorldBatch): void {
    this.clock.sample(batch.now)
    this.resources.applyBatch(batch)
  }

  workResult(result: WorkResult): void {
    if (result.ok) this.own = { actionId: result.actionId, nodeId: result.nodeId, startedAt: result.startedAt, endsAt: result.endsAt }
    if (result.requestId === null) return
    const entry = this.pending.get(result.requestId)
    if (!entry) return
    clearTimeout(entry.timer)
    this.pending.delete(result.requestId)
    entry.resolve(result)
  }

  workDone(done: WorkDone): void {
    if (this.own?.actionId === done.actionId) this.own = null
    for (const listener of this.doneListeners) listener(done)
  }

  // ── Intents (the SKILLS UI calls these) ──────────────────────────────────

  /** Asks the server to work a node with one of the player's Pokémon. The server decides. */
  requestWork(nodeId: string, pokemonInstanceId: number, cropId: string | null = null): Promise<WorkResult> {
    const requestId = this.nextRequestId++
    if (!this.send) return Promise.resolve({ requestId, ok: false, reason: 'offline' })
    const send = this.send
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        resolve({ requestId, ok: false, reason: 'timeout' })
      }, INTENT_TIMEOUT_MS)
      this.pending.set(requestId, { resolve, timer })
      send(WORLD_MESSAGE.WORK, { nodeId, pokemonInstanceId, requestId, ...(cropId ? { cropId } : {}) })
    })
  }

  cancelWork(actionId: string): void {
    this.send?.(WORLD_MESSAGE.CANCEL, { actionId })
  }

  /** The local player's running action, as last confirmed by the server. */
  get ownAction(): OwnAction | null {
    return this.own
  }

  onWorkDone(listener: (done: WorkDone) => void): () => void {
    this.doneListeners.add(listener)
    return () => this.doneListeners.delete(listener)
  }

  // ── Engine layer ─────────────────────────────────────────────────────────

  update(_dt: number, context: WorldLayerContext): void {
    const now = this.clock.now()
    if (now === null) return
    const areaId = context.area().id
    const key = `${this.resources.revision}|${areaId}`
    if (this.workersKey !== key) {
      this.workersKey = key
      const own = this.player?.playerId ?? null
      // Own gathering is animated by the Skills layer; own farming has no such scene, so WORLD draws it.
      const others = [...(areaId === this.resources.areaId ? this.resources.active() : [])].filter(node => node.worker?.playerId !== own || node.id.endsWith(':plot'))
      this.workers.sync(others)
    }
    this.workers.update(now, id => context.playerTile(id), (tx, ty) => context.isSolid(tx, ty))
  }

  actors(): readonly Actor[] {
    return this.workers.actors()
  }

  hidesCompanion(ownerId: string, pokemonId: number): boolean {
    return this.workers.isWorking(ownerId, pokemonId)
  }

  serverNow(): number | null {
    return this.clock.now()
  }

  wildRoster(areaId: string): WildRoster | null {
    return this.roster?.areaId === areaId ? this.roster : null
  }
}
