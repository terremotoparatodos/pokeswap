import { Room, ServerError } from '@colyseus/core'
import { authenticateSupabase, authorizedCompanion } from '../auth/supabaseAuth.js'
import { ChatLog, acceptChat, chatIntent, chatMessage } from '../chat/chat.js'
import { CONNECTION_LIMIT, hasCapacity } from '../presence/capacity.js'
import { acceptMove } from '../presence/movement.js'
import { ReconnectCache } from '../presence/reconnectCache.js'
import { visibleActors } from '../presence/interest.js'
import { AREA, MESSAGE, areaIntent, moveIntent, observeIntent, publicActor } from '../protocol/messages.js'
import { metrics } from '../observability/metrics.js'

const actors = new Map()
const clientsByActor = new Map()
const observers = new Map()
// Each socket remembers its last server-approved interest set. This is ephemeral
// transport state, not player state: it lets us send an explicit leave when a
// player crosses a wild-sector boundary.
const visibleByClient = new Map()
const reconnectingActors = new ReconnectCache()
// Community Playtest 0.1: the last lines of each area, in memory. It dies with
// the process on purpose — chat is not state this playtest should persist.
const chatLog = new ChatLog()
let chatSequence = 0
const WILD_SPAWN = Object.freeze({ tx: 8, ty: 41 })

export class PresenceRoom extends Room {
  static connections = 0
  maxClients = CONNECTION_LIMIT
  autoDispose = false

  async onAuth(_client, options) {
    const auth = await authenticateSupabase(options?.token, process.env)
    return { ...auth, token: options?.token ?? null }
  }

  onCreate() {
    this.onMessage(MESSAGE.READY, client => this.ready(client))
    this.onMessage(MESSAGE.MOVE, (client, payload) => this.move(client, payload))
    this.onMessage(MESSAGE.AREA, (client, payload) => this.changeArea(client, payload))
    this.onMessage(MESSAGE.OBSERVE, (client, payload) => this.observe(client, payload))
    this.onMessage(MESSAGE.CHAT, (client, payload) => this.chat(client, payload))
  }

  async onJoin(client, options, auth) {
    if (!hasCapacity(PresenceRoom.connections)) { metrics.rejected('capacity'); throw new ServerError(4210, 'capacity reached') }
    PresenceRoom.connections++
    if (auth.kind === 'guest') {
      metrics.joined('guest')
      client.userData = { observer: { areaId: AREA.TOWN, tx: 31, ty: 20 } }
      observers.set(client.sessionId, client)
      return
    }
    const previous = clientsByActor.get(auth.userId)
    if (previous && previous !== client) previous.leave(4001)
    const visual = options?.visual
    const characterId = ['lucas', 'dawn-pink', 'dawn-yellow'].includes(visual?.characterId) ? visual.characterId : 'lucas'
    // Replace the old socket before any optional visual lookup. Otherwise a
    // reload can let the old onLeave remove presence seen by other clients.
    const actor = actors.get(auth.userId) ?? reconnectingActors.take(auth.userId) ??
      { id: auth.userId, areaId: AREA.TOWN, tx: 31, ty: 20, username: auth.username, characterId, companionId: null, dir: 'down', speed: 3.75, moveSequence: 0, lastMoveAt: 0, moves: [] }
    actor.username = auth.username
    actor.characterId = characterId
    actors.set(actor.id, actor); clientsByActor.set(actor.id, client); observers.set(client.sessionId, client); client.userData = { actorId: actor.id }; metrics.joined('player')
    this.publish(actor)
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
    const viewer = actors.get(client.userData?.actorId) ?? client.userData?.observer
    if (!viewer) return this.reject(client, 'ready denied', 'invalid')
    this.sendSnapshot(client, viewer)
  }

  onLeave(client) {
    PresenceRoom.connections = Math.max(0, PresenceRoom.connections - 1)
    metrics.left(client.userData?.actorId ? 'player' : 'guest')
    const id = client.userData?.actorId
    observers.delete(client.sessionId)
    visibleByClient.delete(client.sessionId)
    if (!id) return
    // A replaced browser may finish closing after the new session has joined.
    // It must not remove the newer actor with the same user id.
    if (clientsByActor.get(id) !== client) return
    const actor = actors.get(id); actors.delete(id); clientsByActor.delete(id)
    if (actor) {
      reconnectingActors.remember(id, actor)
      this.broadcastDelta({ type: 'leave', actor: publicActor(actor) }, actor)
    }
  }

  move(client, payload) {
    const actor = actors.get(client.userData?.actorId); const intent = moveIntent(payload)
    if (!actor || !intent) return this.reject(client, 'movement denied', 'invalid')
    if (!acceptMove(actor, intent.direction, Date.now(), intent.running, intent.sequence)) return this.reject(client, 'movement rate denied', 'rate')
    this.publish(actor); this.sendSelf(client, actor)
  }

  changeArea(client, payload) {
    const actor = actors.get(client.userData?.actorId); const intent = areaIntent(payload)
    if (!actor || !intent) return this.reject(client, 'area denied', 'area')
    actor.areaId = intent.areaId
    actor.tx = intent.areaId === AREA.TOWN ? 31 : WILD_SPAWN.tx
    actor.ty = intent.areaId === AREA.TOWN ? 20 : WILD_SPAWN.ty
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

  publish(actor) { this.broadcastDelta({ type: 'upsert', actor: publicActor(actor) }, actor) }
  broadcastDelta(delta, changed) {
    for (const client of observers.values()) {
      const viewer = actors.get(client.userData?.actorId) ?? client.userData?.observer
      if (!viewer || changed.id === viewer.id) continue
      const visible = visibleActors(viewer, new Map([[changed.id, changed]])).length > 0
      const previous = visibleByClient.get(client.sessionId) ?? new Set()
      if (delta.type === 'leave' ? previous.has(changed.id) : visible) {
        client.send(MESSAGE.DELTA, delta)
      } else if (!visible && previous.has(changed.id)) {
        client.send(MESSAGE.DELTA, { type: 'leave', actor: publicActor(changed) })
      }
      if (delta.type === 'leave' || !visible) previous.delete(changed.id)
      else previous.add(changed.id)
      visibleByClient.set(client.sessionId, previous)
    }
  }
  sendSnapshot(client, viewer) {
    const visible = viewer ? visibleActors(viewer, actors) : [...actors.values()]
    visibleByClient.set(client.sessionId, new Set(visible.map(actor => actor.id)))
    const self = client.userData?.actorId ? actors.get(client.userData.actorId) : null
    client.send(MESSAGE.SNAPSHOT, {
      access: self ? 'player' : 'guest',
      actors: visible.map(publicActor),
      ...(self ? { self: publicActor(self) } : {}),
    })
    // Arriving in the middle of a conversation should not look like silence.
    // A snapshot is sent on join and on every area change, which is exactly
    // when the history a client should hold changes.
    if (viewer?.areaId) client.send(MESSAGE.CHAT_HISTORY, { areaId: viewer.areaId, lines: chatLog.recent(viewer.areaId) })
  }
  sendSelf(client, actor) { client.send(MESSAGE.SELF, publicActor(actor)) }
  reject(client, reason, kind) { metrics.rejected(kind); client.send(MESSAGE.ERROR, { code: 'invalid-intent', reason }) }
}
