import { Room, ServerError } from '@colyseus/core'
import { authenticateSupabase, authorizedCompanion } from '../auth/supabaseAuth.js'
import { ChatLog, acceptChat, chatIntent, chatMessage } from '../chat/chat.js'
import { CONNECTION_LIMIT, hasCapacity } from '../presence/capacity.js'
import { areaTransition, stepAllowed } from '../presence/areaTransition.js'
import { AREA_TRANSITION_DENIED } from '../protocol/crossing.js'
import { applyMove } from '../presence/movement.js'
import { ARRIVALS } from '../protocol/arrival.js'
import { isSafeLanding } from '../world/navigation.js'
import { ReconnectCache } from '../presence/reconnectCache.js'
import { visibleActors } from '../presence/interest.js'
import { AREA, COMPACT_STEP_PROTOCOL, MESSAGE, areaIntent, moveIntent, observeIntent, publicActor, stackStep, stepActor } from '../protocol/messages.js'
import { metrics } from '../observability/metrics.js'
import { WORLD_MESSAGE } from '../world/worldProtocol.js'
import { WorldRoom } from '../world/worldRoom.js'
import { worldDependencies } from '../world/worldConfig.js'
import { LocationService, locationMode } from '../presence/locationService.js'
import { LocationJoin } from './locationJoin.js'
import { CLOSE_CODES_PROTOCOL, HOST_DRAINING_CODE } from '../protocol/closeCodes.js'
import { PresenceHosting } from './presenceHosting.js'

/** The public `presence:error` reason of each refused step (aggregate kinds in metrics). */
const MOVE_REJECTION_REASON = Object.freeze({
  invalid: 'movement denied', replay: 'movement replay denied', sequence: 'movement sequence denied',
  rate: 'movement rate denied', blocked: 'movement blocked',
})

const actors = new Map()
const clientsByActor = new Map()
const observers = new Map()
// Each socket remembers its last server-approved interest set. This is ephemeral
// transport state, not player state: it lets us send an explicit leave when a
// player crosses a wild-sector boundary.
const visibleByClient = new Map()
// Sockets that declared they understand compact `step` deltas. Kept outside
// `userData` because a guest's observe() replaces that object.
const compactClients = new WeakSet()
const reconnectingActors = new ReconnectCache()
// Community Playtest 0.1: the last lines of each area, in memory. It dies with
// the process on purpose — chat is not state this playtest should persist.
const chatLog = new ChatLog()
let chatSequence = 0
// WORLD-1: resource nodes and work actions. Module-level like the maps above,
// so the world survives a room dispose; it rides this room's socket and tick.
/** The live room, for moves the world makes on a player's behalf (WORLD VISUAL-2). */
let presenceRoom = null
const initialDependencies = worldDependencies()
let world = createWorld(initialDependencies)
void world.start()
// WORLD LOCATION-2: persisted locations. WORLD_LOCATION_PERSISTENCE=off|shadow|on,
// one process-wide flag (no per-user gate, D-L4); missing or unknown = off.
// Rollback: set it to off and restart; the database is not touched.
// Per-socket sessions, hydration and fencing live in rooms/locationJoin.js.
let location = null
// WORLD LOCATION-4: this process as a presence host — admission, drain and close codes
// (rooms/presenceHosting.js). Null host when location is off: joins are accepted at once.
const hosting = new PresenceHosting({ location: () => location, sockets: () => observers.values(), metrics })
metrics.host = () => hosting.stats()
const locationJoin = new LocationJoin({ actors, clientsByActor, location: () => location, closeReplaced: hosting.closeReplaced })
location = createLocation({ mode: locationMode(process.env.WORLD_LOCATION_PERSISTENCE), store: initialDependencies.playerData })
if (location.mode !== 'off') console.log(`[location] persistence ${location.mode} (effective: ${location.effective})`)

function createLocation(options) {
  const service = new LocationService({
    ...options,
    onFenced: (userId, epoch, session) => locationJoin.fence(userId, epoch, session),
    onClaimed: (session, result) => { if (presenceRoom) locationJoin.claimSettled(presenceRoom, session, result) },
  })
  metrics.location = () => service.stats()
  service.start()
  return service
}

function createWorld(dependencies) {
  const created = new WorldRoom({
    ...dependencies,
    lookupActor: id => actors.get(id) ?? null,
    clientForPlayer: id => clientsByActor.get(id) ?? null,
    placeActor: (id, place) => {
      const actor = actors.get(id)
      if (actor && presenceRoom) presenceRoom.placeActor(actor, place)
      else if (actor) Object.assign(actor, place)
    },
  })
  metrics.world = () => created.stats()
  return created
}

/**
 * The live actor of a player, or null (tests and the local benchmark only:
 * they stand an actor on a portal with `placeActor` before a real crossing).
 */
export function liveActorForTesting(userId) {
  return actors.get(userId) ?? null
}

/**
 * Replaces the location persistence (tests, and the process entry point with
 * the env flag). `store` defaults to the world's player data. The previous
 * service is disabled first: nothing it held is written afterwards.
 */
export function configureLocationPersistence({ mode, store = initialDependencies.playerData, ...options } = {}) {
  location.disable()
  location = createLocation({ mode, store, host: hosting.host, ...options })
  return location
}

/**
 * Before listen (realtimeServer.js): acquire this process's generation (the host stays
 * 'starting' until `activate()` after listen). Null when location is off or unsupported.
 */
export function preparePresenceHost(options) {
  return hosting.prepare(initialDependencies.playerData, options)
}

/** The drain of this process (Colyseus onBeforeShutdown, or a newer host): see PresenceHosting.drain. */
export function drainPresence(options) {
  return hosting.drain(options)
}

/** Tests and tooling: undo a drain (a fresh process never starts draining). */
export function resetDrainingForTesting() { hosting.resetDraining() }

/** realtimeServer.js: what to do when, in `on`, this process's host stops (exit, code 0). */
export function onPresenceHostStopped(callback) { hosting.onStopped = callback }

/** Readiness for /readyz: serving players (shadow always serves). */
export function presenceServing() { return hosting.serving }

/** Tests and tooling: replace this process's host (null: none); see PresenceHosting.configure. */
export function configurePresenceHost(next, options) {
  return hosting.configure(next, options)
}

/** Best-effort final flush of every pending location (graceful shutdown). */
export function flushLocationsForShutdown(deadlineMs) {
  return location.shutdown(deadlineMs)
}

/** Replaces the world's SKILLS/ownership adapters (tests and local tooling). Drops all world state. */
export function configureWorld(dependencies) {
  world = createWorld(dependencies)
  void world.start()
  return world
}

export class PresenceRoom extends Room {
  static connections = 0
  maxClients = CONNECTION_LIMIT
  autoDispose = false
  deltaBatching = false
  pendingDeltas = new Map()

  async onAuth(_client, options) {
    const auth = await authenticateSupabase(options?.token, process.env)
    return { ...auth, token: options?.token ?? null }
  }

  onCreate() {
    presenceRoom = this
    this.deltaBatching = true
    this.setSimulationInterval(() => { world.tick(); this.flushDeltaBatches(); world.flush() }, 50)
    this.onMessage(MESSAGE.READY, client => this.ready(client))
    this.onMessage(MESSAGE.MOVE, (client, payload) => this.move(client, payload))
    this.onMessage(MESSAGE.AREA, (client, payload) => this.changeArea(client, payload))
    this.onMessage(MESSAGE.OBSERVE, (client, payload) => this.observe(client, payload))
    this.onMessage(MESSAGE.CHAT, (client, payload) => this.chat(client, payload))
    this.onMessage(WORLD_MESSAGE.WORK, (client, payload) => this.work(client, payload))
    this.onMessage(WORLD_MESSAGE.CANCEL, (client, payload) => this.cancelWork(client, payload))
  }

  async onJoin(client, options, auth) {
    // WORLD LOCATION-4: waits for activation; 4503 while draining; a resume never displaces another tab (4409).
    await hosting.admit(client, options, auth, userId => clientsByActor.get(userId))
    if (!hasCapacity(PresenceRoom.connections)) { metrics.rejected('capacity'); throw new ServerError(4210, 'capacity reached') }
    PresenceRoom.connections++
    if (Number.isInteger(options?.presenceProtocol) && options.presenceProtocol >= COMPACT_STEP_PROTOCOL) compactClients.add(client)
    world.join(client, options, auth)
    if (auth.kind === 'guest') {
      metrics.joined('guest')
      client.userData = { observer: { areaId: AREA.TOWN, tx: 31, ty: 20 } }
      observers.set(client.sessionId, client)
      return
    }
    const previous = clientsByActor.get(auth.userId)
    if (previous && previous !== client) locationJoin.replace(previous)
    const visual = options?.visual
    const characterId = ['lucas', 'dawn-pink', 'dawn-yellow'].includes(visual?.characterId) ? visual.characterId : 'lucas'
    // WORLD LOCATION-2: the new session of a persisting player (synchronous: no database wait).
    const session = locationJoin.begin(client, auth, options)
    // Replace the old socket before any optional visual lookup. Otherwise a
    // reload can let the old onLeave remove presence seen by other clients.
    const live = actors.has(auth.userId)
    const restored = live ? null : reconnectingActors.take(auth.userId)
    if (restored) {
      metrics.restored()
      // CAVES-4: a remembered tile is only trusted if it is still a safe
      // landing (walkable and not a portal). Otherwise the area's own arrival.
      if (!isSafeLanding(restored.areaId, restored.tx, restored.ty)) {
        const fallback = ARRIVALS[restored.areaId] ?? ARRIVALS[AREA.TOWN]
        if (!ARRIVALS[restored.areaId]) restored.areaId = AREA.TOWN
        restored.tx = fallback.tx; restored.ty = fallback.ty; restored.dir = fallback.dir
        metrics.restoreRepaired()
      }
    }
    // The session owns the player id from here on, placed or not.
    clientsByActor.set(auth.userId, client); observers.set(client.sessionId, client); client.userData = { actorId: auth.userId }; metrics.joined('player')
    const join = { auth, characterId, visual }
    if (locationJoin.mustHydrate(session, live, restored)) {
      // Mode `on`, nothing in memory: placed once the claim answers (or at the
      // 1.5 s timeout). Until then nobody sees it and it can do nothing.
      locationJoin.hydrate(this, client, session, join)
      return
    }
    locationJoin.claimInBackground(session, live, restored)
    this.admit(client, actors.get(auth.userId) ?? restored ?? this.freshActor(auth, characterId), join)
  }

  /** A new actor at Ciudad's spawn, or at a validated restored place. */
  freshActor(auth, characterId, place = { areaId: AREA.TOWN, tx: 31, ty: 20, dir: 'down' }) {
    return { id: auth.userId, areaId: place.areaId, tx: place.tx, ty: place.ty, username: auth.username, characterId, companionId: null, dir: place.dir, speed: 3.75, moveSequence: 0, lastMoveAt: 0, moves: [] }
  }

  /** Puts a reserved player's actor in the world: visible, steerable, published. */
  admit(client, actor, { auth, characterId, visual }) {
    actor.username = auth.username
    actor.characterId = characterId
    actors.set(actor.id, actor)
    world.actorPlaced(actor)
    this.publish(actor)
    locationJoin.admitted(client, actor)
    // Companion ownership is a display enhancement. It must never delay or
    // invalidate the atomic actor replacement above.
    void authorizedCompanion(auth.userId, visual?.companionPokemonId, auth.token, process.env)
      .then(companionId => {
        if (companionId === null || clientsByActor.get(actor.id) !== client || actors.get(actor.id) !== actor) return
        actor.companionId = companionId
        this.publish(actor)
      })
      .catch(() => undefined)
  }

  // The join handshake may resolve after an eager application message reaches
  // the browser. A client-ready signal guarantees its message handlers exist
  // before the first server-authoritative spawn is emitted.
  ready(client) {
    // A player still waiting for its claim gets its first snapshot once placed.
    if (locationJoin.deferReady(client)) return
    const viewer = actors.get(client.userData?.actorId) ?? client.userData?.observer
    if (!viewer) return this.reject(client, 'ready denied', 'invalid')
    this.sendSnapshot(client, viewer)
  }

  /** While draining nothing moves: refused, and answered with the actor where it really is. */
  frozen(client) {
    this.reject(client, 'host draining', 'draining')
    const actor = actors.get(client.userData?.actorId)
    if (actor) this.sendSelf(client, actor)
  }

  /**
   * WORLD LOCATION-4 (design §5.2): Colyseus' default closes every client with 4001
   * SERVER_SHUTDOWN, which clients read as "replaced" and stop. Here a shutdown closes with
   * 4503 host-draining: every client reconnects. realtimeServer.js has already drained
   * (saved) before Colyseus calls this.
   */
  onBeforeShutdown() {
    hosting.shuttingDown(this.clients)
    this.disconnect(HOST_DRAINING_CODE).catch(() => {})
  }

  onLeave(client) {
    PresenceRoom.connections = Math.max(0, PresenceRoom.connections - 1)
    metrics.left(client.userData?.actorId ? 'player' : 'guest')
    const id = client.userData?.actorId
    observers.delete(client.sessionId)
    visibleByClient.delete(client.sessionId)
    this.pendingDeltas.delete(client)
    world.leave(client)
    if (!id) return
    // A replaced browser may finish closing after the new session has joined.
    // It must not remove the newer actor with the same user id.
    if (clientsByActor.get(id) !== client) { locationJoin.left(client, false); return }
    const actor = actors.get(id); actors.delete(id); clientsByActor.delete(id)
    // A fenced session lost its player to a newer one elsewhere: not remembered here.
    const rememberable = locationJoin.left(client, true, actor)
    if (actor) {
      if (rememberable) reconnectingActors.remember(id, actor)
      this.broadcastDelta({ type: 'leave', actor: publicActor(actor) }, actor)
    }
  }

  move(client, payload) {
    if (hosting.draining) return this.frozen(client)
    const actor = actors.get(client.userData?.actorId); const intent = moveIntent(payload)
    if (!actor || !intent) return this.reject(client, 'movement denied', 'invalid')
    const rejection = applyMove(actor, intent.direction, Date.now(), intent.running, intent.sequence, stepAllowed)
    if (rejection) {
      this.reject(client, MOVE_REJECTION_REASON[rejection], rejection)
      // A refused step must still be answered with authority (see applyMove),
      // once, to this client only: observers never hear of it. A replay too:
      // after a server-made move (WORLD VISUAL-2) an older client's next
      // number is already taken, and this resyncs it. A step into a wall or
      // past an edge (CAVES-3/4) and a skipped number (CAVES-4) likewise.
      if (rejection !== 'invalid' && intent.sequence !== null) this.sendSelf(client, actor)
      return
    }
    metrics.moved()
    locationJoin.moved(client, actor)
    this.publish(actor, stepActor(actor))
    // Moving the viewport changes its whole interest set even when every
    // other actor is stationary. Reconcile entrants/leavers for this client.
    this.syncVisibility(client, actor)
    world.viewerMoved(client, actor)
    this.sendSelf(client, actor)
  }

  changeArea(client, payload) {
    if (hosting.draining) return this.frozen(client)
    const actor = actors.get(client.userData?.actorId); const intent = areaIntent(payload)
    if (!actor || !intent) return this.reject(client, 'area denied', 'area')
    // CAVES-3/4: the service decides whether this crossing is allowed and
    // where it lands: through a portal only standing on it, nothing else —
    // there is no "Ciudad" teleport (presence/areaTransition.js). A refusal
    // moves nothing and tells no observer: it answers once, to this client,
    // with the actor's real area and tile, so a client waiting for the area
    // it asked for (an old bundle's "Ciudad" included) reconciles to where it
    // actually is. Running work is untouched: the actor did not move.
    const transition = areaTransition(actor, intent.areaId)
    if (!transition) {
      this.reject(client, AREA_TRANSITION_DENIED, 'area')
      this.sendSnapshot(client, actor)
      return
    }
    metrics.transition(transition.kind)
    // A resync on a valid tile moves nothing and tells no one: the snapshot
    // is the real state the client asked for.
    if (!transition.arrival) return this.sendSnapshot(client, actor)
    // Must match the client's own arrival tile (see protocol/arrival.js):
    // the client keeps predicting from there before this snapshot reaches it.
    const { arrival } = transition
    actor.areaId = intent.areaId
    actor.tx = arrival.tx; actor.ty = arrival.ty; actor.dir = arrival.dir
    metrics.changedArea()
    // A crossing is saved first (urgent): losing the area is worse than losing a tile.
    locationJoin.moved(client, actor, true)
    world.actorPlaced(actor)
    this.publish(actor); this.sendSnapshot(client, actor)
  }

  observe(client, payload) {
    if (client.userData?.actorId) return this.reject(client, 'observer-only', 'invalid')
    const observer = observeIntent(payload)
    if (!observer) return this.reject(client, 'observer denied', 'invalid')
    client.userData = { observer }
    this.sendSnapshot(client, observer)
  }

  /**
   * Community Playtest 0.1 — area chat.
   *
   * Players only: a guest joins as an observer with no username, and a line
   * with no name behind it is not something a two-hour playtest should have to
   * moderate. Guests read what the area is saying and cannot add to it.
   */
  chat(client, payload) {
    const actor = actors.get(client.userData?.actorId)
    if (!actor) return this.reject(client, 'chat denied', 'invalid')
    const intent = chatIntent(payload)
    if (!intent) return this.reject(client, 'chat denied', 'invalid')
    const now = Date.now()
    if (!acceptChat(actor, now)) return this.reject(client, 'chat rate denied', 'rate')
    const message = chatMessage(actor, intent.text, now, ++chatSequence)
    chatLog.append(message)
    this.broadcastChat(message)
  }

  /**
   * Everyone in the area hears it, near or far.
   *
   * Deliberately not filtered by `visibleActors` the way presence is: interest
   * management exists so a client is not told about a trainer it cannot see,
   * but a chat you can only read from six tiles away is not a chat.
   */
  broadcastChat(message) {
    for (const client of observers.values()) {
      const viewer = actors.get(client.userData?.actorId) ?? client.userData?.observer
      if (viewer?.areaId === message.areaId) client.send(MESSAGE.CHAT_LINE, message)
    }
  }

  /**
   * WORLD-1: a player asks to work a resource node with one of its Pokémon.
   * Players only, like chat: a guest has no actor to stand beside a node.
   */
  work(client, payload) {
    if (hosting.draining) return this.frozen(client)
    const actor = actors.get(client.userData?.actorId)
    if (!actor) return this.reject(client, 'world denied', 'invalid')
    void world.work(actor, payload, client)
  }

  cancelWork(client, payload) {
    const actor = actors.get(client.userData?.actorId)
    if (actor) world.cancel(actor, payload, client)
  }

  /**
   * WORLD VISUAL-2: the server steps a trainer aside so its Pokémon can work.
   * Published like any step; the sequence advances so every viewer applies it
   * and the owner adopts it (its next move is numbered after this one).
   */
  placeActor(actor, place) {
    actor.tx = place.tx; actor.ty = place.ty; actor.dir = place.dir
    actor.moveSequence = (Number.isInteger(actor.moveSequence) ? actor.moveSequence : 0) + 1
    this.publish(actor, stepActor(actor))
    const client = clientsByActor.get(actor.id)
    if (!client) return
    locationJoin.moved(client, actor)
    this.syncVisibility(client, actor)
    world.viewerMoved(client, actor)
    this.sendSelf(client, actor)
  }

  /** `step` is given only for a pure move: identity is unchanged, so viewers that know the actor need just the step. */
  publish(actor, step = null) { this.broadcastDelta({ type: 'upsert', actor: publicActor(actor) }, actor, step) }
  broadcastDelta(delta, changed, step = null) {
    for (const client of observers.values()) {
      const viewer = actors.get(client.userData?.actorId) ?? client.userData?.observer
      if (!viewer || changed.id === viewer.id) continue
      const previous = visibleByClient.get(client.sessionId) ?? new Set()
      const visible = visibleActors(viewer, new Map([[changed.id, changed]]), previous).length > 0
      if (delta.type === 'leave' ? previous.has(changed.id) : visible) {
        const compact = step !== null && previous.has(changed.id) && compactClients.has(client)
        this.sendDelta(client, compact ? { type: 'step', actor: step } : delta)
      } else if (!visible && previous.has(changed.id)) {
        this.sendDelta(client, { type: 'leave', actor: publicActor(changed) })
      }
      if (delta.type === 'leave' || !visible) previous.delete(changed.id)
      else previous.add(changed.id)
      visibleByClient.set(client.sessionId, previous)
    }
  }
  syncVisibility(client, viewer) {
    const previous = visibleByClient.get(client.sessionId) ?? new Set()
    const visible = visibleActors(viewer, actors, previous)
    const next = new Set(visible.map(actor => actor.id))
    for (const actor of visible) {
      if (!previous.has(actor.id)) this.sendDelta(client, { type: 'upsert', actor: publicActor(actor) })
    }
    for (const id of previous) {
      if (next.has(id)) continue
      const actor = actors.get(id)
      if (actor) this.sendDelta(client, { type: 'leave', actor: publicActor(actor) })
    }
    visibleByClient.set(client.sessionId, next)
  }
  sendDelta(client, delta) {
    if (!this.deltaBatching) {
      client.send(MESSAGE.DELTA, delta)
      return
    }
    const pending = this.pendingDeltas.get(client) ?? new Map()
    // One entry per actor per 50 ms window. A step must not erase a full
    // upsert (e.g. a companion change) queued before it: fold the step's
    // position into that upsert. A step over a step keeps the earlier one in
    // `via` (see stackStep), so the viewer can still animate every tile.
    const queued = pending.get(delta.actor.id)
    const folds = delta.type === 'step' && queued?.type === 'upsert'
    const stacks = delta.type === 'step' && queued?.type === 'step'
    metrics.deltaQueued(!queued ? null : folds ? 'stepFoldedIntoUpsert' : stacks ? 'stepStacked' : 'replaced')
    pending.set(delta.actor.id, folds
      ? { type: 'upsert', actor: { ...queued.actor, ...delta.actor } }
      : stacks ? stackStep(queued, delta) : delta)
    this.pendingDeltas.set(client, pending)
  }
  flushDeltaBatches() {
    for (const [client, pending] of this.pendingDeltas) {
      if (pending.size > 0 && observers.has(client.sessionId)) {
        client.send(MESSAGE.BATCH, [...pending.values()])
        metrics.batchSent(pending.size)
      }
    }
    this.pendingDeltas.clear()
  }
  sendSnapshot(client, viewer) {
    // The snapshot supersedes any old-area operations still waiting for the
    // next 50 ms flush (ready, observe and area changes all pass through here).
    this.pendingDeltas.delete(client)
    const visible = viewer ? visibleActors(viewer, actors) : [...actors.values()]
    visibleByClient.set(client.sessionId, new Set(visible.map(actor => actor.id)))
    const self = client.userData?.actorId ? actors.get(client.userData.actorId) : null
    client.send(MESSAGE.SNAPSHOT, {
      // WORLD LOCATION-4: the close codes this server speaks (4409 / 4503; 4001 never replaces a protocol-3 client).
      presenceProtocol: CLOSE_CODES_PROTOCOL,
      access: self ? 'player' : 'guest',
      actors: visible.map(publicActor),
      ...(self ? { self: publicActor(self) } : {}),
    })
    // Arriving in the middle of a conversation should not look like silence.
    // A snapshot is sent on join and on every area change, which is exactly
    // when the history a client should hold changes.
    if (viewer?.areaId) client.send(MESSAGE.CHAT_HISTORY, { areaId: viewer.areaId, lines: chatLog.recent(viewer.areaId) })
    // The world state of the new window, after presence so the client places
    // the viewer before it draws what is around it.
    if (viewer) world.snapshot(client, viewer)
  }
  sendSelf(client, actor) { client.send(MESSAGE.SELF, publicActor(actor)) }
  reject(client, reason, kind) { metrics.rejected(kind); client.send(MESSAGE.ERROR, { code: 'invalid-intent', reason }) }
}
