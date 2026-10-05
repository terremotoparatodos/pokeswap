import { LocationJournal, persistableIdentity } from './locationJournal.js'
import { savedLocationOf } from './locationPolicy.js'
import { PERSISTABLE_AREAS, layoutVersion } from '../world/layoutVersion.js'

/**
 * WORLD LOCATION-2: the presence room's view of location persistence.
 *
 *   off      (default; also for a missing or unknown value) nothing: today's behaviour
 *   shadow   every player session claims and saves, but nothing is restored from
 *            the database and nothing a player sees changes: would-be restores,
 *            repairs and fences (`wouldFence`) are only counted
 *   on       a session with no live actor and no reconnect memory is restored
 *            from its validated row
 *
 * Without a store that implements locationClaim and locationSave (the demo and
 * unavailable world modes) the effective mode is 'unavailable', which behaves
 * like off. Guests and synthetic ids never persist.
 *
 * WORLD LOCATION-4: sessions persist only through this process's presence host
 * (presence/hostLifecycle.js): each session gets its key from the host when it is
 * accepted. Without a host attached (or while the host cannot persist) sessions
 * play on unpersisted, counted as `claims.noKey`.
 */

export const LOCATION_MODES = Object.freeze(['off', 'shadow', 'on'])
/** How long a join may wait for its claim before it plays on with a safe fallback. */
export const HYDRATION_TIMEOUT_MS = 1_500
/** The close reason of a session displaced by a later epoch (D-L2), with code 4001. */
export const SESSION_REPLACED = 'session-replaced'
export const SESSION_REPLACED_CODE = 4001

export function locationMode(value) {
  return LOCATION_MODES.includes(value) ? value : 'off'
}

const supportsLocation = store => typeof store?.locationClaim === 'function' && typeof store?.locationSave === 'function'

export class LocationService {
  constructor({ mode = 'off', store = null, host = null, now = Date.now, hydrationTimeoutMs = HYDRATION_TIMEOUT_MS, locate = savedLocationOf, onFenced = () => {}, onClaimed = () => {}, log } = {}) {
    this.mode = locationMode(mode)
    this.effective = this.mode === 'off' ? 'off' : supportsLocation(store) ? this.mode : 'unavailable'
    this.now = now
    this.hydrationTimeoutMs = hydrationTimeoutMs
    this.host = host
    this.journal = this.active ? new LocationJournal({ store, host, locate, now, onFenced, onClaimed, ...(log ? { log } : {}) }) : null
    // The layout fingerprints cost ~100-200 ms once (Pradera). Pay it at start,
    // before any player is served, not on the first save of a live session.
    if (this.active) for (const areaId of PERSISTABLE_AREAS) layoutVersion(areaId)
    this.counters = {
      restores: { live: 0, cache: 0, row: 0, noRow: 0, failed: 0, timeout: 0, unknownUser: 0 },
      repairs: { area: 0, layout: 0, tile: 0, protocol: 0 },
      // A claim that answered after the fallback was published: epoch only, position adopted (B3).
      late: { adopted: 0 },
      shadow: { wouldRestore: 0, wouldRepair: { area: 0, layout: 0, tile: 0, protocol: 0 }, wouldFence: 0, wouldReplace: 0, wouldDrain: 0, wouldRetry: 0 },
      // `on`: sessions closed because a greater key owns their row (claim superseded).
      supersededDisconnects: 0,
      fencedDisconnects: 0,
      // CLOUD READINESS-3: sockets closed with 4503 to retry (owner draining/unreachable, stale host).
      retryDisconnects: 0,
      // CLOUD JOIN-ORDER-2: sockets of a join the page already moved past (claim v3): closed quietly with
      // 4410 in `on` (`disconnects`), only counted in shadow (`wouldDisconnect`).
      staleAttempt: { disconnects: 0, wouldDisconnect: 0 },
      hydration: { started: 0, maxMs: 0 },
    }
  }

  get active() { return this.effective === 'shadow' || this.effective === 'on' }
  get restores() { return this.effective === 'on' }

  /** Whether this identity's sessions claim and save. */
  persists(userId) { return this.active && persistableIdentity(userId) }

  /** Synchronous (onJoin): the session's key is assigned here, in acceptance order. */
  begin(userId) { return this.journal.beginSession(userId, this.host?.sessionKey() ?? null) }
  /** The process host, once acquired (realtimeServer.js). Sessions begun before it never persist. */
  attachHost(host) {
    this.host = host
    if (this.journal) this.journal.host = host
  }
  claim(session) { return this.journal.claim(session) }
  note(session, actor, options) { if (session && this.journal) this.journal.note(session, actor, options) }
  end(session, actor) { if (session && this.journal) this.journal.endSession(session, actor) }
  markUnclaimed(session) { this.journal?.markUnclaimed(session) }
  status(session) { return session && this.journal ? this.journal.statusOf(session) : 'off' }

  start() { this.journal?.start() }
  /** Rollback to off at runtime: no claim or save leaves the process afterwards. */
  disable() {
    this.journal?.disable()
    this.effective = 'off'
  }

  /** Best-effort final flush on shutdown; never part of correctness. */
  async shutdown(deadlineMs = 3_000) {
    if (!this.journal) return { sent: 0, applied: 0, duplicate: 0, stale: 0, hostRefused: 0, left: 0, timedOut: false }
    this.journal.stop()
    return this.journal.flushAll(deadlineMs)
  }

  restored(kind) { this.counters.restores[kind]++ }
  repaired(kind) { if (kind) this.counters.repairs[kind]++ }
  shadowed(result) {
    if (!result) return
    this.counters.shadow.wouldRestore++
    if (result.repair) this.counters.shadow.wouldRepair[result.repair]++
  }
  hydrated(ms) { if (ms > this.counters.hydration.maxMs) this.counters.hydration.maxMs = Math.round(ms) }

  /** For /metrics only (never /version): aggregate counts, no ids, areas or tiles. */
  stats() {
    const c = this.counters
    return {
      mode: this.mode, effective: this.effective,
      restores: { ...c.restores }, repairs: { ...c.repairs }, late: { ...c.late },
      shadow: { wouldRestore: c.shadow.wouldRestore, wouldRepair: { ...c.shadow.wouldRepair }, wouldFence: c.shadow.wouldFence, wouldReplace: c.shadow.wouldReplace, wouldDrain: c.shadow.wouldDrain, wouldRetry: c.shadow.wouldRetry },
      fencedDisconnects: c.fencedDisconnects, supersededDisconnects: c.supersededDisconnects, retryDisconnects: c.retryDisconnects, staleAttempt: { ...c.staleAttempt }, hydration: { ...c.hydration },
      ...(this.host ? { host: this.host.stats() } : {}),
      ...(this.journal ? { journal: this.journal.stats() } : {}),
    }
  }
}
