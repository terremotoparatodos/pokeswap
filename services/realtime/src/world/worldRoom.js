import { chunkOf, worldArea } from './areas.js'
import { ResourceAuthority } from './resourceAuthority.js'
import { chunkKey } from './resourceStore.js'
import { WORLD_MESSAGE, WORLD_PROTOCOL, cancelIntent, publicNode, workIntent } from './worldProtocol.js'
import { chunksInView, isChunkRetained } from './worldInterest.js'
import { WildService } from './wildService.js'

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
  constructor({ skills, ownership, lookupActor, clientForPlayer, catalog = null, playerData = null, now = Date.now, authority = null, log = message => console.warn(message) }) {
    this.now = now
    this.clientForPlayer = clientForPlayer
    this.clients = new Map()
    this.subscribers = new Map()
    this.playerData = playerData
    this.skills = skills
    this.log = log
    /** False until persisted state is back: until then no world is served (fail closed). */
    this.ready = playerData === null
    this.waiting = new Map()
    this.metrics = { snapshots: 0, batches: 0, nodeDeltas: 0, chunkEnters: 0, chunkLeaves: 0, maxBatchBytes: 0, bytes: 0 }
    this.wild = new WildService({ catalog, now, onRoster: roster => this.#rosterChanged(roster), onUnavailable: areaId => this.#wildUnavailable(areaId) })
    this.authority = authority ?? new ResourceAuthority({
      skills, ownership, lookupActor, now,
      onNode: record => this.#nodeChanged(record),
      onResult: (playerId, result) => this.#sendToPlayer(playerId, WORLD_MESSAGE.WORK_RESULT, result),
      onDone: (playerId, done) => this.#sendToPlayer(playerId, WORLD_MESSAGE.WORK_DONE, done),
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
    if (!(Number.isInteger(options?.worldProtocol) && options.worldProtocol >= WORLD_PROTOCOL)) return
    const playerId = auth?.kind === 'player' ? auth.userId : null
    this.clients.set(client, { areaId: null, chunks: new Set(), pending: null, playerId })
    if (playerId !== null && this.playerData) void this.#sendPlayerState(client, playerId)
  }

  leave(client) {
    const state = this.clients.get(client)
    this.waiting.delete(client)
    if (!state) return
    this.#unsubscribeAll(client, state)
    this.clients.delete(client)
  }

  async #sendPlayerState(client, playerId) {
    try {
      const state = await this.playerData.playerState(playerId)
      this.skills?.primePlayer?.(playerId, state)
      if (this.clients.has(client)) this.#send(client, WORLD_MESSAGE.PLAYER_STATE, state)
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
    const wild = this.wild.roster(viewer.areaId)
    this.#send(client, WORLD_MESSAGE.SNAPSHOT, {
      now: this.now(), areaId: viewer.areaId, chunks, nodes,
      ...(wild ? { wild } : {}),
      ...(procedural ? { wildStatus: this.wild.status(viewer.areaId) } : {}),
      ...(own ? { ownAction: { actionId: own.actionId, nodeId: own.node.id, startedAt: own.startedAt, endsAt: own.endsAt } } : {}),
    })
    this.metrics.snapshots++
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
  }

  work(actor, payload) {
    const intent = workIntent(payload)
    if (!intent) return this.#sendToPlayer(actor.id, WORLD_MESSAGE.WORK_RESULT, { requestId: null, ok: false, reason: 'invalid' })
    if (!this.ready) return this.#sendToPlayer(actor.id, WORLD_MESSAGE.WORK_RESULT, { requestId: intent.requestId, ok: false, reason: 'world-loading' })
    return this.authority.requestWork(actor, intent)
  }

  cancel(actor, payload) {
    const intent = cancelIntent(payload)
    if (intent) this.authority.cancel(actor.id, intent.actionId, 'cancelled')
  }

  tick(now = this.now()) {
    this.authority.tick(now)
    this.wild.tick(now)
  }

  /** Aggregate counters for /metrics: sizes and totals only, never an id or a tile. */
  stats() {
    const authority = this.authority
    return {
      wild: { epoch: this.wild.epoch, ...this.wild.metrics },
      clients: this.clients.size, subscribedChunks: this.subscribers.size, storedNodes: authority.store.size,
      runningActions: authority.actions.size, queued: authority.queue.size,
      actions: { ...authority.metrics, rejected: { ...authority.metrics.rejected } }, transport: { ...this.metrics },
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
