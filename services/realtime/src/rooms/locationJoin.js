import { SESSION_REPLACED, SESSION_REPLACED_CODE } from '../presence/locationService.js'
import { restoreFromRow } from '../presence/locationPolicy.js'
import { HOST_DRAINING_CODE } from '../protocol/closeCodes.js'

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
 *   - the boundary is publication (review B3): a claim that answers before the
 *     actor is admitted restores it; once the fallback was published, a claim
 *     that answers later only brings the epoch. The current authoritative
 *     position is adopted and saved at once; nothing moves (see `#adopt`);
 *   - in mode `on`, a session whose save came back 'stale', or whose claim was
 *     superseded (a greater key owns the row: WORLD LOCATION-4), is closed as
 *     replaced, and its tile is not remembered for reconnects; in shadow it is
 *     only counted (`wouldFence`, `wouldReplace`): shadow never changes what a
 *     player or an observer sees;
 *   - CLOUD READINESS-3, only while presence recovery is enabled: an infrastructure
 *     answer is never a replacement. A hydrating session whose row's owner is draining
 *     or unreachable, or that a live owner on a NEWER host supersedes (this host is
 *     stale and drains), is closed with 4503 (`presence:closing` 'draining', or
 *     'owner-unreachable' so the client can stop after bounded retries and offer
 *     «Jugar acá»). A placed session keeps playing and its claim is retried. 4409 stays
 *     for the replacements the contract can identify (a newer session in this process,
 *     a fresh join, a stale save). Shadow only counts (`wouldRetry`).
 *
 * Owns only per-socket location state; the room keeps the actors.
 */
export class LocationJoin {
  /** `location()` is a getter: the service can be replaced at runtime (tests, rollback). */
  /**
   * `closeReplaced(client, { named })`: the room closes a socket as an authoritative replacement
   * (WORLD LOCATION-4: 4409 for protocol-3 clients; 4001 for older ones, with the reason only
   * when `named`).
   */
  constructor({
    actors, clientsByActor, location, closeReplaced = (client, { named }) => (named ? client.leave(SESSION_REPLACED_CODE, SESSION_REPLACED) : client.leave(SESSION_REPLACED_CODE)),
    closeRetry = client => client.leave(HOST_DRAINING_CODE, 'host-draining'), recovery = () => false,
  }) {
    this.closeReplaced = closeReplaced
    /** CLOUD READINESS-3: closes a socket that should retry (4503) with a reason ('draining' | 'owner-unreachable'). */
    this.closeRetry = closeRetry
    /** CLOUD READINESS-3: presence recovery is enabled in this process (the close mapping above applies). */
    this.recovery = recovery
    this.actors = actors
    this.clientsByActor = clientsByActor
    this.location = location
    this.sessionByClient = new WeakMap()
    /** Reserved sockets waiting for their claim: client → { session, join, timer, readyPending, startedAt }. */
    this.hydrations = new Map()
  }

  /**
   * Closes a socket replaced by a newer join of the same player. Only `on`
   * names the reason; off and shadow close it exactly as before WORLD LOCATION.
   */
  replace(previous) {
    this.closeReplaced(previous, { named: this.location().restores })
  }

  /** A persisting player's new session, synchronously (no database wait), or null. */
  begin(client, auth, options) {
    const location = this.location()
    if (!location.persists(auth.userId)) return null
    const session = location.begin(auth.userId)
    session.client = client
    session.worldProtocol = options?.worldProtocol
    // CLOUD READINESS-3: «Jugar acá» — a fresh join the player asked for explicitly. Never a resume.
    session.takeover = options?.takeover === true && options?.resume !== true
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
    if (session) this.location().note(session, actor)
  }

  /** O(1): any accepted move, crossing or server placement. */
  moved(client, actor, urgent = false) {
    const session = this.sessionByClient.get(client)
    if (session) this.location().note(session, actor, { urgent })
  }

  /** True when the socket is still hydrating: its ready is answered once placed. */
  deferReady(client) {
    const waiting = this.hydrations.get(client)
    if (waiting) { waiting.readyPending = true; return true }
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
      // CLOUD READINESS-3 (recovery enabled): not a replacement — retry later (4503).
      if (result.status === 'owner_draining') return this.#retryWhileHydrating(client, pending, 'draining')
      if (result.status === 'owner_unreachable') return this.#retryWhileHydrating(client, pending, 'owner-unreachable')
      if (result.status === 'superseded' && result.newerActive === true && this.recovery()) return this.#retryWhileHydrating(client, pending, 'draining')
      // A greater key owns the row while this socket was still hydrating: it never plays here.
      if (result.status === 'superseded') return this.#supersededWhileHydrating(client, pending)
      if (result.status !== 'claimed') location.restored(result.status === 'unknown_user' ? 'unknownUser' : 'failed')
      return this.#finish(room, client, pending, result.status === 'claimed' ? result.location : null, result.status === 'claimed')
    }
    if (result.status === 'superseded') return this.#superseded(session, result)
    if (result.status !== 'claimed' || !client || this.sessionByClient.get(client) !== session) return
    const actor = this.actors.get(session.userId)
    if (!actor || this.clientsByActor.get(session.userId) !== client) return
    // Shadow: count what `on` would have restored or repaired; nothing moves.
    if (location.effective === 'shadow' && session.origin === 'new') location.shadowed(restoreFromRow(result.location, { worldProtocol: session.worldProtocol }))
    if (location.restores && session.origin === 'fallback') this.#adopt(session, actor)
  }

  /**
   * WORLD LOCATION-4: the claim of a live, placed session was superseded: a session with a
   * greater key (newer in this host, or on a newer host) owns the row. In `on` its socket
   * goes, as a replacement; in shadow only `wouldReplace` counts.
   */
  #superseded(session, result) {
    const client = session.client
    if (!client || this.sessionByClient.get(client) !== session || this.clientsByActor.get(session.userId) !== client) return
    const location = this.location()
    // CLOUD READINESS-3: the owner is a live session on a NEWER host: this host is stale (it drains) — retry, not replaced.
    if (result?.newerActive === true && this.recovery()) {
      if (!location.restores) { location.counters.shadow.wouldRetry++; return }
      location.counters.retryDisconnects++
      this.closeRetry(client, 'draining')
      return
    }
    if (!location.restores) { location.counters.shadow.wouldReplace++; return }
    location.counters.supersededDisconnects++
    this.closeReplaced(client, { named: true })
  }

  /** CLOUD READINESS-3: a hydrating socket whose claim must be retried later: closed with 4503, never placed. */
  #retryWhileHydrating(client, pending, reason) {
    clearTimeout(pending.timer)
    this.hydrations.delete(client)
    const location = this.location()
    location.counters.retryDisconnects++
    if (this.clientsByActor.get(pending.join.auth.userId) === client) this.closeRetry(client, reason)
  }

  #supersededWhileHydrating(client, pending) {
    clearTimeout(pending.timer)
    this.hydrations.delete(client)
    const location = this.location()
    location.counters.supersededDisconnects++
    if (this.clientsByActor.get(pending.join.auth.userId) === client) this.closeReplaced(client, { named: true })
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
   * fallback (timeout or failed claim, then a background retry). The
   * fallback was already published to the player and its observers, so the
   * stored location is never applied, whatever the player did or did not do
   * since: the claim only brings the epoch. The current authoritative
   * position is adopted and saved at the next tick (urgent), so the old row
   * is never restored later either. No area, tile, presence or work changes.
   */
  #adopt(session, actor) {
    const location = this.location()
    location.counters.late.adopted++
    session.origin = 'adopted'
    location.note(session, actor, { urgent: true })
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
    this.closeReplaced(client, { named: true })
  }
}
