/**
 * Server-side pacing of `world:work` intents (SKILLS PROB-2): one token bucket
 * per authenticated player, checked before anything else is looked up.
 *
 * Values, and why:
 * - refill 1 token / 500 ms (2 intents/s sustained). The fastest legitimate
 *   loop is a level-50 success on the first 600 ms tick, then a new request:
 *   under 1.7 intents/s even with no walking and no latency. 2/s is above it.
 * - burst 4. Room for what a real player does in a second: a double tap, a
 *   refusal (`busy`, `too-far`) followed by a retry on the next node, the
 *   first request after a reconnect. Four tokens are back in 2 s.
 * - per player, not per socket: reconnecting does not refill the bucket
 *   (a spammer cannot reconnect around it), and an honest reconnect never
 *   needs more than the burst.
 *
 * A refused intent costs O(1): no ownership read, no SKILLS call, nothing
 * held. It can never become a settlement — settlements only follow an
 * authorized, acquired action — and the intents it lets through still meet
 * the request-id dedupe and every other check. Duplicates and races keep
 * their own answers (`duplicate-request`, `in-flight`, `busy`) while tokens
 * remain.
 */
export const WORK_RATE = Object.freeze({ burst: 4, refillMs: 500 })

/** Past this many tracked players, full (idle) buckets are dropped first. */
const MAX_TRACKED = 10_000

export class WorkRateLimiter {
  #buckets = new Map()

  constructor({ burst = WORK_RATE.burst, refillMs = WORK_RATE.refillMs, maxTracked = MAX_TRACKED } = {}) {
    this.burst = burst
    this.refillMs = refillMs
    this.maxTracked = maxTracked
  }

  /** Spends one token of `playerId` at server time `now`. False when the bucket is empty. */
  take(playerId, now) {
    const bucket = this.#buckets.get(playerId) ?? { tokens: this.burst, at: now }
    const tokens = Math.min(this.burst, bucket.tokens + Math.max(0, now - bucket.at) / this.refillMs)
    const allowed = tokens >= 1
    this.#buckets.delete(playerId)
    this.#buckets.set(playerId, { tokens: allowed ? tokens - 1 : tokens, at: now })
    if (this.#buckets.size > this.maxTracked) this.#prune(now)
    return allowed
  }

  get size() {
    return this.#buckets.size
  }

  #prune(now) {
    for (const [id, bucket] of this.#buckets) {
      if (this.#buckets.size <= this.maxTracked) return
      if (bucket.tokens + (now - bucket.at) / this.refillMs >= this.burst) this.#buckets.delete(id)
    }
    // Everyone is mid-burst: drop the least recently seen.
    while (this.#buckets.size > this.maxTracked) this.#buckets.delete(this.#buckets.keys().next().value)
  }
}
