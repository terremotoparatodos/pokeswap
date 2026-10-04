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
 * Two kinds of trouble, never confused (review N1):
 *   displaced    the database proves a newer host exists: an activation refused with
 *                newer_active, or newerActive in any answer. Definitive: this host stops (after
 *                its drain, decided by the room) and never acquires, claims, saves or renews
 *                again. The process does NOT exit (F1); its deploy or supervisor ends it.
 *   recoverable  no authority: the store unreachable (timeouts, transport errors, a temporary
 *                error during acquire or activate), a starting lease that expired, unknown_host.
 *                The host is 'unavailable' (no identity yet, or one whose activation is still
 *                to be confirmed), or 'active' but `paused` (its lease could not be renewed for a
 *                whole lease period). It recovers in the background with a bounded backoff and
 *                goes back to active and admitting on its own; the room answers /readyz 503 and
 *                refuses joins with 4503 meanwhile (in `on`; shadow is unaffected).
 * Identity: a retry whose answer may have been lost keeps the same hostId and generation (both
 * operations are idempotent). A new hostId — hence a new generation — is taken only when the
 * database confirms the old one is gone (unknown_host, host_expired, a stopped identity), so
 * generations grow with confirmed losses, never with retries.
 *
 * Serialization (review F3): activate, drain, stop and renew run one at a time, in call order,
 * on one lane, so this process never holds two of the database's host locks at once (activate
 * takes a table lock; renew, drain and stop a row lock) and never inverts their order. A renew is
 * not started while activate, drain or stop is queued or running (the next tick renews). Every
 * operation catches its own failures: nothing on the lane can reject unobserved.
 *
 * Clocks: leases are the database's now(); this process only schedules (monotonic timers and
 * an injectable `now` for tests).
 */

export const HOST_LEASE_MS = 15_000
export const HOST_RENEW_MS = 5_000
/** The draining host's final-flush window (fixed by drain; renew never extends it). */
export const HOST_DRAIN_WINDOW_MS = 10_000
/** How long the first acquire waits before the process goes 'unavailable' and recovers in the background. */
export const ACQUIRE_WAIT_MS = 10_000
/** How long a join waits for the activation that follows listen. */
export const ACTIVATION_WAIT_MS = 2_000
/**
 * Renewals with the lease still expired before the host reports it (`onExpired`): as many as
 * cover two full lease periods (design §3.3.4). 15 s lease, 5 s renewal: 6 renewals, 30 s.
 * Since N1 this is a report, not an ending: the host stays paused and keeps renewing.
 */
export const expiredRenewalsFor = (leaseMs, renewMs) => Math.ceil((2 * leaseMs) / renewMs)
export const EXPIRED_RENEWALS = expiredRenewalsFor(HOST_LEASE_MS, HOST_RENEW_MS)
/** Attempts of drain and stop on transport errors (40P01 included), backing off between them. */
export const HOST_CALL_ATTEMPTS = 3
/** Attempts of the activation that follows listen before the host recovers in the background. */
export const ACTIVATE_ATTEMPTS = 6
/** Background recovery backoff: 1 s doubling to 30 s. */
export const RECOVERY_BASE_MS = 1_000
export const RECOVERY_MAX_MS = 30_000
const RETRY_BASE_MS = 500
const RETRY_MAX_MS = 5_000

const wait = ms => new Promise(resolve => { const t = setTimeout(resolve, ms); t.unref?.() })
const retryMs = attempt => Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt)
export const recoveryMs = attempt => Math.min(RECOVERY_MAX_MS, RECOVERY_BASE_MS * 2 ** attempt)

export class HostLifecycle {
  /**
   * `store`: { presenceAcquire, presenceActivate, presenceRenew, presenceDrain, presenceStop }.
   * `onNewerActive()`: a newer host is active (the room decides: drain in `on`, count in shadow).
   * `onExpired()`: the lease stayed expired for `expiredRenewals` renewals (a report: the host
   *   stays paused and keeps renewing).
   * `onActivationRefused(reason)`: the activation was refused because a newer host is active:
   *   this host is displaced for good (the room logs it; the process does not exit).
   * `onUnavailable(reason)` / `onRecovered()`: the authority was lost / is back.
   */
  constructor({
    store, hostId = randomUUID(), leaseMs = HOST_LEASE_MS, renewMs = HOST_RENEW_MS, drainWindowMs = HOST_DRAIN_WINDOW_MS,
    expiredRenewals = expiredRenewalsFor(leaseMs, renewMs), onNewerActive = () => {}, onExpired = () => {}, onActivationRefused = () => {},
    onUnavailable = () => {}, onRecovered = () => {}, log = message => console.warn(message), sleep = wait, now = () => performance.now(),
  }) {
    this.store = store
    this.hostId = hostId
    this.leaseMs = leaseMs
    this.renewMs = renewMs
    this.drainWindowMs = drainWindowMs
    this.expiredRenewals = expiredRenewals
    this.onNewerActive = onNewerActive
    this.onExpired = onExpired
    this.onActivationRefused = onActivationRefused
    this.onUnavailable = onUnavailable
    this.onRecovered = onRecovered
    this.log = log
    this.sleep = sleep
    this.now = now
    /** 'idle' | 'acquiring' | 'unavailable' | 'starting' | 'active' | 'draining' | 'stopped' */
    this.state = 'idle'
    this.generation = null
    /** Active, but without authority (expired or unrenewable lease): no claims, no saves, no joins in `on`. */
    this.paused = false
    this.newerSeen = false
    /** Stopped because a newer host exists: definitive. */
    this.displaced = false
    this.expiredStreak = 0
    this.accepted = 0
    this.timer = null
    this.renewing = null
    this.recovering = null
    /** The last answer of the database about this host (monotonic `now()`). */
    this.lastAuthorityAt = null
    /** The lane: activate, drain, stop and renew, one at a time (never rejects). */
    this.lane = Promise.resolve()
    /** activate / drain / stop queued or running: no renew starts meanwhile. */
    this.exclusive = 0
    this.waiters = new Set()
    this.counters = {
      acquireRetries: 0, activation: null, renewals: 0, renewFailures: 0, newerActive: 0, expired: 0, refusedAnswers: 0, keys: 0,
      identities: 0, identityResets: 0, recoveries: 0, unavailable: 0, pauses: 0,
    }
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  /**
   * Before listen. Retries with backoff until a generation is assigned or `waitMs` passes; then
   * the host is 'unavailable' and keeps acquiring in the background (same hostId). Never throws.
   */
  async acquire({ waitMs = ACQUIRE_WAIT_MS } = {}) {
    if (this.state !== 'idle') return this.state
    this.state = 'acquiring'
    const deadline = this.now() + waitMs
    for (let attempt = 0; ; attempt++) {
      if (this.state !== 'acquiring') return this.state
      const outcome = await this.#acquireOnce()
      if (outcome !== 'transport') return this.state
      this.counters.acquireRetries++
      if (this.now() >= deadline) {
        this.#unavailable(`no generation after ${waitMs} ms`)
        return this.state
      }
      await this.sleep(retryMs(attempt))
    }
  }

  /** One acquire with the current hostId (idempotent: a lost answer is re-read, never a new generation). */
  async #acquireOnce() {
    let answer
    try {
      answer = await this.store.presenceAcquire(this.hostId, this.leaseMs)
      if (!Number.isSafeInteger(answer?.generation) || answer.generation < 1) throw new Error('malformed acquire answer')
    } catch {
      return 'transport'
    }
    this.#heard()
    if (this.generation !== answer.generation) this.counters.identities++
    this.generation = answer.generation
    if (answer.state === 'starting') {
      this.state = 'starting'
      this.#startRenewing()
      return 'starting'
    }
    if (answer.state === 'active') {
      // A lost activate answer: the database already made it active.
      this.#becomeActive()
      return 'active'
    }
    // This hostId was drained or stopped: it is gone for good (confirmed by the database).
    this.#newIdentity(`acquire answered ${answer.state}`)
    return 'reset'
  }

  /** Runs `op` on the lane after everything already on it. `exclusive`: no renew starts meanwhile. */
  #serial(op, exclusive) {
    if (exclusive) this.exclusive++
    const run = this.lane.then(op).finally(() => { if (exclusive) this.exclusive-- })
    this.lane = run.catch(() => {})
    return run
  }

  /**
   * After listen: starting → active. Waits for any renew in flight. Transport failures (40P01
   * included) are retried ACTIVATE_ATTEMPTS times with the same identity; still unreachable, the
   * host goes 'unavailable' and keeps trying in the background (recoverable). newer_active
   * displaces it for good; host_expired / unknown_host / host_inactive make it take a new
   * identity in the background (recoverable).
   */
  activate() {
    if (this.state !== 'starting') return Promise.resolve(this.state)
    return this.#activateWithRetries()
  }

  /**
   * Each attempt takes the lane on its own and the backoff sleeps OUTSIDE it (review N1): the
   * renewals in between keep the starting lease alive, so retrying through an outage shorter
   * than the lease never costs a new generation. Within one attempt activate and renew stay
   * serialized (F3).
   */
  async #activateWithRetries() {
    for (let attempt = 0; attempt < ACTIVATE_ATTEMPTS; attempt++) {
      const outcome = await this.#serial(() => (this.state === 'starting' ? this.#activateOnce() : 'done'), true)
      // A drain or stop that came first wins: never bring a host back.
      if (outcome !== 'transport' || this.state !== 'starting') return this.state
      if (attempt < ACTIVATE_ATTEMPTS - 1) await this.sleep(retryMs(attempt))
    }
    this.counters.activation = 'unreachable'
    if (this.state === 'starting') this.#unavailable('activation unreachable')
    return this.state
  }

  /** One activate with the current identity: 'active' | 'displaced' | 'reset' | 'transport'. */
  async #activateOnce() {
    let answer
    try {
      answer = await this.store.presenceActivate(this.generation, this.hostId, this.leaseMs)
    } catch {
      return 'transport'
    }
    if (!answer || typeof answer.status !== 'string') return 'transport'
    this.#heard()
    this.counters.activation = answer.status
    if (answer.status === 'active') {
      if (this.state === 'starting' || this.state === 'unavailable') this.#becomeActive()
      return 'active'
    }
    if (answer.status === 'newer_active') {
      this.log('[host] activation refused (newer_active): a newer host is active — this one is displaced for good')
      this.newerSeen = true
      this.displaced = true
      await this.#stopNow()
      this.onActivationRefused('newer_active')
      return 'displaced'
    }
    // host_expired (the starting lease ran out), unknown_host, host_inactive: this identity is gone.
    this.#newIdentity(`activation answered ${answer.status}`)
    return 'reset'
  }

  #becomeActive() {
    const was = this.state
    this.state = 'active'
    this.paused = false
    this.expiredStreak = 0
    this.#startRenewing()
    this.#settleWaiters()
    if (was === 'unavailable') {
      this.counters.recoveries++
      this.log(`[host] authority back: generation ${this.generation} active`)
      this.onRecovered()
    }
  }

  /** Recoverable: no authority for now. Keeps the identity (if any) and recovers in the background. */
  #unavailable(reason) {
    if (this.displaced || this.state === 'stopped' || this.state === 'draining') return
    this.state = 'unavailable'
    this.counters.unavailable++
    this.log(`[host] ${reason}: unavailable — /readyz 503 and joins 4503 in 'on' until the authority answers; recovering in the background`)
    this.#settleWaiters()
    this.onUnavailable(reason)
    void this.#recover()
  }

  /** The database confirmed this identity is gone: a new hostId (hence a new generation) next. */
  #newIdentity(reason) {
    if (this.displaced) return
    this.counters.identityResets++
    this.#stopRenewing()
    this.generation = null
    this.hostId = randomUUID()
    this.paused = false
    this.#unavailable(`${reason}; a new identity will be acquired`)
  }

  /**
   * Background recovery, single-flight, bounded backoff (1 s doubling to 30 s): acquire with the
   * current hostId if there is no generation, then activate the held identity. Stops as soon as
   * the host is active, displaced, draining or stopped. Never throws; never exits.
   */
  #recover() {
    if (this.recovering) return this.recovering
    this.recovering = (async () => {
      try {
        for (let attempt = 0; this.state === 'unavailable' && !this.displaced; attempt++) {
          await this.sleep(recoveryMs(attempt))
          if (this.state !== 'unavailable' || this.displaced) break
          if (this.generation === null) {
            const acquired = await this.#acquireOnce()
            if (acquired === 'transport') { this.counters.acquireRetries++; this.state = 'unavailable'; continue }
            if (acquired !== 'starting') continue
          }
          const outcome = await this.#serial(() => (this.state === 'starting' || this.state === 'unavailable') ? this.#activateOnce() : 'done', true)
          if (outcome === 'transport' && this.state === 'starting') this.state = 'unavailable'
        }
      } finally {
        this.recovering = null
      }
    })()
    return this.recovering
  }

  /**
   * active → draining (fixed flush window); starting / unavailable → stopped. The local state
   * changes at once (claims stop now); the database call waits for any renew in flight. A host
   * whose lease already ran out is NOT revived (host_expired): it stops and cannot flush.
   * Idempotent; never throws.
   */
  drain() {
    if (this.state !== 'active' && this.state !== 'starting' && this.state !== 'unavailable') return Promise.resolve(this.state)
    this.state = this.state === 'active' ? 'draining' : 'stopped'
    this.#settleWaiters()
    if (this.generation === null) { this.#stopRenewing(); return Promise.resolve(this.state) }
    return this.#serial(() => this.#drainCall(), true)
  }

  async #drainCall() {
    for (let attempt = 0; attempt < HOST_CALL_ATTEMPTS; attempt++) {
      try {
        const answer = await this.store.presenceDrain(this.generation, this.hostId, this.drainWindowMs)
        if (answer?.status === 'host_expired') {
          // The last positions of this host are lost rather than handing authority back to a
          // host whose lease ran out (review F6); the save CAS is only a second line of defence.
          this.log('[host] drain refused: the lease already ran out; nothing is flushed')
          this.state = 'stopped'
          this.#settleWaiters()
        } else if (answer?.state === 'stopped') this.state = 'stopped'
        break
      } catch (error) {
        if (attempt === HOST_CALL_ATTEMPTS - 1) this.log(`[host] drain call failed (${String(error?.message ?? error).slice(0, 60)}); the lease runs out on its own`)
        else await this.sleep(retryMs(attempt))
      }
    }
    if (this.state === 'stopped') this.#stopRenewing()
    return this.state
  }

  /** Any → stopped (terminal), at once locally; the database call waits its turn. Idempotent; never throws. */
  stop() {
    const had = this.generation !== null && this.state !== 'stopped'
    this.#markStopped()
    if (!had) return Promise.resolve(this.state)
    return this.#serial(() => this.#stopCall(), true)
  }

  /** A newer host exists (the room drained already): stopped, for good. */
  displace() {
    this.displaced = true
    this.newerSeen = true
    return this.stop()
  }

  /** stop from inside the lane (activate's refusal): already this operation's turn. */
  async #stopNow() {
    const had = this.generation !== null && this.state !== 'stopped'
    this.#markStopped()
    if (had) await this.#stopCall()
    return this.state
  }

  #markStopped() {
    this.state = 'stopped'
    this.#stopRenewing()
    this.#settleWaiters()
  }

  async #stopCall() {
    for (let attempt = 0; attempt < HOST_CALL_ATTEMPTS; attempt++) {
      try {
        await this.store.presenceStop(this.generation, this.hostId)
        return this.state
      } catch (error) {
        if (attempt === HOST_CALL_ATTEMPTS - 1) this.log(`[host] stop call failed (${String(error?.message ?? error).slice(0, 60)}); the lease runs out on its own`)
        else await this.sleep(retryMs(attempt))
      }
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

  #heard() { this.lastAuthorityAt = this.now() }

  get #renewable() {
    return this.generation !== null && (this.state === 'starting' || this.state === 'active' || this.state === 'draining' || this.state === 'unavailable')
  }

  /**
   * One renewal (also run at once after a refused answer). Single-flight, on the lane; never
   * started while activate, drain or stop is queued or running; never throws. An active host
   * that could not renew for a whole lease period pauses (no authority) until a renewal answers.
   */
  renew() {
    if (this.renewing) return this.renewing
    if (this.exclusive > 0) return Promise.resolve(this.state)
    if (!this.#renewable) return Promise.resolve(this.state)
    this.renewing = this.#serial(async () => {
      if (!this.#renewable) {
        this.renewing = null
        return this.state
      }
      try {
        const answer = await this.store.presenceRenew(this.generation, this.hostId, this.leaseMs)
        if (!answer || typeof answer !== 'object') throw new Error('malformed renew answer')
        this.counters.renewals++
        this.#heard()
        this.observe(answer)
        if (answer.status === 'ok' && this.state === 'active') {
          if (answer.leaseLive === false) this.#expired()
          else if (this.paused) { this.paused = false; this.expiredStreak = 0; this.counters.recoveries++; this.log('[host] authority back: lease renewed'); this.#settleWaiters(); this.onRecovered() }
          else this.expiredStreak = 0
        }
      } catch {
        this.counters.renewFailures++
        if (this.state === 'active' && !this.paused && this.lastAuthorityAt !== null && this.now() - this.lastAuthorityAt >= this.leaseMs) this.#pause('no renewal answered for a whole lease period')
      } finally {
        this.renewing = null
      }
      return this.state
    }, false)
    return this.renewing
  }

  /** Active without authority (recoverable): no claims, no saves, no joins in `on`; keeps renewing. */
  #pause(reason) {
    if (this.paused) return
    this.paused = true
    this.counters.pauses++
    this.log(`[host] ${reason}: paused — /readyz 503 and joins 4503 in 'on' until a renewal answers`)
    this.#settleWaiters()
    this.onUnavailable(reason)
  }

  #expired() {
    this.#pause('the lease ran out')
    this.counters.expired++
    if (++this.expiredStreak === this.expiredRenewals) {
      this.log(`[host] lease still expired after ${this.expiredRenewals} renewals: still paused, still renewing`)
      this.onExpired()
    }
  }

  /**
   * Any answer of the database about this host (renew, claim, save): newerActive is the
   * definitive evidence of a newer host (the room drains in `on`, counts in shadow);
   * host_expired pauses an active host (it renews at once) and makes a starting identity be
   * replaced; unknown_host replaces the identity (recoverable); host_inactive follows the
   * database (the end of this host's own drain, or a lost identity).
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
        if (this.state === 'starting' || this.state === 'unavailable') { this.#newIdentity('the starting lease ran out'); return }
        if (this.state === 'active' && !this.paused) { this.#pause('the lease ran out'); void this.renew() }
        return
      case 'host_inactive':
        this.counters.refusedAnswers++
        if (answer.state === 'draining' && this.state === 'active') { this.state = 'draining'; this.#settleWaiters(); return }
        if (this.state === 'draining' || this.state === 'stopped') { this.#markStopped(); return }
        this.#newIdentity(`the database holds this host as ${answer.state}`)
        return
      case 'unknown_host':
        this.counters.refusedAnswers++
        if (this.state === 'draining' || this.state === 'stopped') { this.#markStopped(); return }
        this.#newIdentity('the database does not know this host')
    }
  }

  // ── What the room and the journal read ──────────────────────────────────

  /** A join may be accepted with persistence: active with authority (shadow decides for itself). */
  get admitting() { return this.state === 'active' && !this.paused }
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
    return { state: this.state, generation: this.generation, paused: this.paused, displaced: this.displaced, newerSeen: this.newerSeen, accepted: this.accepted, ...this.counters }
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
  host.displace = async () => { host.displaced = true; host.state = 'stopped'; return host.state }
  return host
}
