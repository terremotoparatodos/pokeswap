import { ServerError } from '@colyseus/core'
import { ACTIVATION_WAIT_MS, HostLifecycle } from '../presence/hostLifecycle.js'
import { SESSION_REPLACED } from '../presence/locationService.js'
import { CLOSE_CODES_PROTOCOL, HOST_DRAINING_CODE, LEGACY_REPLACED_CODE, SESSION_REPLACED_CODE } from '../protocol/closeCodes.js'
import { MESSAGE } from '../protocol/messages.js'

// WORLD LOCATION-4 — this process as a presence host, and how its sockets are admitted and
// closed (docs/design/WORLD_LOCATION_4_DESIGN.md §3.3, §5). One instance per room module,
// next to the actors it serves: the room owns players and intents; this owns the host
// lifecycle, the drain and the close codes, which depend on what each client understands.
//
//   admission  a join waits for activation (then 4503), is refused while draining (4503),
//              and a resume never displaces another tab's live session (4409);
//   closes     a replacement is 4409 for protocol-3 clients, 4001 for older ones; a drain or
//              shutdown is 4503 for every client; protocol 3 hears `presence:closing` first;
//   drain      joins refused, movement frozen (the room asks `draining`), host → draining,
//              every pending location saved, before any socket closes;
//
// Three different endings, never confused (review F1):
//   displaced  the authority says this host is over (activation refused, a newer active host,
//              a lease that stayed expired). In `on` the process drains if it served anyone,
//              then stays alive but stopped: /readyz 503, joins refused with 4503, no renew,
//              no claim, no movement. It never exits on its own: a supervisor that restarts
//              any exit (PM2 autorestart) would start a new candidate with a newer generation
//              that would displace the current host in turn (a loop). The deploy or the
//              supervisor ends it. Shadow never changes what players see: it keeps admitting,
//              without persistence.
//   shutdown   the system asks for it (SIGTERM/SIGINT): Colyseus' graceful shutdown drains,
//              closes with 4503 and exits (realtimeServer.js).
//   startup    no generation within the acquire wait: the process serves without persistence
//              and keeps acquiring in the background (HostLifecycle.acquire); recoverable.

/** A tab id the client sends on join (UX and resume only; never part of the session key). */
const TAB_ID = /^[A-Za-z0-9_-]{8,64}$/
const HOST_OPERATIONS = ['presenceAcquire', 'presenceActivate', 'presenceRenew', 'presenceDrain', 'presenceStop']
export const supportsHost = store => HOST_OPERATIONS.every(op => typeof store?.[op] === 'function')
export const tabIdOf = options => (typeof options?.tabId === 'string' && TAB_ID.test(options.tabId) ? options.tabId : null)

export class PresenceHosting {
  /**
   * `location()`: the current location service (it is replaced at runtime).
   * `sockets()`: every socket of the room (a drain for a host change closes them all).
   */
  constructor({ location, sockets, metrics, log = message => console.warn(message) }) {
    this.location = location
    this.sockets = sockets
    this.metrics = metrics
    this.log = log
    /** This process's HostLifecycle, or null (location off, or a store without host operations). */
    this.host = null
    /** While draining: no join is accepted and no movement either. Never reverts in a process. */
    this.draining = false
    this.protocolOf = new WeakMap()
    this.tabOf = new WeakMap()
  }

  // ── Sockets ───────────────────────────────────────────────────────────

  #modern(client) { return (this.protocolOf.get(client) ?? 0) >= CLOSE_CODES_PROTOCOL }

  /** Why the server is about to close this socket, to clients that understand it. */
  closing(client, reason) { if (this.#modern(client)) client.send(MESSAGE.CLOSING, { reason }) }

  /** An authoritative replacement: 4409 (protocol 3), else the legacy 4001 (with the reason only when named). */
  closeReplaced = (client, { named }) => {
    this.closing(client, 'replaced')
    if (this.#modern(client)) client.leave(SESSION_REPLACED_CODE, SESSION_REPLACED)
    else if (named) client.leave(LEGACY_REPLACED_CODE, SESSION_REPLACED)
    else client.leave(LEGACY_REPLACED_CODE)
  }

  /** Shutdown, deploy or drain: 4503 for every client (an older one reconnects too, as it would on 1006). */
  closeDraining(client) {
    this.closing(client, 'draining')
    client.leave(HOST_DRAINING_CODE, 'host-draining')
  }

  /**
   * Admits a join or throws a ServerError: 4503 when this process will not serve (no active
   * host after the activation wait, or draining), 4409 when an automatic reconnection (resume)
   * would displace another tab's live session. `liveClientOf(userId)`: the player's socket here.
   * On success remembers what the client understands (its protocol and tab).
   */
  async admit(client, options, auth, liveClientOf) {
    const host = this.host
    // The mode decides first (review F5): only `on` (restores and authorizes) waits for the
    // activation that follows listen (one round trip in practice), then refuses with 4503.
    // Shadow never waits: a starting or refused host admits at once (the session gets no key,
    // so it never claims, and nobody is closed for it).
    if (host && this.location().restores && !host.admitting && !(await host.whenActive(ACTIVATION_WAIT_MS))) throw new ServerError(HOST_DRAINING_CODE, 'host-draining')
    if (this.draining) throw new ServerError(HOST_DRAINING_CODE, 'host-draining')
    // Only a fresh join (opening the page, reloading, «Jugar acá») replaces another tab.
    const tabId = tabIdOf(options)
    if (auth.kind !== 'guest' && options?.resume === true && tabId) {
      const previous = liveClientOf(auth.userId)
      if (previous && this.tabOf.get(previous) !== tabId) {
        this.metrics.rejected('resume')
        throw new ServerError(SESSION_REPLACED_CODE, 'session-replaced')
      }
    }
    if (Number.isInteger(options?.presenceProtocol)) this.protocolOf.set(client, options.presenceProtocol)
    if (tabId) this.tabOf.set(client, tabId)
  }

  // ── Host lifecycle ────────────────────────────────────────────────────

  /**
   * Before listen (realtimeServer.js): acquire this process's generation. The host stays
   * 'starting' (it owns nothing and drains nobody) until `activate()` after listen.
   */
  async prepare(store, { hostId, acquireWaitMs } = {}) {
    if (!this.location().active || !supportsHost(store)) return null
    this.host = this.#reacting(new HostLifecycle({ store, ...(hostId ? { hostId } : {}) }))
    // Sessions get their keys from this host from now on (none persist before it is active).
    this.location().attachHost(this.host)
    await this.host.acquire(acquireWaitMs === undefined ? {} : { waitMs: acquireWaitMs })
    return this.host
  }

  /**
   * Tests and tooling: replace the host (null: none). `reactToHostChanges: false` models the
   * renew-bounded window in which this host has not yet learned of a newer one.
   */
  configure(next, { reactToHostChanges = true } = {}) {
    this.host = reactToHostChanges ? this.#reacting(next) : next
    this.location().attachHost(next)
    return this.host
  }

  /**
   * Drain (design §3.3.3, §6.2): refuse joins, freeze movement, host → draining, flush every
   * pending location of the sessions it still owns, BEFORE any socket closes. Resolves with
   * the flush counts. Idempotent.
   */
  async drain({ deadlineMs = 3_000 } = {}) {
    this.draining = true
    await this.host?.drain()
    return this.location().shutdown(deadlineMs)
  }

  /** Colyseus is shutting the room down (after drain): protocol 3 hears why; nothing is admitted. */
  shuttingDown(clients) {
    this.draining = true
    for (const client of clients) this.closing(client, 'draining')
  }

  /** Tests and tooling: undo a drain (a fresh process never starts draining). */
  resetDraining() { this.draining = false }

  stats() { const host = this.host?.stats() ?? null; return host && { ...host, displaced: this.displaced ?? null } }

  /** Readiness: no host, a host that admits, or shadow (which serves whatever its host's state). */
  get serving() { return !this.host || this.host.admitting || !this.location().restores }

  /**
   * Displaced by the authority. In `on` the process stays alive and stopped (never exits on its
   * own: see the header); shadow keeps serving without persistence.
   */
  #stopped(reason) {
    if (this.displaced) return
    this.displaced = reason
    if (!this.location().restores) {
      this.log(`[host] ${reason}: shadow keeps serving, without location persistence`)
      return
    }
    this.log(`[host] ${reason}: this process stays stopped (/readyz 503, joins 4503) until its deploy or supervisor ends it`)
  }

  /**
   * A newer presence host is active, or this host's lease cannot be renewed. In `on` this
   * process drains and closes every socket with 4503 (clients reconnect, with resume, to the
   * current host), then stops. Shadow never changes what players see: it counts `wouldDrain`.
   */
  async #hostChanged(reason) {
    const location = this.location()
    if (!location.restores) { location.counters.shadow.wouldDrain++; return }
    if (this.draining) return
    await this.drain()
    for (const client of [...this.sockets()]) this.closeDraining(client)
    await this.host?.stop()
    this.#stopped(reason)
  }

  /** The reaction to what the database says about this host: drain (on) or count (shadow). */
  #reacting(next) {
    if (next) {
      next.onNewerActive = () => { void this.#hostChanged('newer host active') }
      next.onExpired = () => { void this.#hostChanged('lease expired') }
      next.onActivationRefused = reason => this.#stopped(`activation ${reason}`)
    }
    return next
  }
}
