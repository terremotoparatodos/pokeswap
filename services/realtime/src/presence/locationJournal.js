/**
 * WORLD LOCATION-2/4 — the realtime's only writer of player locations.
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
 *   shutdown / drain      `flushAll(deadline)`: best effort, never relied on
 *
 * Sessions and ordering (WORLD_LOCATION_4_DESIGN §3.4):
 *   - every session of a player gets a KEY when the room accepts it, synchronously in
 *     onJoin: (host generation, host acceptance order, session id). The key never
 *     changes: every claim and every retry of that session carries the same one;
 *   - the database takes the row only for a strictly greater key; the same key and
 *     session adopts it (a lost answer, retried: same epoch); a smaller key is
 *     'superseded', which is FINAL here: no re-read, no new key, no further claim.
 *     So a late, retried or abandoned claim of an older session can never displace a
 *     newer one (T3/T4/T7), whatever the latency;
 *   - the claim is sent only while the session is live and current and the host can
 *     claim (active, lease not paused); claims of one player are not chained (the key
 *     orders them, not the order of the calls);
 *   - the seq of a SAVE is this journal's own counter, per epoch. Never `moveSequence`
 *     (the client drives that one);
 *   - a session without a confirmed claim ('claiming' or 'unclaimed') keeps playing but
 *     never saves. It keeps only its latest position (one slot) and retries the claim
 *     with a bounded backoff (1 s → 30 s), at most MAX_CLAIM_ATTEMPTS times, only while
 *     live and while the host can claim; then it plays on without persistence;
 *   - 'stale' for the current epoch fences the writer at once (no more writes) and
 *     calls `onFenced(userId, epoch)`. 'stale' for an older epoch of the same player
 *     (its previous session) is just dropped;
 *   - host answers (host_inactive, host_expired, unknown_host, newerActive) go to the
 *     host (`host.observe`) WITH the identity the request was sent for (the session key's
 *     generation and hostId for a claim, the writing identity for a save): the host ignores
 *     an answer about an identity it no longer holds (review N6); nothing here loops on them;
 *   - results are read per user: one row's answer never confirms another.
 *
 * A host identity lost (review N6): when the host takes a new hostId/generation, the sessions
 * keyed by an earlier identity lose their persistence for good. They are found lazily (before
 * any claim, retry or batch is sent, and when an answer comes back): they become 'unpersisted',
 * their retries stop, their pending position is dropped (counted in `dropped.identityLost`),
 * and they are never fenced and never closed for it — the player keeps playing, unpersisted.
 * Their key is never reassigned and their positions are never sent under the new identity
 * (the database would refuse them anyway: the owner CAS). A player gets persistence back with
 * a new acceptance (a reconnection or a reload): the room gives that session a key of the
 * current identity, which outranks the old one, so its claim takes the row (restoring the last
 * position the old identity managed to save). Positions noted after the loss are lost.
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
/** Claim attempts (first one included) before a session plays on without persistence. */
export const MAX_CLAIM_ATTEMPTS = 6
/** The journal never waits longer than this for one claim call, whatever the adapter (the Edge one gives up at 4 s). */
export const CLAIM_WAIT_MS = 5_000

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

const HOST_REFUSALS = new Set(['host_inactive', 'host_expired', 'unknown_host'])
/** The host identity a session key was issued by (N6). */
const keyIdentity = key => (key ? { generation: key.generation, hostId: key.hostId } : null)
const sameHost = (a, b) => Boolean(a && b && a.generation === b.generation && a.hostId === b.hostId)

export class LocationJournal {
  /**
   * `store`: { locationClaim(userId, key), locationSave(rows, host) } (keyed, WORLD LOCATION-4).
   * `host`: { identity, canClaim, canSave, observe(answer) } (presence/hostLifecycle.js).
   * `locate(actor)`: the location to save for an actor ({ areaId, tx, ty, layoutVersion })
   *   or null when its area is not saved (the journal then keeps the last saved one).
   */
  constructor({ store, host, locate, now = Date.now, onFenced = () => {}, onClaimed = () => {}, log = message => console.warn(message), maxEntries = MAX_JOURNAL_ENTRIES, claimWaitMs = CLAIM_WAIT_MS }) {
    this.store = store
    this.host = host
    this.locate = locate
    this.now = now
    this.onFenced = onFenced
    this.onClaimed = onClaimed
    this.log = log
    this.maxEntries = maxEntries
    this.claimWaitMs = claimWaitMs
    this.entries = new Map()
    this.inflight = null
    this.failures = 0
    this.nextFlushAt = 0
    this.disabled = false
    this.timer = null
    this.counters = {
      sessions: 0,
      claims: { ok: 0, unknownUser: 0, failed: 0, superseded: 0, outranked: 0, retries: 0, abandoned: 0, hostRefused: 0, gaveUp: 0, noKey: 0, identityLost: 0, ownerDraining: 0, ownerUnreachable: 0 },
      saves: { batches: 0, rows: 0, applied: 0, duplicate: 0, stale: 0, staleOldEpoch: 0, invalid: 0, unknown: 0, failedBatches: 0, hostRefused: 0, unchanged: 0, maxBatch: 0, lastBatchMs: 0, identityLost: 0 },
      fenced: 0,
      dropped: { evicted: 0, unclaimed: 0, invalid: 0, disabled: 0, hostInactive: 0, identityLost: 0 },
    }
  }

  // ── Sessions ──────────────────────────────────────────────────────────

  /**
   * A new session of a player (synchronous, on join), with the key the host assigned to
   * it in onJoin (null: the host cannot persist now; the session plays on without it).
   * Any position still waiting from a previous session is dropped unless its batch is in
   * flight: the new session's own position is marked right after (`note`), and it is the
   * truth from now on (it came from the live actor, the reconnect cache or a validated
   * restore).
   */
  beginSession(userId, key = null) {
    const now = this.now()
    if (this.disabled) return { userId, key, live: true, epoch: null, startedAt: now }
    let entry = this.entries.get(userId)
    if (!entry) {
      entry = { userId, session: null, status: 'claiming', epoch: null, seq: 0, pending: null, saved: null, lastWriteAt: now, claimAttempts: 0, nextClaimAt: 0, claimsInFlight: 0, touchedAt: now }
      this.entries.set(userId, entry)
      this.#evict()
    }
    const session = { userId, key, live: true, epoch: null, startedAt: now }
    entry.session = session
    entry.status = key ? 'claiming' : 'unpersisted'
    entry.epoch = null
    entry.seq = 0
    entry.saved = null
    entry.claimAttempts = 0
    entry.nextClaimAt = 0
    entry.lastWriteAt = now
    entry.touchedAt = now
    if (entry.pending && !entry.pending.inflight) entry.pending = null
    this.counters.sessions++
    if (!key) this.counters.claims.noKey++
    return session
  }

  /**
   * Claims for `session` with its own key. Resolves, never rejects:
   *   { status: 'claimed', epoch, location } | { status: 'superseded' } (final: a greater
   *   key owns the row) | { status: 'failed' } | { status: 'unknown_user' } |
   *   { status: 'replaced' } (the session ended or was replaced in this process).
   * Every outcome for the CURRENT session also goes to `onClaimed(session, result)`.
   */
  claim(session) {
    const entry = this.entries.get(session.userId)
    if (!entry || entry.session !== session || this.disabled || !session.key) return Promise.resolve({ status: 'replaced' })
    // The entry is not forgotten or evicted while a claim of it is in flight.
    entry.claimsInFlight++
    return this.#claimOnce(entry, session).finally(() => {
      entry.claimsInFlight--
      this.#forgetIfIdle(entry)
    })
  }

  /** Only the live, current session of a player may send a claim, and only while its host can. */
  #mayClaim(entry, session) {
    return !this.disabled && session.live && entry.session === session && this.entries.get(entry.userId) === entry && Boolean(this.host?.canClaim)
  }

  /** One store call, never waited on past `claimWaitMs` (a late call stays harmless: it carries the same key). */
  async #claimCall(session) {
    let timer
    const giveUp = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('claim abandoned')), this.claimWaitMs)
      timer.unref?.()
    })
    try {
      // CLOUD READINESS-3: an explicit takeover («Jugar acá») travels with every claim of its session
      // (same key); stores without recovery ignore it.
      return await Promise.race([this.store.locationClaim(session.userId, session.key, session.takeover === true ? { takeover: true } : undefined), giveUp])
    } catch (error) {
      if (error?.message === 'claim abandoned') this.counters.claims.abandoned++
      return { status: 'failed' }
    } finally {
      clearTimeout(timer)
    }
  }

  async #claimOnce(entry, session) {
    // N6: a key of an identity the host no longer holds is never sent (nor retried).
    if (entry.session === session && session.live && !this.disabled && this.#keyLost(session)) return this.#identityLost(entry, session)
    if (!this.#mayClaim(entry, session)) {
      // Not sent: the session ended, was replaced, or its host cannot claim right now.
      if (entry.session === session && session.live && !this.disabled) return this.#claimFailed(entry, session, { status: 'failed' }, false)
      this.counters.claims.superseded++
      return { status: 'replaced' }
    }
    entry.claimAttempts++
    const result = await this.#claimCall(session)
    // N6: the answer is about the identity in the session's key; the host ignores it if that
    // identity is no longer its own.
    const sentFor = keyIdentity(session.key)
    if (result.newerActive) this.host?.observe?.({ newerActive: true }, sentFor)
    if (HOST_REFUSALS.has(result.status)) { this.counters.claims.hostRefused++; this.host?.observe?.(result, sentFor) }
    if (entry.session !== session || !session.live || this.disabled) {
      // The answer is for a session this process no longer runs: never applied.
      this.counters.claims.superseded++
      return { status: 'replaced' }
    }
    // The host moved to a new identity while this claim was in flight: whatever it answered,
    // this session has no persistence any more (never retried, never fenced).
    if (this.#keyLost(session)) return this.#identityLost(entry, session)
    if (result.status === 'claimed') {
      this.counters.claims.ok++
      entry.status = 'claimed'
      entry.epoch = result.epoch
      session.epoch = result.epoch
      entry.seq = 0
      entry.saved = result.location ?? null
      entry.claimAttempts = 0
      this.onClaimed(session, result)
      return result
    }
    if (result.status === 'superseded') {
      // A greater key owns the row: final. This session never claims or saves again.
      this.counters.claims.outranked++
      entry.status = 'superseded'
      if (entry.pending && !entry.pending.inflight) entry.pending = null
      // CLOUD READINESS-3: newerActive travels only when true (the close mapping reads it); otherwise the WORLD LOCATION-4 shape.
      const answer = result.newerActive === true ? { status: 'superseded', newerActive: true } : { status: 'superseded' }
      this.onClaimed(session, answer)
      return answer
    }
    if (result.status === 'owner_draining' || result.status === 'owner_unreachable') {
      // CLOUD READINESS-3: the row's owner is draining, or its lease ran out (crash or partition).
      // Retryable, never final: the same key is retried later; the room decides what the socket sees.
      this.counters.claims[result.status === 'owner_draining' ? 'ownerDraining' : 'ownerUnreachable']++
      return this.#claimFailed(entry, session, result, false, { status: result.status, newerActive: result.newerActive === true })
    }
    if (result.status === 'unknown_user') {
      // Not an auth user (deleted mid-session?): nothing to persist, nothing to retry.
      this.counters.claims.unknownUser++
      entry.status = 'disabled'
      entry.pending = null
      this.onClaimed(session, result)
      return result
    }
    return this.#claimFailed(entry, session, result, true)
  }

  /**
   * N6: the session's key belongs to an identity the host no longer holds (it took a new
   * hostId/generation). Only with a host that has an identity model; a session without a key
   * already has no persistence.
   */
  #keyLost(session) {
    if (!session?.key || !this.host || !('identity' in this.host)) return false
    const current = this.host.identity
    return !(current && current.generation === session.key.generation && current.hostId === session.key.hostId)
  }

  /**
   * N6: this session lost its persistence with its host identity. It keeps playing; its retries
   * stop, its pending position is dropped (unless a batch carries it: its answer decides), and
   * it is never fenced or closed for it. Answers { status: 'unpersisted' } (a hydrating socket
   * is placed at its fallback).
   */
  #identityLost(entry, session) {
    const answer = { status: 'unpersisted' }
    if (entry.session === session && (entry.status === 'claimed' || entry.status === 'claiming' || entry.status === 'unclaimed')) {
      entry.status = 'unpersisted'
      this.counters.claims.identityLost++
      if (entry.pending && !entry.pending.inflight) { entry.pending = null; this.counters.dropped.identityLost++ }
      this.onClaimed(session, answer)
    }
    this.#forgetIfIdle(entry)
    return answer
  }

  /** N6, before anything is sent: every live session keyed by a lost identity becomes unpersisted (logged once per loss). */
  #sweepIdentity() {
    let lost = 0
    for (const entry of this.entries.values()) {
      const session = entry.session
      if (!session?.live || !this.#keyLost(session)) continue
      if (entry.status !== 'claimed' && entry.status !== 'claiming' && entry.status !== 'unclaimed') continue
      if (entry.claimsInFlight > 0) continue // its answer comes back to #claimOnce, which decides
      this.#identityLost(entry, session)
      lost++
    }
    if (lost) this.log(`[location] the host took a new identity: ${lost} session(s) keep playing without persistence until they join again`)
  }

  /** A failed or refused claim: retried later (same key) while attempts remain, else no persistence for this session. */
  #claimFailed(entry, session, result, counted, reported = { status: 'failed' }) {
    if (counted) this.counters.claims.failed++
    if (entry.claimAttempts >= MAX_CLAIM_ATTEMPTS || result.status === 'unknown_host') {
      this.counters.claims.gaveUp++
      entry.status = 'unpersisted'
      if (entry.pending && !entry.pending.inflight) entry.pending = null
    } else {
      entry.status = 'unclaimed'
      entry.nextClaimAt = this.now() + backoffMs(Math.max(0, entry.claimAttempts - 1)) + jitterFor(session.userId, 250)
    }
    const answer = reported
    this.onClaimed(session, answer)
    return answer
  }

  /** The room gave up waiting for the claim (1.5 s): the session plays on, unclaimed. */
  markUnclaimed(session) {
    const entry = this.entries.get(session.userId)
    if (entry?.session === session && entry.status === 'claiming') entry.status = 'unclaimed'
  }

  /** The state of a session: 'claiming' | 'unclaimed' | 'claimed' | 'fenced' | 'superseded' | 'disabled' | 'unpersisted' | 'replaced'. */
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
    if (entry.status === 'fenced' || entry.status === 'disabled' || entry.status === 'superseded' || entry.status === 'unpersisted') return
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
   * never got a claim cannot write (it owns no row), so its slot is dropped and counted.
   */
  endSession(session, actor) {
    const entry = this.entries.get(session.userId)
    session.live = false
    if (!entry || entry.session !== session) return
    if (entry.status === 'claimed') {
      if (actor) this.note(session, actor, { urgent: true })
      return
    }
    const lost = (actor || entry.pending) && (entry.status === 'claiming' || entry.status === 'unclaimed')
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
   * Shutdown or drain (best effort, never part of correctness): sends every pending
   * position of a claimed session, ignoring cadence and backoff, until done or
   * `deadlineMs` passes. Resolves with
   *   { sent, applied, duplicate, stale, hostRefused, left, timedOut }
   * where `sent` counts rows sent, `applied` rows the database wrote, `stale` rows it
   * refused because another session already owns them, `hostRefused` rows dropped because
   * this host was no longer active, and `left` rows not sent.
   */
  async flushAll(deadlineMs = 3_000, { sleep = ms => new Promise(resolve => { const t = setTimeout(resolve, ms); t.unref?.() }) } = {}) {
    const started = this.now()
    const remaining = () => Math.max(0, deadlineMs - (this.now() - started))
    // Never wait past the deadline, even on a hung authority: the process is exiting anyway.
    const within = async promise => (await Promise.race([promise.then(() => true), sleep(remaining()).then(() => false)]))
    const total = { sent: 0, applied: 0, duplicate: 0, stale: 0, hostRefused: 0 }
    const add = counts => { for (const key of Object.keys(total)) total[key] += counts[key] ?? 0 }
    for (const entry of this.entries.values()) if (entry.pending) entry.pending.urgent = true
    const waiting = () => [...this.entries.values()].filter(e => e.pending && e.status === 'claimed').length
    if (this.inflight && !(await within(this.inflight.then(add)))) return { ...total, left: waiting(), timedOut: true }
    while (!this.disabled && remaining() > 0) {
      const before = waiting()
      const batch = this.#flush(this.now(), true)
      if (!batch) break
      const done = await within(batch.then(add))
      if (!done) return { ...total, left: waiting(), timedOut: true }
      // A failed or refused batch, or a pass that confirmed nothing (only 'unknown' answers): stop, do not spin.
      if (this.failures > 0 || waiting() >= before) break
    }
    return { ...total, left: waiting(), timedOut: false }
  }

  #retryClaims(now) {
    this.#sweepIdentity()
    if (!this.host?.canClaim) return
    let fired = 0
    for (const entry of this.entries.values()) {
      if (fired >= MAX_CLAIMS_PER_TICK) break
      const session = entry.session
      if (entry.status !== 'unclaimed' || entry.claimsInFlight > 0 || !session?.live || now < entry.nextClaimAt) continue
      fired++
      this.counters.claims.retries++
      void this.claim(session)
    }
  }

  #due(entry, now, all) {
    const pending = entry.pending
    if (!pending || pending.inflight || entry.status !== 'claimed' || pending.session !== entry.session) return false
    // N6: never under another identity than the one that keyed the session.
    if (this.#keyLost(entry.session)) return false
    if (all || pending.urgent) return true
    return now >= entry.lastWriteAt + CHECKPOINT_MS + jitterFor(entry.userId)
  }

  #flush(now, all) {
    this.#sweepIdentity()
    // The host must be able to save (active, or draining for its final flush).
    if (!this.host?.canSave) return null
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

  /** Sends one batch; resolves with what happened to it: { sent, applied, duplicate, stale, hostRefused }. */
  async #send(rows, sent, started) {
    const counts = { sent: 0, applied: 0, duplicate: 0, stale: 0, hostRefused: 0 }
    // N6: the batch is written by, and its answer is about, the identity that sends it.
    const identity = this.host.identity
    let answer = null
    try {
      answer = await this.store.locationSave(rows, identity)
    } catch (error) {
      this.counters.saves.failedBatches++
      this.failures++
      this.nextFlushAt = this.now() + backoffMs(this.failures - 1)
      this.log(`[location] save batch failed (${String(error?.message ?? error).slice(0, 60)}); retrying with backoff`)
      for (const { pending } of sent) pending.inflight = false
      return counts
    }
    counts.sent = rows.length
    if (answer.newerActive) this.host.observe?.({ newerActive: true }, identity)
    if (answer.status !== 'ok') {
      // The whole batch was refused because of this host's state: the host decides what comes next.
      this.counters.saves.hostRefused++
      this.host.observe?.(answer, identity)
      this.failures++
      this.nextFlushAt = this.now() + backoffMs(this.failures - 1)
      for (const { entry, pending } of sent) {
        pending.inflight = false
        // An inactive or unknown host will never write again: these positions are lost (counted).
        if (answer.status !== 'host_expired' && entry.pending === pending) { entry.pending = null; this.counters.dropped.hostInactive++; counts.hostRefused++; this.#forgetIfIdle(entry) }
      }
      counts.sent = 0
      this.#sweepIdentity() // N6: a refusal about a lost identity: its sessions are unpersisted now
      return counts
    }
    const results = answer.results
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
        counts[result]++
        if (!stillThisSession) continue
        entry.saved = pending.attempt.location
        entry.lastWriteAt = this.now()
        pending.attempt = null
        // A move noted while this row was in flight stays pending for the next batch.
        if (entry.pending === pending && pending.version === version) entry.pending = null
        this.#forgetIfIdle(entry)
      } else if (result === 'stale') {
        counts.stale++
        if (!stillThisSession) { this.counters.saves.staleOldEpoch++; if (entry.pending === pending) entry.pending = null; continue }
        if (!sameHost(identity, this.host.identity) || this.#keyLost(entry.session) || entry.status === 'unpersisted') {
          // N6: refused because the identity that wrote it is gone, not because another session
          // took the row: no fencing, no close; the session plays on without persistence.
          this.counters.saves.identityLost++
          if (entry.pending === pending) entry.pending = null
          this.#identityLost(entry, entry.session)
          continue
        }
        // Another session of this player (a greater key, here or on another host) took the
        // row: this writer is fenced for good, and its session must go.
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
    return counts
  }

  /** A player is forgotten only when nothing of it is live, pending or being claimed. */
  #forgetIfIdle(entry) {
    if (!entry.pending && !entry.session?.live && entry.claimsInFlight === 0 && this.entries.get(entry.userId) === entry) this.entries.delete(entry.userId)
  }

  #evict() {
    if (this.entries.size <= this.maxEntries) return
    const idle = [...this.entries.values()].filter(e => !e.session?.live && !e.pending?.inflight && e.claimsInFlight === 0).sort((a, b) => a.touchedAt - b.touchedAt)
    for (const entry of idle) {
      if (this.entries.size <= this.maxEntries) break
      this.entries.delete(entry.userId)
      if (entry.pending) this.counters.dropped.evicted++
    }
  }

  // ── Metrics ───────────────────────────────────────────────────────────

  stats() {
    const status = { claiming: 0, unclaimed: 0, claimed: 0, fenced: 0, superseded: 0, disabled: 0, unpersisted: 0 }
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
