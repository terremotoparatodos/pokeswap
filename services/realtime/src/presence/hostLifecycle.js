import { randomUUID } from 'node:crypto'

/**
 * WORLD LOCATION-4 — this realtime PROCESS as a presence host
 * (docs/design/WORLD_LOCATION_4_DESIGN.md §3.3).
 *
 * The database gives each process start a generation and a monotonic lifecycle:
 *
 *   starting  acquired before the server listens; owns nothing, claims and saves nothing,
 *             and never counts as a newer host for anyone (newerActive ignores it)
 *   active    activated explicitly once the server is ready (right after listen);
 *             sessions get keys (generation, seq), claim and save
 *   draining  shutdown, or a newer active host was seen: no new claims, a final flush of
 *             the rows it still owns within a fixed window, then sockets close with 4503
 *   stopped   terminal
 *
 * Activating a new host does NOT drain the old one in the same transaction: the old host
 * learns of it from `newerActive` on its next renew (every `renewMs`), claim or save, so the
 * two coexist for at most one renew period plus one round trip. Ordering never depends on
 * that window: keys do it (a newer host's sessions always outrank an older host's).
 *
 * Clocks: leases are the database's now(); this process only schedules (monotonic timers).
 * No answer here is ever retried forever: transport failures back off and stop with the
 * process state; host_inactive / unknown_host stop the host; host_expired pauses claims and
 * saves until a renew revives the lease, and drains after `expiredRenewals` failed tries.
 */

export const HOST_LEASE_MS = 15_000
export const HOST_RENEW_MS = 5_000
/** The draining host's final-flush window (fixed by drain; renew never extends it). */
export const HOST_DRAIN_WINDOW_MS = 10_000
/** How long the process waits for a generation before serving without persistence. */
export const ACQUIRE_WAIT_MS = 10_000
/** How long a join waits for the activation that follows listen. */
export const ACTIVATION_WAIT_MS = 2_000
/** Renewals with the lease still expired before the host gives up and drains. */
export const EXPIRED_RENEWALS = 3
const RETRY_BASE_MS = 500
const RETRY_MAX_MS = 5_000

const wait = ms => new Promise(resolve => { const t = setTimeout(resolve, ms); t.unref?.() })
const retryMs = attempt => Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt)

export class HostLifecycle {
  /**
   * `store`: { presenceAcquire, presenceActivate, presenceRenew, presenceDrain, presenceStop }.
   * `onNewerActive()`: a newer host is active (the room decides: drain in `on`, count in shadow).
   * `onExpired()`: the lease stayed expired for `expiredRenewals` renewals (the room drains).
   */
  constructor({
    store, hostId = randomUUID(), leaseMs = HOST_LEASE_MS, renewMs = HOST_RENEW_MS, drainWindowMs = HOST_DRAIN_WINDOW_MS,
    expiredRenewals = EXPIRED_RENEWALS, onNewerActive = () => {}, onExpired = () => {}, log = message => console.warn(message), sleep = wait,
  }) {
    this.store = store
    this.hostId = hostId
    this.leaseMs = leaseMs
    this.renewMs = renewMs
    this.drainWindowMs = drainWindowMs
    this.expiredRenewals = expiredRenewals
    this.onNewerActive = onNewerActive
    this.onExpired = onExpired
    this.log = log
    this.sleep = sleep
    /** 'idle' | 'acquiring' | 'unavailable' | 'starting' | 'active' | 'draining' | 'stopped' */
    this.state = 'idle'
    this.generation = null
    this.paused = false
    this.newerSeen = false
    this.expiredStreak = 0
    this.accepted = 0
    this.timer = null
    this.renewing = null
    this.waiters = new Set()
    this.counters = { acquireRetries: 0, activation: null, renewals: 0, renewFailures: 0, newerActive: 0, expired: 0, refusedAnswers: 0, keys: 0 }
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  /**
   * Before listen. Retries with backoff until a generation is assigned or `waitMs` passes;
   * then the process serves without persistence ('unavailable') and keeps trying in the
   * background. Never throws.
   */
  async acquire({ waitMs = ACQUIRE_WAIT_MS } = {}) {
    if (this.state !== 'idle') return this.state
    this.state = 'acquiring'
    const deadline = performance.now() + waitMs
    for (let attempt = 0; ; attempt++) {
      if (this.state !== 'acquiring' && this.state !== 'unavailable') return this.state
      try {
        const answer = await this.store.presenceAcquire(this.hostId, this.leaseMs)
        if (!Number.isSafeInteger(answer?.generation) || answer.generation < 1) throw new Error('malformed acquire answer')
        this.generation = answer.generation
        // A retry after a lost answer returns the same generation and the CURRENT state.
        this.state = answer.state === 'starting' ? 'starting' : answer.state === 'active' ? 'active' : 'stopped'
        if (this.state === 'starting' || this.state === 'active') this.#startRenewing()
        if (this.state === 'active') this.#settleWaiters()
        return this.state
      } catch (error) {
        this.counters.acquireRetries++
        if (this.state === 'acquiring' && performance.now() >= deadline) {
          this.state = 'unavailable'
          this.log(`[host] no generation after ${waitMs} ms (${String(error?.message ?? error).slice(0, 60)}): serving without location persistence, retrying in the background`)
          this.#settleWaiters()
          void this.#acquireInBackground(attempt)
          return this.state
        }
        await this.sleep(retryMs(attempt))
      }
    }
  }

  async #acquireInBackground(attempt) {
    while (this.state === 'unavailable') {
      await this.sleep(retryMs(++attempt))
      if (this.state !== 'unavailable') return
      try {
        const answer = await this.store.presenceAcquire(this.hostId, this.leaseMs)
        if (!Number.isSafeInteger(answer?.generation)) continue
        this.generation = answer.generation
        this.state = answer.state === 'starting' ? 'starting' : 'stopped'
        if (this.state === 'starting') { this.#startRenewing(); await this.activate() }
        return
      } catch { this.counters.acquireRetries++ }
    }
  }

  /**
   * After listen: starting → active. Transport failures are retried (activate is idempotent);
   * any refusal (newer_active, host_expired, host_inactive, unknown_host) stops this host.
   */
  async activate() {
    if (this.state !== 'starting') return this.state
    for (let attempt = 0; attempt < 6; attempt++) {
      let answer
      try {
        answer = await this.store.presenceActivate(this.generation, this.hostId, this.leaseMs)
      } catch {
        await this.sleep(retryMs(attempt))
        continue
      }
      this.counters.activation = answer?.status ?? 'malformed'
      if (answer?.status === 'active') {
        this.state = 'active'
        this.#settleWaiters()
        return this.state
      }
      this.log(`[host] activation refused (${this.counters.activation}): this process stops serving as a presence host`)
      await this.stop()
      return this.state
    }
    this.counters.activation = 'unreachable'
    this.log('[host] activation unreachable: this process stops serving as a presence host')
    await this.stop()
    return this.state
  }

  /** active → draining (fixed flush window). Idempotent; never throws. */
  async drain() {
    if (this.state !== 'active' && this.state !== 'starting') return this.state
    const from = this.state
    this.state = from === 'active' ? 'draining' : 'stopped'
    this.#settleWaiters()
    try {
      const answer = await this.store.presenceDrain(this.generation, this.hostId, this.drainWindowMs)
      if (answer?.state === 'stopped') this.state = 'stopped'
    } catch (error) {
      this.log(`[host] drain call failed (${String(error?.message ?? error).slice(0, 60)}); the lease runs out on its own`)
    }
    if (this.state === 'stopped') this.#stopRenewing()
    return this.state
  }

  /** Any → stopped (terminal). Idempotent; never throws. */
  async stop() {
    const had = this.generation !== null && this.state !== 'stopped'
    this.state = 'stopped'
    this.#stopRenewing()
    this.#settleWaiters()
    if (!had) return this.state
    try { await this.store.presenceStop(this.generation, this.hostId) } catch (error) {
      this.log(`[host] stop call failed (${String(error?.message ?? error).slice(0, 60)}); the lease runs out on its own`)
    }
    return this.state
  }

  // ── Renewal ─────────────────────────────────────────────────────────────

  #startRenewing() {
    if (this.timer) return
    this.timer = setInterval(() => { void this.renew() }, this.renewMs)
    this.timer.unref?.()
  }

  #stopRenewing() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** One renewal (also run at once after a refused answer). Single-flight; never throws. */
  renew() {
    if (this.renewing) return this.renewing
    if (this.state !== 'starting' && this.state !== 'active' && this.state !== 'draining') return Promise.resolve(this.state)
    this.renewing = (async () => {
      try {
        const answer = await this.store.presenceRenew(this.generation, this.hostId, this.leaseMs)
        this.counters.renewals++
        this.observe(answer)
        if (answer?.status === 'ok' && this.state === 'active') {
          if (answer.leaseLive === false) this.#expired()
          else { this.paused = false; this.expiredStreak = 0 }
        }
      } catch {
        this.counters.renewFailures++
      } finally {
        this.renewing = null
      }
      return this.state
    })()
    return this.renewing
  }

  #expired() {
    this.paused = true
    this.counters.expired++
    if (++this.expiredStreak >= this.expiredRenewals) {
      this.log(`[host] lease still expired after ${this.expiredRenewals} renewals: draining`)
      this.onExpired()
    }
  }

  /**
   * Any answer of the database about this host (renew, claim, save): newerActive drains (or
   * counts, the room decides), host_expired pauses and renews at once, host_inactive /
   * unknown_host end this host. Never retries on its own beyond one immediate renew.
   */
  observe(answer) {
    if (!answer || typeof answer !== 'object') return
    if (answer.newerActive === true && !this.newerSeen) {
      this.newerSeen = true
      this.counters.newerActive++
      this.onNewerActive()
    }
    switch (answer.status) {
      case 'host_expired':
        this.counters.refusedAnswers++
        if (this.state === 'starting') { void this.stop(); return }
        if (this.state === 'active' && !this.paused) { this.paused = true; void this.renew() }
        return
      case 'host_inactive':
        this.counters.refusedAnswers++
        if (answer.state === 'stopped' || answer.state === 'starting') { this.state = 'stopped'; this.#stopRenewing(); this.#settleWaiters() }
        else if (answer.state === 'draining' && this.state === 'active') this.state = 'draining'
        return
      case 'unknown_host':
        this.counters.refusedAnswers++
        this.log('[host] the database does not know this host: location persistence stops in this process')
        this.state = 'stopped'
        this.#stopRenewing()
        this.#settleWaiters()
    }
  }

  // ── What the room and the journal read ──────────────────────────────────

  /** A join may be accepted: active, or serving without persistence. */
  get admitting() { return this.state === 'active' || this.state === 'unavailable' }
  get canClaim() { return this.state === 'active' && !this.paused }
  /** Active and not paused; or draining (its final flush; the database limits it to rows it owns). */
  get canSave() { return (this.state === 'active' && !this.paused) || this.state === 'draining' }
  get identity() { return this.generation === null ? null : { generation: this.generation, hostId: this.hostId } }

  /**
   * The key of a session accepted NOW (call it synchronously in onJoin): its seq is the
   * process's acceptance order, fixed for the session's life. Null when this host cannot
   * persist (no generation, not active): the session plays on without persistence.
   */
  sessionKey() {
    if (this.state !== 'active') return null
    this.counters.keys++
    return { generation: this.generation, seq: ++this.accepted, sessionId: randomUUID(), hostId: this.hostId }
  }

  /** Resolves true once joins may be accepted, false at `ms` or if this host will never accept. */
  whenActive(ms = ACTIVATION_WAIT_MS) {
    if (this.admitting) return Promise.resolve(true)
    if (this.state === 'draining' || this.state === 'stopped') return Promise.resolve(false)
    return new Promise(resolve => {
      const done = value => { clearTimeout(timer); this.waiters.delete(waiter); resolve(value) }
      const waiter = () => done(this.admitting)
      const timer = setTimeout(() => done(false), ms)
      timer.unref?.()
      this.waiters.add(waiter)
    })
  }

  #settleWaiters() { for (const waiter of [...this.waiters]) waiter() }

  /** Aggregates only (no user, no host id). */
  stats() {
    return { state: this.state, generation: this.generation, paused: this.paused, newerSeen: this.newerSeen, accepted: this.accepted, ...this.counters }
  }
}

/** Tests and tooling: a host that is already active with a fixed identity (no database lifecycle). */
export function activeHost({ generation = 1, hostId = randomUUID() } = {}) {
  const host = new HostLifecycle({ store: null, hostId, log: () => {} })
  host.generation = generation
  host.state = 'active'
  host.renew = () => Promise.resolve(host.state)
  host.drain = async () => { host.state = 'draining'; return host.state }
  host.stop = async () => { host.state = 'stopped'; return host.state }
  return host
}
