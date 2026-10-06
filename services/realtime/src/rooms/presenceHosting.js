import { ServerError } from '@colyseus/core'
import { ACTIVATION_WAIT_MS, HOST_RENEW_MS, HostLifecycle } from '../presence/hostLifecycle.js'
import { SESSION_REPLACED } from '../presence/locationService.js'
import { CLOSE_CODES_PROTOCOL, HOST_DRAINING_CODE, INVALID_ATTEMPT_CODE, LEGACY_REPLACED_CODE, SESSION_REPLACED_CODE, STALE_ATTEMPT_CODE } from '../protocol/closeCodes.js'
import { MESSAGE } from '../protocol/messages.js'
import { JoinOrder, attemptOf } from '../presence/joinOrder.js'

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
// Three situations, never confused (reviews F1, N1):
//   displaced    ONLY when the database proves a newer host exists (an activation refused with
//                newer_active, or newerActive in any answer). Definitive: in `on` the process
//                drains if it served anyone, then stays alive but stopped — /readyz 503, joins
//                4503, no renew, no claim, no save, no movement, no new identity. It never exits
//                on its own: a supervisor that restarts any exit (PM2 autorestart) would start a
//                candidate with a newer generation that would displace the current host in turn
//                (a loop). Its deploy or supervisor ends it.
//   unavailable  recoverable: no authority (unreachable, timeouts, an expired starting lease,
//                unknown_host, an active lease that could not be renewed for a lease period).
//                The host recovers in the background and becomes active again on its own; in
//                `on` /readyz answers 503 and joins get 4503 meanwhile. Never an exit.
//   shutdown     the system asks for it (SIGTERM/SIGINT): Colyseus' graceful shutdown drains,
//                closes with 4503 and exits (realtimeServer.js).
// Shadow never changes what players see in any of them: it keeps admitting, without persistence.
//
// CLOUD READINESS-3 — standby (only while presence recovery is enabled: presence/recoveryCapability.js).
// H2 containment: AND only with WORLD_PRESENCE_STANDBY=on, AND only in `on` — shadow never starts or promotes
// a standby (it would create a real active host row). With the switch off a displaced process stays alive
// and stopped (/readyz 503, joins 4503) until something external ends or restarts it: nothing here, nor
// anything verified in Cloud, recovers it automatically.
// A displaced process that did NOT receive SIGINT/SIGTERM probes world_presence_any_active() every
// renew period (+ jitter). When no host is active it acquires a NEW identity (new hostId, new
// generation: the displaced one stays stopped for good) and activates it exclusively (refused while
// any other host is active; yields to a lower starting candidate). Only a promotion that completes
// before any shutdown is installed: the room admits again with the new identity. A shutdown stops
// the standby, and an identity it was promoting is stopped and never installed. Recovering an
// ACTIVE host is not recovering the ROUTED one: the process cannot know where NGINX sends players.
//
// CLOUD JOIN-ORDER-2 — the order of each page's attempts in this process (presence/joinOrder.js),
// checked in admission's synchronous tail, AFTER the resume rule (a resume of another page is still
// 4409 whatever its attempt) and never instead of it: the attempt orders one page's own joins and
// authorizes nothing. 'on' refuses an older or repeated attempt (4410) and an unreadable one (4422);
// 'shadow' only counts; 'off' ignores attempts. Guests and clients without an attempt: as before.

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
  constructor({ location, sockets, metrics, log = message => console.warn(message), recovery = null, standbyRequested = false, standbyProbeMs = HOST_RENEW_MS, createStandbyHost = null, joinOrder = null, liveClientOf = () => null }) {
    /** H2 containment: WORLD_PRESENCE_STANDBY=on (read once by the room). Off: a displaced process never promotes. */
    this.standbyRequested = standbyRequested
    /** CLOUD JOIN-ORDER-2: the player's live socket in this process (the room's), to keep live pages in memory. */
    this.liveClientOf = liveClientOf
    this.joinOrder = joinOrder ?? this.createJoinOrder()
    /** CLOUD JOIN-ORDER-2 ('on' only): client → { page, attempt } of an admitted join that carried one. */
    this.orderOfClient = new WeakMap()
    this.location = location
    this.sockets = sockets
    this.metrics = metrics
    this.log = log
    /** CLOUD READINESS-3: the RecoveryCapability of this process (null: recovery never applies). */
    this.recovery = recovery
    /** CLOUD JOIN-ORDER-2: the JoinOrderCapability of this process (claim v3; null: never). */
    this.joinOrderAuthority = null
    this.standbyProbeMs = standbyProbeMs
    /** Tests: builds the exclusive identity of the standby (default: a HostLifecycle with exclusive: true). */
    this.createStandbyHost = createStandbyHost ?? (store => new HostLifecycle({ store, exclusive: true, log: this.log }))
    /** The store the host lifecycle uses (set by prepare/configure). */
    this.store = null
    /** A shutdown began (SIGINT/SIGTERM): no standby, no promotion, ever again in this process. */
    this.shutdownBegun = false
    /** { timer, promoting, busy } while in standby; null otherwise. */
    this.standby = null
    /** The stop of an identity a shutdown overtook mid-promotion (awaited by stopForShutdown). */
    this.abandoned = null
    this.standbyCounters = { started: 0, probes: 0, probeFailures: 0, promotions: 0, refused: 0, abandoned: 0, notRequested: 0, wouldStandby: 0 }
    /** This process's HostLifecycle, or null (location off, or a store without host operations). */
    this.host = null
    /** While draining: no join is accepted and no movement either. Never reverts in a process. */
    this.draining = false
    this.protocolOf = new WeakMap()
    this.tabOf = new WeakMap()
  }

  /** CLOUD JOIN-ORDER-2: a JoinOrder whose live pages are this room's live sockets. */
  createJoinOrder(options = {}) {
    return new JoinOrder({ ...options, isLive: (userId, page) => { const client = this.liveClientOf(userId); return Boolean(client) && this.tabOf.get(client) === page } })
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

  /**
   * CLOUD READINESS-3: a socket that should reconnect later (4503), with the reason protocol 3 hears first:
   * 'draining' (the owner of the row drains, or this host is stale) or 'owner-unreachable' (the client stops
   * after bounded retries and offers «Jugar acá»). Clients that do not know the reason retry, as on any 4503.
   */
  closeRetry = (client, reason) => {
    this.closing(client, reason)
    client.leave(HOST_DRAINING_CODE, reason === 'owner-unreachable' ? 'owner-unreachable' : 'host-draining')
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
    // In `on` only a host that is just starting is waited for (the activation follows listen by one
    // round trip); an unavailable, paused or stopped one refuses at once.
    if (host && this.location().restores && !host.admitting && !(host.state === 'starting' && await host.whenActive(ACTIVATION_WAIT_MS))) throw new ServerError(HOST_DRAINING_CODE, 'host-draining')
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
    // CLOUD JOIN-ORDER-2: from here to the end, no await (the order is decided in one synchronous run).
    const order = this.#order(options, auth, tabId)
    if (Number.isInteger(options?.presenceProtocol)) this.protocolOf.set(client, options.presenceProtocol)
    if (tabId) this.tabOf.set(client, tabId)
    if (order) this.orderOfClient.set(client, order)
  }

  /**
   * CLOUD JOIN-ORDER-2: the join's { page, attempt } when it is enforced ('on', a player, a valid attempt
   * with a page), else null. Throws 4422 / 4410 in 'on'; shadow only counts. Synchronous.
   */
  #order(options, auth, tabId) {
    const order = this.joinOrder
    if (!order.observing || auth.kind === 'guest') return null
    const { ok, attempt } = attemptOf(options)
    if (ok && attempt === null) { order.counters.legacy++; return null }
    if (!ok || !tabId) {
      // Present but unreadable, or an attempt without a readable page: a defined refusal, never a guess.
      order.counters.invalid++
      if (!order.enforcing) return null
      this.metrics.rejected('invalid-attempt')
      throw new ServerError(INVALID_ATTEMPT_CODE, 'invalid-attempt')
    }
    const verdict = order.observe(auth.userId, tabId, attempt)
    if (verdict !== 'admit') {
      if (!order.enforcing) { order.counters.wouldRefuse++; return null }
      this.metrics.rejected('stale-attempt')
      throw new ServerError(STALE_ATTEMPT_CODE, `${verdict}-attempt`)
    }
    return order.enforcing ? { page: tabId, attempt } : null
  }

  /** CLOUD JOIN-ORDER-2: the { page, attempt } this process enforces for an admitted client, or null. */
  orderOf(client) { return this.orderOfClient.get(client) ?? null }

  /**
   * CLOUD JOIN-ORDER-2: right before the room replaces the previous socket (same synchronous run as the
   * replacement). False when a newer attempt of this page was admitted meanwhile: the join is refused
   * (4410) and nothing is closed. Today no await separates admission from the replacement; this guards
   * any future one.
   */
  stillLatest(client, auth) {
    const order = this.orderOf(client)
    if (!order || auth.kind === 'guest' || this.joinOrder.isLatest(auth.userId, order.page, order.attempt)) return true
    this.joinOrder.counters.recheckRefused++
    this.metrics.rejected('stale-attempt')
    return false
  }

  // ── Host lifecycle ────────────────────────────────────────────────────

  /**
   * Before listen (realtimeServer.js): acquire this process's generation. The host stays
   * 'starting' (it owns nothing and drains nobody) until `activate()` after listen.
   */
  async prepare(store, { hostId, acquireWaitMs } = {}) {
    if (!this.location().active || !supportsHost(store)) return null
    this.store = store
    // CLOUD READINESS-3: one capability probe per process, before the first claim (never blocks: a
    // transient failure leaves it 'unknown', probed again later).
    await this.recovery?.probe()
    // CLOUD JOIN-ORDER-2: likewise for claim v3 (only requested with WORLD_JOIN_ORDER=on).
    await this.joinOrderAuthority?.probe()
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
  configure(next, { reactToHostChanges = true, store = next?.store ?? null } = {}) {
    this.store = store
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

  stats() {
    const host = this.host?.stats() ?? null
    return host && { ...host, displaced: this.displaced ?? null, standby: this.standby !== null, standbyEnabled: this.standbyRequested === true, standbyCounters: { ...this.standbyCounters }, recovery: this.recovery?.stats() ?? null, joinOrderAuthority: this.joinOrderAuthority?.stats() ?? null }
  }

  // ── CLOUD READINESS-3: shutdown and standby ───────────────────────────

  /**
   * A shutdown began (Colyseus onBeforeShutdown): synchronous, before anything awaits. The standby stops;
   * an identity being promoted is stopped and never installed. Idempotent.
   */
  beginShutdown() {
    if (this.shutdownBegun) return
    this.shutdownBegun = true
    const standby = this.standby
    this.standby = null
    if (standby?.timer) clearTimeout(standby.timer)
    if (standby?.promoting) { this.standbyCounters.abandoned++; this.abandoned = this.#abandon(standby.promoting) }
  }

  /**
   * The identity a shutdown overtook mid-promotion never serves. Its own stop waits behind its activation
   * on the host lane, and the process may exit before that activation answers; so the stop is ALSO sent
   * now, outside the lane (terminal and idempotent): if it reaches the database first, the late exclusive
   * activation finds 'stopped' and activates nothing. Never throws.
   */
  async #abandon(candidate) {
    const identity = candidate.identity
    await Promise.all([
      candidate.stop(),
      identity ? Promise.resolve(this.store?.presenceStop?.(identity.generation, identity.hostId)).catch(() => null) : null,
    ])
  }

  /** onShutdown: stops the host this process holds now (a promoted one included). Idempotent; never throws. */
  async stopForShutdown() {
    this.beginShutdown()
    await Promise.all([this.host?.stop(), this.abandoned])
  }

  /** Tests: resolves once the standby (if any) is neither probing nor promoting. */
  async standbyIdle() { while (this.standby?.busy) await this.standby.busy }

  /** Tests: runs the next probe now instead of waiting for its timer. */
  probeStandbyNow() {
    const standby = this.standby
    if (!standby || standby.busy) return standby?.busy ?? Promise.resolve()
    if (standby.timer) { clearTimeout(standby.timer); standby.timer = null }
    standby.busy = this.#probe(standby).finally(() => { standby.busy = null })
    return standby.busy
  }

  #startStandby() {
    if (this.standby || this.shutdownBegun || !this.recovery?.enabled) return
    // H2 containment (P-A): the promotion is its own, explicit switch.
    if (!this.standbyRequested) { this.standbyCounters.notRequested++; return }
    // H2 containment (P-B): shadow only counts — a promotion would create a REAL active host row.
    if (!this.location().restores) { this.standbyCounters.wouldStandby++; return }
    if (typeof this.store?.presenceAnyActive !== 'function' || typeof this.store?.presenceActivateExclusive !== 'function') return
    this.standby = { timer: null, promoting: null, busy: null }
    this.standbyCounters.started++
    this.log('[host] standby: this process will take a NEW identity if no host is active')
    this.#scheduleProbe(this.standby)
  }

  #scheduleProbe(standby) {
    if (this.standby !== standby || this.shutdownBegun) return
    const jitter = Math.floor(Math.random() * Math.min(1_000, this.standbyProbeMs))
    standby.timer = setTimeout(() => {
      standby.timer = null
      standby.busy = this.#probe(standby).finally(() => { standby.busy = null })
    }, this.standbyProbeMs + jitter)
    standby.timer.unref?.()
  }

  async #probe(standby) {
    if (this.standby !== standby || this.shutdownBegun) return
    this.standbyCounters.probes++
    let anyActive
    try {
      anyActive = await this.store.presenceAnyActive()
    } catch (error) {
      if (this.recovery?.unsupported(error)) { this.#endStandby(standby, 'recovery unsupported'); return }
      this.standbyCounters.probeFailures++
      this.#scheduleProbe(standby)
      return
    }
    if (this.standby !== standby || this.shutdownBegun) return
    if (anyActive) { this.#scheduleProbe(standby); return }
    await this.#promote(standby)
  }

  async #promote(standby) {
    const candidate = this.createStandbyHost(this.store)
    standby.promoting = candidate
    let state = await candidate.acquire()
    if (state === 'starting' && this.standby === standby && !this.shutdownBegun) state = await candidate.activate()
    standby.promoting = null
    // A shutdown (or the end of this standby) that came meanwhile wins: the new identity never serves.
    if (this.standby !== standby || this.shutdownBegun || state !== 'active') {
      await candidate.stop()
      if (state === 'active' || this.shutdownBegun) { this.standbyCounters.abandoned++; return }
      this.standbyCounters.refused++
      if (candidate.refused === 'unsupported') { this.recovery?.disable('sql-missing'); this.#endStandby(standby, 'recovery unsupported'); return }
      this.#scheduleProbe(standby)
      return
    }
    // Installed synchronously: a shutdown that starts after this line stops THIS host (stopForShutdown).
    this.standby = null
    this.host = this.#reacting(candidate)
    this.location().attachHost(candidate)
    // H-1: the displacement's drain stopped the journal (location.shutdown); the promoted host saves again.
    this.location().resume()
    this.displaced = null
    this.draining = false
    this.standbyCounters.promotions++
    this.log(`[host] standby: promoted with a new identity (generation ${candidate.generation}); admitting again`)
  }

  #endStandby(standby, reason) {
    if (this.standby !== standby) return
    if (standby.timer) clearTimeout(standby.timer)
    this.standby = null
    this.log(`[host] standby ended: ${reason}`)
  }

  /** Readiness: no host, a host that admits, or shadow (which serves whatever its host's state). */
  get serving() { return !this.host || this.host.admitting || !this.location().restores }

  /**
   * Displaced: a newer host exists (definitive). In `on` the process stays alive and stopped
   * (never exits on its own: see the header); shadow keeps serving without persistence.
   */
  #stopped(reason) {
    if (this.displaced) return
    this.displaced = reason
    this.#startStandby()
    if (!this.location().restores) {
      this.log(`[host] ${reason}: shadow keeps serving, without location persistence`)
      return
    }
    this.log(`[host] ${reason}: this process stays stopped (/readyz 503, joins 4503) until its deploy or supervisor ends it`)
  }

  /**
   * A newer presence host is active (definitive). In `on` this process drains and closes every
   * socket with 4503 (clients reconnect, with resume, to the current host), then is displaced.
   * Shadow never changes what players see: it counts `wouldDrain`.
   */
  async #hostChanged(reason) {
    const location = this.location()
    if (!location.restores) { location.counters.shadow.wouldDrain++; return }
    if (this.draining) return
    await this.drain()
    for (const client of [...this.sockets()]) this.closeDraining(client)
    await this.host?.displace()
    this.#stopped(reason)
  }

  /**
   * The reaction to what the database says about this host: a newer host drains it (on) or is
   * counted (shadow). An expired or unrenewable lease is recoverable (review N1): the host pauses
   * and keeps renewing on its own; nothing here drains or stops for it.
   */
  #reacting(next) {
    if (next) {
      next.onNewerActive = () => { void this.#hostChanged('newer host active') }
      next.onExpired = () => {}
      next.onActivationRefused = reason => this.#stopped(`activation ${reason}`)
    }
    return next
  }
}
