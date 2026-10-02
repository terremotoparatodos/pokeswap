/**
 * WORLD LOCATION-2 — the realtime's only writer of player locations.
 *
 * One entry per player. It never writes on the step path: a step, a portal or
 * a disconnect only marks the entry (O(1)); `tick()` sends what is due in one
 * batch (≤ 200 rows) with a single batch in flight at a time.
 *
 *   portal / disconnect   urgent: the next tick (ticks run every second; with one
 *                         batch per tick and one in flight, a process makes at
 *                         most one location_save per second, however busy)
 *   any other move        a checkpoint: ≥ 10 s after the player's last write,
 *                         plus a per-player jitter in [0, 2 s) derived from
 *                         the user id (deterministic and bounded), so players
 *                         who joined together do not checkpoint together
 *   shutdown              `flushAll(deadline)`: best effort, never relied on
 *
 * Sessions and the fence (WORLD_LOCATION_1_AUDIT §4.5):
 *   - every new session of a player claims a fresh epoch from the database
 *     (`locationClaim`); claims of one player are chained, so the newest
 *     session always ends up with the highest epoch on this process;
 *   - the seq is this journal's own counter, per epoch. Never `moveSequence`
 *     (the client drives that one);
 *   - a session without a confirmed claim ('claiming' or 'unclaimed') keeps
 *     playing but never saves. It keeps only its latest position (one slot)
 *     and retries the claim with a bounded backoff (1 s → 30 s) while live;
 *   - 'stale' for the current epoch fences the writer at once (no more
 *     writes) and calls `onFenced(userId, epoch)`: the room disconnects that
 *     session with 4001 'session-replaced'. 'stale' for an older epoch of the
 *     same player (its previous session) is just dropped;
 *   - results are read per user: one row's answer never confirms another.
 *
 * Memory is bounded: one slot per player and at most `maxEntries` players
 * (live sessions are never evicted; the oldest disconnected ones are, and
 * counted in `dropped.evicted`).
 *
 * No user id, area or tile ever reaches `stats()`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const AREA_ID = /^[a-z][a-z0-9-]{2,47}$/
const LAYOUT_VERSION = /^[a-z0-9.-]{1,32}$/
const tile = value => Number.isInteger(value) && value >= -4096 && value <= 4095

export const LOCATION_TICK_MS = 1_000
export const CHECKPOINT_MS = 10_000
export const CHECKPOINT_JITTER_MS = 2_000
export const MAX_BATCH_ROWS = 200
export const MAX_JOURNAL_ENTRIES = 1_000
export const BACKOFF_BASE_MS = 1_000
export const BACKOFF_MAX_MS = 30_000
export const MAX_CLAIMS_PER_TICK = 10

/** A persistable identity: a Supabase user id. Guests and `benchmark-*` ids are never persisted. */
export const persistableIdentity = userId => typeof userId === 'string' && UUID.test(userId)

/** Deterministic, bounded jitter in [0, span) from a user id (FNV-1a). */
export function jitterFor(userId, span = CHECKPOINT_JITTER_MS) {
  let hash = 0x811c9dc5
  for (let i = 0; i < userId.length; i++) { hash ^= userId.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0 }
  return hash % span
}

export const backoffMs = attempt => Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt))

const sameLocation = (a, b) => a !== null && b !== null && a !== undefined && b !== undefined &&
  a.areaId === b.areaId && a.tx === b.tx && a.ty === b.ty && a.layoutVersion === b.layoutVersion

const validRow = row => UUID.test(row.userId) && AREA_ID.test(row.areaId) && tile(row.tx) && tile(row.ty) && LAYOUT_VERSION.test(row.layoutVersion)

export class LocationJournal {
  /**
   * `store`: { locationClaim(userId), locationSave(rows) → Map<userId, result> }.
   * `locate(actor)`: the location to save for an actor ({ areaId, tx, ty, layoutVersion })
   *   or null when its area is not saved (the journal then keeps the last saved one).
   */
  constructor({ store, locate, now = Date.now, onFenced = () => {}, onClaimed = () => {}, log = message => console.warn(message), maxEntries = MAX_JOURNAL_ENTRIES }) {
    this.store = store
    this.locate = locate
    this.now = now
    this.onFenced = onFenced
    this.onClaimed = onClaimed
    this.log = log
    this.maxEntries = maxEntries
    this.entries = new Map()
    this.inflight = null
    this.failures = 0
    this.nextFlushAt = 0
    this.disabled = false
    this.timer = null
    this.counters = {
      sessions: 0,
      claims: { ok: 0, unknownUser: 0, failed: 0, superseded: 0, retries: 0 },
      saves: { batches: 0, rows: 0, applied: 0, duplicate: 0, stale: 0, staleOldEpoch: 0, invalid: 0, unknown: 0, failedBatches: 0, unchanged: 0, maxBatch: 0, lastBatchMs: 0 },
      fenced: 0,
      dropped: { evicted: 0, unclaimed: 0, invalid: 0, disabled: 0 },
    }
  }

  // ── Sessions ──────────────────────────────────────────────────────────

  /**
   * A new session of a player (synchronous, on join). Any position still
   * waiting from a previous session is dropped unless its batch is in flight:
   * the new session's own position is marked right after (`note`), and it is
   * the truth from now on (it came from the live actor, the reconnect cache
   * or a validated restore).
   */
  beginSession(userId) {
    const now = this.now()
    if (this.disabled) return { userId, live: true, epoch: null, startedAt: now }
    let entry = this.entries.get(userId)
    if (!entry) {
      entry = { userId, session: null, status: 'claiming', epoch: null, seq: 0, pending: null, saved: null, lastWriteAt: now, claimAttempts: 0, nextClaimAt: 0, chain: Promise.resolve(), touchedAt: now }
      this.entries.set(userId, entry)
      this.#evict()
    }
    const session = { userId, live: true, epoch: null, startedAt: now }
    entry.session = session
    entry.status = 'claiming'
    entry.epoch = null
    entry.seq = 0
    entry.saved = null
    entry.claimAttempts = 0
    entry.nextClaimAt = 0
    entry.lastWriteAt = now
    entry.touchedAt = now
    if (entry.pending && !entry.pending.inflight) entry.pending = null
    this.counters.sessions++
    return session
  }

  /**
   * Claims an epoch for `session` (chained after any claim of the same player
   * still in flight). Resolves, never rejects:
   *   { status: 'claimed', epoch, location } | { status: 'failed' } |
   *   { status: 'unknown_user' } | { status: 'superseded' }
   * Every outcome for the CURRENT session also goes to `onClaimed(session, result)`.
   */
  claim(session) {
    const entry = this.entries.get(session.userId)
    if (!entry || entry.session !== session || this.disabled) return Promise.resolve({ status: 'superseded' })
    entry.claiming = true
    const attempt = entry.chain.then(() => this.#claimOnce(entry, session))
    entry.chain = attempt.then(() => undefined, () => undefined)
    return attempt
  }

  async #claimOnce(entry, session) {
    let result
    try {
      result = await this.store.locationClaim(session.userId)
    } catch {
      result = { status: 'failed' }
    }
    if (entry.session !== session || this.disabled) {
      this.counters.claims.superseded++
      if (entry.session === session) entry.claiming = false
      return { status: 'superseded' }
    }
    entry.claiming = false
    if (result?.status === 'claimed') {
      this.counters.claims.ok++
      entry.status = 'claimed'
      entry.epoch = result.epoch
      session.epoch = result.epoch
      entry.seq = 0
      entry.saved = result.location ?? null
      entry.claimAttempts = 0
    } else if (result?.status === 'unknown_user') {
      // Not an auth user (deleted mid-session?): nothing to persist, nothing to retry.
      this.counters.claims.unknownUser++
      entry.status = 'disabled'
      entry.pending = null
    } else {
      this.counters.claims.failed++
      entry.status = 'unclaimed'
      entry.nextClaimAt = this.now() + backoffMs(entry.claimAttempts) + jitterFor(session.userId, 250)
      entry.claimAttempts++
      result = { status: 'failed' }
    }
    this.onClaimed(session, result)
    return result
  }

  /** The room gave up waiting for the claim (1.5 s): the session plays on, unclaimed. */
  markUnclaimed(session) {
    const entry = this.entries.get(session.userId)
    if (entry?.session === session && entry.status === 'claiming') entry.status = 'unclaimed'
  }

  /** The state of a session: 'claiming' | 'unclaimed' | 'claimed' | 'fenced' | 'disabled' | 'replaced'. */
  statusOf(session) {
    const entry = this.entries.get(session.userId)
    return entry?.session === session ? entry.status : 'replaced'
  }

  /**
   * The actor's position changed (or must be saved again). O(1): the slot
   * keeps a reference to the actor and is read when the batch is built.
   */
  note(session, actor, { urgent = false } = {}) {
    if (this.disabled) return
    const entry = this.entries.get(session.userId)
    if (!entry || entry.session !== session) return
    if (entry.status === 'fenced' || entry.status === 'disabled') return
    const now = this.now()
    entry.touchedAt = now
    const pending = entry.pending
    if (pending && pending.session === session) {
      pending.actor = actor
      pending.version++
      pending.urgent ||= urgent
      return
    }
    entry.pending = { session, actor, version: 1, urgent, since: now, attempt: null, inflight: false }
  }

  /**
   * The session's socket closed: its last position is urgent. A session that
   * never got a claim cannot write (claiming now could fence a newer session
   * elsewhere), so its slot is dropped and counted.
   */
  endSession(session, actor) {
    const entry = this.entries.get(session.userId)
    session.live = false
    if (!entry || entry.session !== session) return
    if (entry.status === 'claimed') {
      if (actor) this.note(session, actor, { urgent: true })
      return
    }
    // The disconnect position of a session that never got a claim is lost (counted), not queued.
    const lost = (actor || entry.pending) && entry.status !== 'fenced' && entry.status !== 'disabled'
    if (entry.pending && !entry.pending.inflight) entry.pending = null
    if (lost) this.counters.dropped.unclaimed++
    this.#forgetIfIdle(entry)
  }

  // ── Flushing ──────────────────────────────────────────────────────────

  /** Starts the production timer (unref'd: it never keeps the process alive). */
  start(intervalMs = LOCATION_TICK_MS) {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), intervalMs)
    this.timer.unref?.()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Rollback to `off` at runtime: no claim or save leaves this process from now on. */
  disable() {
    this.disabled = true
    this.stop()
    for (const entry of this.entries.values()) if (entry.pending) { entry.pending = null; this.counters.dropped.disabled++ }
    this.entries.clear()
  }

  /** One pass: claim retries that are due, then at most one batch. Never awaits. */
  tick(now = this.now()) {
    if (this.disabled) return null
    this.#retryClaims(now)
    if (this.inflight || now < this.nextFlushAt) return this.inflight
    return this.#flush(now, false)
  }

  /** Resolves when no batch is in flight (tests and shutdown). */
  async idle() {
    while (this.inflight) await this.inflight
  }

  /**
   * Shutdown (best effort, never part of correctness): sends every pending
   * position of a claimed session, ignoring cadence and backoff, until done or
   * `deadlineMs` passes. Resolves with { sent, left }.
   */
  async flushAll(deadlineMs = 3_000, { sleep = ms => new Promise(resolve => { const t = setTimeout(resolve, ms); t.unref?.() }) } = {}) {
    const started = this.now()
    const remaining = () => Math.max(0, deadlineMs - (this.now() - started))
    // Never wait past the deadline, even on a hung authority: the process is exiting anyway.
    const within = async promise => (await Promise.race([promise.then(() => true), sleep(remaining()).then(() => false)]))
    let sent = 0
    for (const entry of this.entries.values()) if (entry.pending) entry.pending.urgent = true
    const waiting = () => [...this.entries.values()].filter(e => e.pending && e.status === 'claimed').length
    if (this.inflight && !(await within(this.inflight))) return { sent, left: waiting(), timedOut: true }
    while (!this.disabled && remaining() > 0) {
      const before = waiting()
      const batch = this.#flush(this.now(), true)
      if (!batch) break
      let rows = 0
      const done = await within(batch.then(result => { rows = result.rows }))
      if (!done) return { sent, left: waiting(), timedOut: true }
      sent += rows
      // A failed batch, or a pass that confirmed nothing (only 'unknown' answers): stop, do not spin.
      if (this.failures > 0 || waiting() >= before) break
    }
    return { sent, left: waiting(), timedOut: false }
  }

  #retryClaims(now) {
    let fired = 0
    for (const entry of this.entries.values()) {
      if (fired >= MAX_CLAIMS_PER_TICK) break
      const session = entry.session
      if (entry.status !== 'unclaimed' || entry.claiming || !session?.live || now < entry.nextClaimAt) continue
      fired++
      this.counters.claims.retries++
      void this.claim(session)
    }
  }

  #due(entry, now, all) {
    const pending = entry.pending
    if (!pending || pending.inflight || entry.status !== 'claimed' || pending.session !== entry.session) return false
    if (all || pending.urgent) return true
    return now >= entry.lastWriteAt + CHECKPOINT_MS + jitterFor(entry.userId)
  }

  #flush(now, all) {
    const due = []
    for (const entry of this.entries.values()) if (this.#due(entry, now, all)) due.push(entry)
    if (!due.length) return null
    // Urgent first (oldest first), then checkpoints by how overdue they are.
    due.sort((a, b) => (b.pending.urgent - a.pending.urgent) || (a.pending.since - b.pending.since))
    const rows = []
    const sent = []
    for (const entry of due) {
      if (rows.length >= MAX_BATCH_ROWS) break
      const pending = entry.pending
      const location = this.locate(pending.actor)
      if (!location) { entry.pending = null; this.#forgetIfIdle(entry); continue }
      if (sameLocation(location, entry.saved)) {
        // Nothing new to write (e.g. a portal straight back): confirmed as is.
        this.counters.saves.unchanged++
        entry.pending = null
        entry.lastWriteAt = now
        this.#forgetIfIdle(entry)
        continue
      }
      // A retry of the SAME location keeps its (epoch, seq): applied twice answers 'duplicate'.
      // A different location always gets a new seq, so a 'duplicate' never hides new data.
      const reuse = pending.attempt && pending.attempt.epoch === entry.epoch && sameLocation(pending.attempt.location, location)
      const seq = reuse ? pending.attempt.seq : ++entry.seq
      const row = { userId: entry.userId, epoch: entry.epoch, seq, ...location }
      if (!validRow(row)) { this.counters.dropped.invalid++; entry.pending = null; this.#forgetIfIdle(entry); continue }
      pending.attempt = { epoch: entry.epoch, seq, location }
      pending.inflight = true
      rows.push(row)
      sent.push({ entry, pending, version: pending.version, row })
    }
    if (!rows.length) return null
    const started = this.now()
    this.counters.saves.batches++
    this.counters.saves.rows += rows.length
    if (rows.length > this.counters.saves.maxBatch) this.counters.saves.maxBatch = rows.length
    this.inflight = this.#send(rows, sent, started).finally(() => { this.inflight = null })
    return this.inflight
  }

  async #send(rows, sent, started) {
    let results = null
    try {
      results = await this.store.locationSave(rows)
    } catch (error) {
      this.counters.saves.failedBatches++
      this.failures++
      this.nextFlushAt = this.now() + backoffMs(this.failures - 1)
      this.log(`[location] save batch failed (${String(error?.message ?? error).slice(0, 60)}); retrying with backoff`)
      for (const { pending } of sent) pending.inflight = false
      return { rows: 0 }
    }
    this.failures = 0
    this.nextFlushAt = 0
    this.counters.saves.lastBatchMs = Math.round(this.now() - started)
    for (const { entry, pending, version, row } of sent) {
      pending.inflight = false
      if (this.disabled) continue
      const result = results.get(row.userId.toLowerCase()) ?? 'unknown'
      const stillThisSession = entry.session === pending.session && entry.epoch === row.epoch
      if (result === 'applied' || result === 'duplicate') {
        this.counters.saves[result]++
        if (!stillThisSession) continue
        entry.saved = pending.attempt.location
        entry.lastWriteAt = this.now()
        pending.attempt = null
        // A move noted while this row was in flight stays pending for the next batch.
        if (entry.pending === pending && pending.version === version) entry.pending = null
        this.#forgetIfIdle(entry)
      } else if (result === 'stale') {
        if (!stillThisSession) { this.counters.saves.staleOldEpoch++; if (entry.pending === pending) entry.pending = null; continue }
        // Another session of this player claimed a newer epoch (another instance, or a newer
        // join here): this writer is fenced for good, and its session must go.
        this.counters.saves.stale++
        this.counters.fenced++
        entry.status = 'fenced'
        entry.pending = null
        const session = entry.session
        this.onFenced(row.userId, row.epoch, session)
        this.#forgetIfIdle(entry)
      } else if (result === 'invalid') {
        this.counters.saves.invalid++
        if (entry.pending === pending && pending.version === version) entry.pending = null
        pending.attempt = null
      } else {
        // 'unknown': this user only is retried at the next tick (same seq for the same location).
        this.counters.saves.unknown++
      }
    }
    return { rows: rows.length }
  }

  #forgetIfIdle(entry) {
    if (!entry.pending && !entry.session?.live && this.entries.get(entry.userId) === entry) this.entries.delete(entry.userId)
  }

  #evict() {
    if (this.entries.size <= this.maxEntries) return
    const idle = [...this.entries.values()].filter(e => !e.session?.live && !e.pending?.inflight).sort((a, b) => a.touchedAt - b.touchedAt)
    for (const entry of idle) {
      if (this.entries.size <= this.maxEntries) break
      this.entries.delete(entry.userId)
      if (entry.pending) this.counters.dropped.evicted++
    }
  }

  // ── Metrics ───────────────────────────────────────────────────────────

  stats() {
    const status = { claiming: 0, unclaimed: 0, claimed: 0, fenced: 0, disabled: 0 }
    let pending = 0, urgent = 0
    for (const entry of this.entries.values()) {
      if (entry.session?.live) status[entry.status]++
      if (entry.pending) { pending++; if (entry.pending.urgent) urgent++ }
    }
    const { claims, saves, dropped } = this.counters
    return {
      sessions: { started: this.counters.sessions, live: status },
      entries: this.entries.size, pending, urgent, inflight: this.inflight !== null,
      backoffMs: this.failures ? Math.max(0, this.nextFlushAt - this.now()) : 0,
      claims: { ...claims }, saves: { ...saves }, fenced: this.counters.fenced, dropped: { ...dropped },
    }
  }
}
