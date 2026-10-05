import { CONNECTION_LIMIT } from './capacity.js'
import { INVALID_ATTEMPT_CODE, STALE_ATTEMPT_CODE } from '../protocol/closeCodes.js'

// CLOUD JOIN-ORDER-2 — the order of ONE page's connection attempts, within ONE account
// (docs/design/CLOUD_JOIN_ORDER_2_REPORT.md; contract: docs/design/CLOUD_JOIN_ORDER_1_PROPOSAL.md).
//
//   page     the client's per-page-load id (its tabId). Never a credential: it is compared only
//            within the same authenticated account, so forging it can only hurt that account's own
//            joins. It authorizes nothing: not an account, not a takeover, not a resume.
//   attempt  a positive integer the page increments on EVERY join it opens (first entry, automatic
//            reconnection, renewed session, «Jugar acá»). A join never re-sends its number, so a
//            repeated (page, attempt) is a duplicate (a replay), never a retry. A retry of the SAME
//            claim inside the server keeps its session key and is idempotent in the database.
//
// In ONE process (this module): an attempt at or below the highest one this process admitted for
// that (account, page) is refused at admission with 4410 — in the synchronous tail of admission, and
// again right before the room replaces the previous socket. The page's live socket is never closed,
// moved or retried for it. Across processes the database orders the same attempts (claim v3: SQL
// 20261006120000); this memory only knows its own process, so it never proves a global order.
//
// Mode WORLD_JOIN_ORDER: off (today's behaviour: attempts are ignored, nothing is remembered) |
// shadow (remembered and counted, never refuses or closes anything) | on (enforced). Read once, when
// the realtime's modules load: changing it needs a restart. Missing or unknown = off.
//
// Memory (D3): at most WORLD_JOIN_ORDER_MAX_PAGES pages per process (default 10 000, never below the
// room's connection limit). Past it, the least recently admitted page WITHOUT a live socket here is
// forgotten. A page with a live socket is never forgotten: those are bounded by the connection limit,
// so the bound cannot be exceeded by them (if it ever were, the map grows and `overflow` counts it:
// a guarantee is never dropped silently). A forgotten page keeps the database's cross-process order
// (claim v3); only this process's early refusal is lost for it, and `evicted` counts it.

export const JOIN_ORDER_ENV = 'WORLD_JOIN_ORDER'
export const JOIN_ORDER_PAGES_ENV = 'WORLD_JOIN_ORDER_MAX_PAGES'
export const ATTEMPT_MAX = 2 ** 31 - 1
export const DEFAULT_MAX_PAGES = 10_000
const MAX_PAGES_LIMIT = 1_000_000
export { INVALID_ATTEMPT_CODE, STALE_ATTEMPT_CODE }

export const joinOrderMode = env => {
  const value = env?.[JOIN_ORDER_ENV]
  return value === 'on' || value === 'shadow' ? value : 'off'
}

/** WORLD_JOIN_ORDER_MAX_PAGES: an integer in [connection limit, 1 000 000]; anything else is the default. */
export function joinOrderMaxPages(env, { minimum = CONNECTION_LIMIT } = {}) {
  const raw = env?.[JOIN_ORDER_PAGES_ENV]
  if (raw === undefined || raw === '') return DEFAULT_MAX_PAGES
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= minimum && value <= MAX_PAGES_LIMIT ? value : DEFAULT_MAX_PAGES
}

/**
 * The attempt a join declares: null (a client that sends none) or a valid integer in [1, 2^31 − 1].
 * Anything else — present but not a safe integer in range — is invalid (`ok: false`).
 */
export function attemptOf(options) {
  if (!options || options.attempt === undefined) return { ok: true, attempt: null }
  const attempt = options.attempt
  return Number.isSafeInteger(attempt) && attempt >= 1 && attempt <= ATTEMPT_MAX ? { ok: true, attempt } : { ok: false, attempt: null }
}

export class JoinOrder {
  /**
   * `isLive(userId, page)`: the account has a live socket of that page in this process (never forgotten).
   */
  constructor({ mode = 'off', maxPages = DEFAULT_MAX_PAGES, isLive = () => false } = {}) {
    this.mode = mode
    this.maxPages = maxPages
    this.isLive = isLive
    /** `${userId}\n${page}` → { userId, page, highest }. Map order = least recently admitted first. */
    this.pages = new Map()
    this.counters = { admitted: 0, stale: 0, duplicate: 0, invalid: 0, legacy: 0, wouldRefuse: 0, evicted: 0, keptLive: 0, overflow: 0, recheckRefused: 0 }
  }

  get enforcing() { return this.mode === 'on' }
  get observing() { return this.mode !== 'off' }

  /**
   * Admission, synchronously after every await of it: 'admit' | 'stale' | 'duplicate'. Only an admitted
   * attempt raises the page's mark (and makes it the most recent); a refused one changes nothing.
   */
  observe(userId, page, attempt) {
    const key = `${userId}\n${page}`
    const known = this.pages.get(key)
    if (known && attempt <= known.highest) {
      const verdict = attempt === known.highest ? 'duplicate' : 'stale'
      this.counters[verdict]++
      return verdict
    }
    this.pages.delete(key)
    this.pages.set(key, { userId, page, highest: attempt })
    this.counters.admitted++
    this.#bound()
    return 'admit'
  }

  /** Right before the room replaces a socket: is `attempt` still the highest this process admitted for the page? */
  isLatest(userId, page, attempt) {
    return this.pages.get(`${userId}\n${page}`)?.highest === attempt
  }

  /** Forgets the least recently admitted pages without a live socket here until the bound holds. */
  #bound() {
    let budget = this.pages.size
    while (this.pages.size > this.maxPages && budget-- > 0) {
      const [key, entry] = this.pages.entries().next().value
      this.pages.delete(key)
      if (this.isLive(entry.userId, entry.page)) {
        this.pages.set(key, entry) // kept, moved to the most recent end
        this.counters.keptLive++
      } else this.counters.evicted++
    }
    if (this.pages.size > this.maxPages) this.counters.overflow++
  }

  /** Aggregates only (no account, page or attempt). */
  stats() { return { mode: this.mode, pages: this.pages.size, maxPages: this.maxPages, ...this.counters } }
}
