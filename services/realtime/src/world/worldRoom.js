import { chunkOf, worldArea } from './areas.js'
import { ResourceAuthority } from './resourceAuthority.js'
import { chunkKey } from './resourceStore.js'
import { WORLD_MESSAGE, WORLD_PROTOCOL, cancelIntent, ecoRetireIntent, publicNode, workIntent } from './worldProtocol.js'
import { chunksInView, isChunkRetained } from './worldInterest.js'
import { WildService } from './wildService.js'
import { ECO_PROTOCOL, EcoPopulation } from './ecoPopulation.js'
import { EcoBattles } from './ecoBattles.js'

/**
 * The world's transport glue inside PresenceRoom (WORLD-1B/1C).
 *
 * It rides the presence socket and its 50 ms tick instead of opening a second
 * room: one connection, one clock, one batch window. Only clients that declare
 * `worldProtocol` on join receive world messages, so this server can deploy
 * ahead of a frontend that does not know about them (as with presenceProtocol).
 *
 * Per client it keeps the subscribed chunks and a pending batch. Per chunk it
 * keeps the subscribers, so a node change costs O(viewers of that chunk), not
 * O(clients).
 */
export const RESTORE_RETRY_MS = 5_000

export class WorldRoom {
  /**
   * `playerData` (optional): the PlayerDataAuthority. With it the world
   * restores persisted node state before serving anyone, and sends each
   * player its own XP, materials and Pokémon. Without it (tests, benchmarks
   * of the transport alone) the world starts empty and ready.
   */
  constructor({ skills, ownership, lookupActor, clientForPlayer, placeActor = undefined, catalog = null, playerData = null, now = Date.now, authority = null, stockRandom = undefined, ecoExperiment = false, eco = undefined, ecoRandom = undefined, ecoBattles = undefined, log = message => console.warn(message) }) {
    this.now = now
    this.clientForPlayer = clientForPlayer
    this.clients = new Map()
    /** Sockets that declared an older world protocol (or none): no world state, no work (PROB-2). */
    this.outdated = new WeakSet()
    this.subscribers = new Map()
    this.playerData = playerData
    this.skills = skills
    this.log = log
    /** False until persisted state is back: until then no world is served (fail closed). */
    this.ready = playerData === null
    this.waiting = new Map()
    this.metrics = { snapshots: 0, batches: 0, nodeDeltas: 0, chunkEnters: 0, chunkLeaves: 0, maxBatchBytes: 0, bytes: 0, outdatedJoins: 0, outdatedWork: 0 }
    // ECO-GAMEPLAY-1: ONE wild system per process. In the (development-only) experiment the admitted
    // ECO population is the world's wild Pokémon and the hourly roster does not exist at all.
    /** Areas whose ECO view changed since the last flush. */
    this.ecoDirty = new Set()
    this.eco = ecoExperiment ? (eco ?? new EcoPopulation({ now, devRetire: true, isBusy: id => this.ecoBattles?.isBusy(id) ?? false, onChange: areaId => this.ecoDirty.add(areaId), log, ...(ecoRandom ? { random: ecoRandom } : {}) })) : null
    // ECO-GAMEPLAY-2: test battles against those encounters (same experiment; nothing outside it loads the battle bundle).
    // `ecoBattles` (tests only): EcoBattles options to override (`prepare`, `random`, `newId`).
    this.ecoBattles = this.eco ? new EcoBattles({
      population: this.eco, now, log, send: (client, type, payload) => this.#send(client, type, payload),
      onChange: areaId => this.ecoDirty.add(areaId),
      // ECO-BATTLE-SPECTATORS-1: the other ECO viewers of the battle's area (never the owner's sockets).
      broadcast: (areaId, type, payload, exceptPlayerId) => this.#sendToEcoArea(areaId, type, payload, exceptPlayerId),
      ...(ecoBattles ?? {}),
    }) : null
    this.wild = ecoExperiment ? null : new WildService({ catalog, now, onRoster: roster => this.#rosterChanged(roster), onUnavailable: areaId => this.#wildUnavailable(areaId) })
    this.authority = authority ?? new ResourceAuthority({
      skills, ownership, lookupActor, now, placeActor, log,
      ...(stockRandom ? { random: stockRandom } : {}),
      // The private read restore() uses, also the resync source after an ambiguous or stale commit (YIELD-2 recovery).
      loadNodes: playerData ? () => playerData.loadNodes() : null,
      onNode: record => this.#nodeChanged(record),
      onResult: (playerId, result) => this.#sendToPlayer(playerId, WORLD_MESSAGE.WORK_RESULT, result),
      onDone: (playerId, done) => this.#sendToPlayer(playerId, WORLD_MESSAGE.WORK_DONE, done),
      onYield: (playerId, unit) => this.#sendToPlayer(playerId, WORLD_MESSAGE.WORK_YIELD, unit),
    })
  }

  /**
   * Restores persisted node state (depleted trees, growing plots). Retries
   * until the store answers; clients get their world snapshot only then, so a
   * restart never shows a tree that is still depleted as available.
   */
  async start() {
    if (this.ready || !this.playerData) return
    for (;;) {
      try {
        this.authority.restore(await this.playerData.loadNodes(), this.now())
        break
      } catch (error) {
        this.log(`[world] could not restore persisted world state (${String(error?.message ?? error).slice(0, 60)}); retrying`)
        await new Promise(resolve => { const timer = setTimeout(resolve, RESTORE_RETRY_MS); timer.unref?.() })
      }
    }
    this.ready = true
    for (const [client, viewer] of this.waiting) if (this.clients.has(client)) this.snapshot(client, viewer)
    this.waiting.clear()
  }

  /**
   * Registers a socket that declared the world protocol. Nothing of the
   * player's token is kept: after join the session is the authenticated user
   * id, and every later check asks the server-side player data about that id.
   */
  join(client, options, auth) {
    const playerId = auth?.kind === 'player' ? auth.userId : null
    if (!(Number.isInteger(options?.worldProtocol) && options.worldProtocol >= WORLD_PROTOCOL)) {
      this.outdated.add(client)
      this.metrics.outdatedJoins++
      // ECO-GAMEPLAY-2: it is the player's socket now — a running battle loses its old one (paused).
      if (playerId !== null) this.ecoBattles?.socketJoined(client, playerId, false)
      return
    }
    // ECO-GAMEPLAY-1: only a client that declared the ECO protocol is sent the ECO population.
    const eco = this.eco !== null && options?.ecoProtocol === ECO_PROTOCOL
    this.clients.set(client, { areaId: null, chunks: new Set(), pending: null, playerId, eco })
    // ECO-GAMEPLAY-2: the player's new socket. ECO: takes its battle over; otherwise the battle pauses.
    if (playerId !== null) this.ecoBattles?.socketJoined(client, playerId, eco)
    if (playerId !== null) this.authority.newConnection(playerId)
    if (playerId !== null && this.playerData) void this.#sendPlayerState(client, playerId)
  }

  leave(client) {
    const state = this.clients.get(client)
    this.waiting.delete(client)
    if (!state) return
    // The owner's socket is gone (not replaced by a newer one): the unit in
    // progress finishes and settles, then the worker retires (YIELD-2).
    if (state.playerId !== null && this.clientForPlayer?.(state.playerId) === client) this.authority.ownerLeft(state.playerId)
    // ECO-GAMEPLAY-2: only the battle's current socket pauses it (a replaced one changes nothing).
    if (state.playerId !== null) this.ecoBattles?.socketLeft(client, state.playerId)
    this.#unsubscribeAll(client, state)
    this.clients.delete(client)
  }

  async #sendPlayerState(client, playerId) {
    try {
      const state = await this.playerData.playerState(playerId)
      this.skills?.primePlayer?.(playerId, state)
      if (this.clients.has(client)) this.#send(client, WORLD_MESSAGE.PLAYER_STATE, { playerId, ...state })
    } catch (error) {
      this.log(`[world] player state unavailable (${String(error?.message ?? error).slice(0, 60)})`)
    }
  }

  /** Full reset for a viewer: on ready, on every area change and on every guest observe. */
  snapshot(client, viewer) {
    const state = this.clients.get(client)
    if (!state) return
    if (!this.ready) { this.waiting.set(client, { ...viewer }); return }
    this.#unsubscribeAll(client, state)
    state.pending = null
    state.areaId = viewer.areaId
    const nodes = []
    const chunks = worldArea(viewer.areaId)?.procedural ? chunksInView(viewer.tx, viewer.ty) : []
    for (const chunkId of chunks) nodes.push(...this.#subscribe(client, state, chunkId))
    const own = viewer.id ? this.authority.actionOf(viewer.id) : null
    const procedural = worldArea(viewer.areaId)?.procedural === true
    const wild = this.wild?.roster(viewer.areaId) ?? null
    const eco = state.eco ? this.eco.view(viewer.areaId) : null
    this.#send(client, WORLD_MESSAGE.SNAPSHOT, {
      now: this.now(), areaId: viewer.areaId, chunks, nodes,
      ...(wild ? { wild } : {}),
      // In the ECO experiment there is no roster: a client without the ECO protocol is told so (fail closed).
      ...(procedural && !eco ? { wildStatus: this.wild ? this.wild.status(viewer.areaId) : 'unavailable' } : {}),
      ...(eco ? { eco } : {}),
      // Who, what and since when: never the end (PROB-2).
      ...(own ? { ownAction: { actionId: own.actionId, nodeId: own.node.id, startedAt: own.startedAt } } : {}),
    })
    this.metrics.snapshots++
    // ECO-GAMEPLAY-2: the owner's running battle, again, after its world snapshot (reconnection resume).
    if (eco && state.playerId !== null) this.ecoBattles.resume(client, state.playerId)
    // ECO-BATTLE-SPECTATORS-1: everyone else's running battles here, as they are now (no past effects).
    // The snapshot is a full reset for the client: nothing it saw before arriving is kept.
    if (eco) for (const view of this.ecoBattles.publicBattlesIn(viewer.areaId, state.playerId)) this.#send(client, WORLD_MESSAGE.ECO_BATTLE_PUBLIC, view)
  }

  /** The viewer moved: adjust its chunk window (usually a no-op) and keep its action physical. */
  viewerMoved(client, viewer) {
    if (viewer.id) this.authority.reconcileActor(viewer)
    const state = this.clients.get(client)
    if (!state || state.areaId !== viewer.areaId || !worldArea(viewer.areaId)?.procedural) return
    // A batch never lists one chunk in both `leave` and `enter`: the client
    // applies leaves first, and an `enter` replaces the chunk's content whole.
    for (const chunkId of state.chunks) {
      if (isChunkRetained(chunkId, viewer.tx, viewer.ty)) continue
      this.#unsubscribe(client, state, chunkId)
      const pending = this.#pending(state)
      pending.enter = pending.enter.filter(entry => entry.chunk !== chunkId)
      pending.leave.push(chunkId)
      this.metrics.chunkLeaves++
    }
    for (const chunkId of chunksInView(viewer.tx, viewer.ty)) {
      if (state.chunks.has(chunkId)) continue
      const pending = this.#pending(state)
      pending.leave = pending.leave.filter(id => id !== chunkId)
      pending.enter.push({ chunk: chunkId, nodes: this.#subscribe(client, state, chunkId) })
      this.metrics.chunkEnters++
    }
  }

  /** An actor changed area or rejoined: its action cannot survive a teleport. */
  actorPlaced(actor) {
    this.authority.reconcileActor(actor)
    // ECO-GAMEPLAY-2: a battle does not follow its owner to another area (released, nothing retired).
    this.ecoBattles?.actorPlaced(actor)
  }

  /**
   * A work intent. `client` is the socket it came from (the room passes it);
   * without it, the player's current socket. A socket that did not declare
   * this world protocol cannot start anything: it is told `client-outdated`
   * directly (it has no world subscription) and nothing is checked or held.
   */
  work(actor, payload, client = this.clientForPlayer(actor.id)) {
    if (!client || !this.clients.has(client)) {
      this.metrics.outdatedWork++
      // `message` is what an old client shows as is (it prefers a server message to its own words).
      const reply = { requestId: Number.isSafeInteger(payload?.requestId) ? payload.requestId : null, ok: false, reason: 'client-outdated', message: 'Actualizá la página para seguir trabajando.' }
      client?.send(WORLD_MESSAGE.WORK_RESULT, reply)
      return reply
    }
    const intent = workIntent(payload)
    if (!intent) return this.#sendToPlayer(actor.id, WORLD_MESSAGE.WORK_RESULT, { requestId: null, ok: false, reason: 'invalid' })
    if (!this.ready) return this.#sendToPlayer(actor.id, WORLD_MESSAGE.WORK_RESULT, { requestId: intent.requestId, ok: false, reason: 'world-loading' })
    return this.authority.requestWork(actor, intent)
  }

  cancel(actor, payload, client = this.clientForPlayer(actor.id)) {
    if (!client || !this.clients.has(client)) return
    const intent = cancelIntent(payload)
    if (intent) this.authority.cancel(actor.id, intent.actionId, 'cancelled')
  }

  /**
   * ECO-GAMEPLAY-1 test retirement (development only; the experiment is refused in production).
   * `actor`: the player's live actor, or null for a guest. The cause is fixed by the server
   * (`fled`): no capture, drop, token or persistent value.
   */
  ecoDevRetire(actor, payload, client) {
    const requestId = Number.isSafeInteger(payload?.requestId) ? payload.requestId : null
    const reply = result => { client?.send(WORLD_MESSAGE.ECO_DEV_RETIRE_RESULT, result); return result }
    if (!client || !this.clients.has(client)) return reply({ requestId, encounterId: null, ok: false, reason: 'client-outdated' })
    if (!this.eco) return reply({ requestId, encounterId: null, ok: false, reason: 'disabled' })
    const intent = ecoRetireIntent(payload)
    if (!intent) return reply({ requestId, encounterId: null, ok: false, reason: 'invalid' })
    const result = this.eco.devRetire(actor, intent.encounterId, this.now())
    return reply({ requestId: intent.requestId, encounterId: intent.encounterId, ...result })
  }

  /** ECO-GAMEPLAY-2: reserve an encounter for a test battle (development-only experiment). */
  ecoEngage(actor, payload, client) {
    const requestId = Number.isSafeInteger(payload?.requestId) ? payload.requestId : null
    const refuse = reason => { const r = { requestId, encounterId: null, ok: false, reason }; client?.send(WORLD_MESSAGE.ECO_ENGAGE_RESULT, r); return r }
    if (!this.ecoBattles) return refuse('disabled')
    if (!client || !this.clients.get(client)?.eco) return refuse('client-outdated')
    return this.ecoBattles.engage(actor, payload, client, actor ? this.clientForPlayer(actor.id) : null)
  }

  /** ECO-GAMEPLAY-2: one battle action; the controller is this transport's player. */
  ecoBattleAction(actor, payload, client) {
    if (!this.ecoBattles || !client || !this.clients.get(client)?.eco) return this.#ecoBattleRefused(client, this.ecoBattles ? 'client-outdated' : 'disabled', payload)
    return this.ecoBattles.action(actor, payload, client, actor ? this.clientForPlayer(actor.id) : null)
  }

  /** ECO-GAMEPLAY-2: flee the test battle (released, nothing retired). */
  ecoFlee(actor, payload, client) {
    if (!this.ecoBattles || !client || !this.clients.get(client)?.eco) return this.#ecoBattleRefused(client, this.ecoBattles ? 'client-outdated' : 'disabled', payload)
    return this.ecoBattles.flee(actor, payload, client, actor ? this.clientForPlayer(actor.id) : null)
  }

  #ecoBattleRefused(client, reason, payload) {
    const battleId = typeof payload?.battleId === 'string' ? payload.battleId.slice(0, 64) : null
    const actionId = typeof payload?.actionId === 'string' ? payload.actionId.slice(0, 96) : null
    client?.send(WORLD_MESSAGE.ECO_BATTLE, { battleId, events: [], result: { kind: 'rejected', reason, actionId } })
    return reason
  }

  tick(now = this.now()) {
    this.authority.tick(now)
    this.wild?.tick(now)
    if (this.eco) {
      // Active = an area with at least one world viewer (player or observer) right now.
      const activeAreas = new Set()
      for (const state of this.clients.values()) if (state.areaId) activeAreas.add(state.areaId)
      this.eco.tick(now, activeAreas)
      this.ecoBattles.tick(now)
    }
  }

  /** Aggregate counters for /metrics: sizes and totals only, never an id or a tile. */
  stats() {
    const authority = this.authority
    return {
      wild: this.wild ? { epoch: this.wild.epoch, ...this.wild.metrics } : null,
      eco: this.eco ? { status: this.eco.status, ...this.eco.metrics, battles: this.ecoBattles.stats() } : null,
      clients: this.clients.size, subscribedChunks: this.subscribers.size, storedNodes: authority.store.size, nodesByState: authority.store.countByState(),
      runningActions: authority.actions.size, queued: authority.queue.size,
      actions: { ...authority.metrics, rejected: { ...authority.metrics.rejected } }, transport: { ...this.metrics },
      playerData: this.playerData?.metrics?.() ?? null,
    }
  }

  /** Sends every pending world batch. Called right after the presence flush. */
  flush() {
    const now = this.now()
    for (const [client, state] of this.clients) {
      const pending = state.pending
      if (!pending) continue
      state.pending = null
      const batch = { now }
      if (pending.enter.length) batch.enter = pending.enter
      if (pending.leave.length) batch.leave = pending.leave
      if (pending.nodes.size) batch.nodes = [...pending.nodes.values()]
      this.#send(client, WORLD_MESSAGE.BATCH, batch)
      this.metrics.batches++
    }
    this.#flushEco(now)
  }

  /** ECO-GAMEPLAY-1: every changed area's whole view, to its ECO viewers, at the same flush. */
  #flushEco(now) {
    if (!this.eco || this.ecoDirty.size === 0) return
    const views = new Map([...this.ecoDirty].map(areaId => [areaId, this.eco.view(areaId)]))
    this.ecoDirty.clear()
    for (const [client, state] of this.clients) {
      const eco = state.eco ? views.get(state.areaId) : undefined
      if (eco) this.#send(client, WORLD_MESSAGE.ECO, { now, eco })
    }
  }

  /** A new hour: everyone in the area gets the same roster at the same flush. */
  #rosterChanged(roster) {
    const now = this.now()
    for (const [client, state] of this.clients) {
      if (state.areaId === roster.areaId) this.#send(client, WORLD_MESSAGE.WILD, { now, wild: roster, status: 'ready' })
    }
  }

  /** Fail closed, out loud: viewers of an area with no roster learn why they see no wild Pokémon. */
  #wildUnavailable(areaId) {
    const now = this.now()
    for (const [client, state] of this.clients) {
      if (state.areaId === areaId) this.#send(client, WORLD_MESSAGE.WILD, { now, wild: null, status: 'unavailable' })
    }
  }

  #nodeChanged(record) {
    const node = publicNode(record)
    for (const client of this.subscribers.get(chunkKey(record.areaId, record.chunkId)) ?? []) {
      const state = this.clients.get(client)
      if (!state) continue
      this.#pending(state).nodes.set(node.id, node)
      this.metrics.nodeDeltas++
    }
  }

  #subscribe(client, state, chunkId) {
    const key = chunkKey(state.areaId, chunkId)
    let set = this.subscribers.get(key)
    if (!set) { set = new Set(); this.subscribers.set(key, set) }
    set.add(client)
    state.chunks.add(chunkId)
    return this.authority.store.inChunk(state.areaId, chunkId).map(publicNode)
  }

  #unsubscribe(client, state, chunkId) {
    const key = chunkKey(state.areaId, chunkId)
    const set = this.subscribers.get(key)
    set?.delete(client)
    if (set?.size === 0) this.subscribers.delete(key)
    state.chunks.delete(chunkId)
    // A node change queued for a chunk being dropped must not outlive it.
    if (state.pending) for (const [id, node] of state.pending.nodes) if (chunkOfNodeId(id) === chunkId) state.pending.nodes.delete(node.id)
  }

  #unsubscribeAll(client, state) {
    for (const chunkId of [...state.chunks]) this.#unsubscribe(client, state, chunkId)
  }

  #pending(state) {
    state.pending ??= { enter: [], leave: [], nodes: new Map() }
    return state.pending
  }

  /** ECO-BATTLE-SPECTATORS-1: every ECO viewer whose area is `areaId`, except any socket of `exceptPlayerId`. */
  #sendToEcoArea(areaId, type, payload, exceptPlayerId) {
    for (const [client, state] of this.clients) {
      if (!state.eco || state.areaId !== areaId) continue
      if (exceptPlayerId !== null && exceptPlayerId !== undefined && state.playerId === exceptPlayerId) continue
      this.#send(client, type, payload)
    }
  }

  #sendToPlayer(playerId, type, payload) {
    const client = this.clientForPlayer(playerId)
    if (client && this.clients.has(client)) this.#send(client, type, payload)
    return payload
  }

  #send(client, type, payload) {
    const bytes = JSON.stringify(payload).length
    this.metrics.bytes += bytes
    if (bytes > this.metrics.maxBatchBytes) this.metrics.maxBatchBytes = bytes
    client.send(type, payload)
  }
}

function chunkOfNodeId(id) {
  const [, tx, ty] = id.split(':')
  return chunkOf(Number(tx), Number(ty))
}
