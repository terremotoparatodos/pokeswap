import { SESSION_REPLACED, SESSION_REPLACED_CODE } from '../presence/locationService.js'
import { restoreFromRow } from '../presence/locationPolicy.js'

/**
 * WORLD LOCATION-2: how a player socket's session meets PresenceRoom.
 *
 * Connection rules (this phase's brief):
 *   - the atomic replacement of the previous socket never waits for the
 *     database: `begin` is synchronous;
 *   - in mode `on`, a join with no live actor and no reconnect memory is
 *     RESERVED (it owns the player id) and HYDRATED asynchronously: no
 *     position is published and no intent is accepted until its claim
 *     answers or `hydrationTimeoutMs` (1.5 s) passes, then it is placed at its
 *     validated row, or at Ciudad (unclaimed: plays on, never saves);
 *   - a claim that answers after that (`late`) moves the player only if it has
 *     done nothing yet and is within the late window (see `#late`);
 *   - in mode `on`, a session whose save came back 'stale' is closed with
 *     4001 'session-replaced', and its tile is not remembered for reconnects;
 *     in shadow it is only counted (`wouldFence`): shadow never changes what
 *     a player or an observer sees.
 *
 * Owns only per-socket location state; the room keeps the actors.
 */
export class LocationJoin {
  /** `location()` and `world()` are getters: both can be replaced at runtime (tests, rollback). */
  constructor({ actors, clientsByActor, location, world }) {
    this.actors = actors
    this.clientsByActor = clientsByActor
    this.location = location
    this.world = world
    this.sessionByClient = new WeakMap()
    /** Reserved sockets waiting for their claim: client → { session, join, timer, readyPending, startedAt }. */
    this.hydrations = new Map()
  }

  /**
   * Closes a socket replaced by a newer join of the same player. Only `on`
   * names the reason; off and shadow close it exactly as before WORLD LOCATION.
   */
  replace(previous) {
    if (this.location().restores) previous.leave(SESSION_REPLACED_CODE, SESSION_REPLACED)
    else previous.leave(4001)
  }

  /** A persisting player's new session, synchronously (no database wait), or null. */
  begin(client, auth, options) {
    const location = this.location()
    if (!location.persists(auth.userId)) return null
    const session = location.begin(auth.userId)
    session.client = client
    session.worldProtocol = options?.worldProtocol
    this.sessionByClient.set(client, session)
    return session
  }

  /** Mode `on` and nothing in memory: the player waits for its row. */
  mustHydrate(session, live, restored) {
    return Boolean(session && !live && !restored && this.location().restores)
  }

  /** A session placed at once (shadow, live actor or reconnect memory): the claim only brings the epoch. */
  claimInBackground(session, live, restored) {
    if (!session) return
    const location = this.location()
    location.restored(live ? 'live' : restored ? 'cache' : 'noRow')
    session.origin = live ? 'live' : restored ? 'cache' : 'new'
    void location.claim(session)
  }

  /** The session was just placed: its starting position is its first save. */
  admitted(client, actor) {
    const session = this.sessionByClient.get(client)
    if (!session) return
    const location = this.location()
    session.enabledAt = location.now()
    session.pristine = true
    location.note(session, actor)
  }

  /** O(1). Any accepted move, crossing or server placement also ends the late-claim window. */
  moved(client, actor, urgent = false) {
    const session = this.sessionByClient.get(client)
    if (!session) return
    session.pristine = false
    this.location().note(session, actor, { urgent })
  }

  /** A work request ends the late-claim window too (the player acted). */
  acted(client) {
    const session = this.sessionByClient.get(client)
    if (session) session.pristine = false
  }

  /** True when the socket is still hydrating: its ready is answered once placed. */
  deferReady(client) {
    const waiting = this.hydrations.get(client)
    if (waiting) { waiting.readyPending = true; return true }
    const session = this.sessionByClient.get(client)
    if (session) session.readySent = true
    return false
  }

  /**
   * The socket closed. `current`: it was still the player's socket. Returns
   * whether its actor may be remembered for a reconnect: not when fenced in
   * `on`. Shadow changes nothing the player sees, so it always may.
   */
  left(client, current, actor) {
    const session = this.sessionByClient.get(client)
    const waiting = this.hydrations.get(client)
    if (waiting) { clearTimeout(waiting.timer); this.hydrations.delete(client) }
    const location = this.location()
    const fenced = location.status(session) === 'fenced'
    location.end(session, current ? actor ?? null : null)
    return !(fenced && location.restores)
  }

  hydrate(room, client, session, join) {
    const location = this.location()
    const timer = setTimeout(() => this.#timedOut(room, client, session), location.hydrationTimeoutMs)
    timer.unref?.()
    this.hydrations.set(client, { session, join, timer, readyPending: false, startedAt: location.now() })
    location.counters.hydration.started++
    void location.claim(session)
  }

  #timedOut(room, client, session) {
    const pending = this.hydrations.get(client)
    if (pending?.session !== session) return
    const location = this.location()
    location.markUnclaimed(session)
    location.restored('timeout')
    this.#finish(room, client, pending, null, false)
  }

  /** Every claim outcome of a current session (the journal's onClaimed). */
  claimSettled(room, session, result) {
    const client = session.client
    const location = this.location()
    const pending = client ? this.hydrations.get(client) : null
    if (pending?.session === session) {
      if (result.status !== 'claimed') location.restored(result.status === 'unknown_user' ? 'unknownUser' : 'failed')
      return this.#finish(room, client, pending, result.status === 'claimed' ? result.location : null, result.status === 'claimed')
    }
    if (result.status !== 'claimed' || !client || this.sessionByClient.get(client) !== session) return
    const actor = this.actors.get(session.userId)
    if (!actor || this.clientsByActor.get(session.userId) !== client) return
    // Shadow: count what `on` would have restored or repaired; nothing moves.
    if (location.effective === 'shadow' && session.origin === 'new') location.shadowed(restoreFromRow(result.location, { worldProtocol: session.worldProtocol }))
    if (location.restores && session.origin === 'fallback') this.#late(room, client, session, actor, result.location)
  }

  #finish(room, client, pending, stored, claimed) {
    clearTimeout(pending.timer)
    this.hydrations.delete(client)
    const { session, join } = pending
    const location = this.location()
    location.hydrated(location.now() - pending.startedAt)
    // Replaced or gone while waiting: the newer socket owns the player now.
    if (this.clientsByActor.get(join.auth.userId) !== client || this.sessionByClient.get(client) !== session) return
    const place = restoreFromRow(stored, { worldProtocol: session.worldProtocol })
    if (place) { location.restored('row'); location.repaired(place.repair) } else if (claimed) location.restored('noRow')
    session.origin = place ? 'row' : claimed ? 'new' : 'fallback'
    room.admit(client, room.freshActor(join.auth, join.characterId, place ?? undefined), join)
    if (pending.readyPending) room.ready(client)
  }

  /**
   * A claim that answered after the session was placed with the Ciudad
   * fallback (timeout or failed claim, then a background retry). The stored
   * location is applied only if the player has done NOTHING yet (no accepted
   * step, crossing, work request or server move) and it is still within the
   * late window (LATE_APPLY_WINDOW_MS) of being placed: then it is exactly a
   * slow join, applied as a server placement with a fresh snapshot.
   * Otherwise it is ignored and the journal saves where the player really is.
   */
  #late(room, client, session, actor, stored) {
    const location = this.location()
    const place = restoreFromRow(stored, { worldProtocol: session.worldProtocol })
    const fresh = session.pristine && location.now() - session.enabledAt <= location.lateApplyWindowMs
    if (!place || !fresh || (place.areaId === actor.areaId && place.tx === actor.tx && place.ty === actor.ty)) {
      if (place) location.counters.late.ignored++
      return
    }
    location.counters.late.applied++
    location.repaired(place.repair)
    session.origin = 'row'
    actor.areaId = place.areaId; actor.tx = place.tx; actor.ty = place.ty; actor.dir = place.dir
    this.world().actorPlaced(actor)
    room.publish(actor)
    if (session.readySent) room.sendSnapshot(client, actor)
    location.note(session, actor)
  }

  /**
   * A save came back 'stale' for this session's epoch: a newer session of the
   * same player claimed (another instance, or a join here). The writer is
   * already fenced. In `on` its socket goes too (D-L2), as a local
   * replacement would. In shadow nothing the player sees changes (no
   * disconnect, no presence change, still remembered for a reconnect): it is
   * only counted as `wouldFence`.
   */
  fence(userId, epoch, session) {
    const client = this.clientsByActor.get(userId)
    if (!client || this.sessionByClient.get(client) !== session || session.epoch !== epoch) return
    const location = this.location()
    if (!location.restores) { location.counters.shadow.wouldFence++; return }
    location.counters.fencedDisconnects++
    client.leave(SESSION_REPLACED_CODE, SESSION_REPLACED)
  }
}
