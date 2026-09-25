// Shared world clock (WORLD-1).
//
// Every world message carries the server's time. Two browsers that both read
// "server now" see a node's action, its respawn and every scheduled walker at
// the same moment, whatever their own wall clocks say.
//
// Estimate: offset = serverNow − localNow, taken on receipt. Network delay only
// ever makes a sample *smaller* than the true offset, so the largest sample is
// the best one; a sample far below it (a suspended tab, a clock jump) resets.
// Local time is `performance.now()`, which a player cannot move by changing
// the system clock.

/** A sample this far below the estimate means the estimate is stale. */
const RESET_BELOW_MS = 2_000
/** The estimate relaxes this much per second, so a drifting host clock is followed. */
const RELAX_MS_PER_S = 2

export class WorldClock {
  private offset: number | null = null
  private sampledAt = 0

  constructor(private readonly local: () => number = () => performance.now()) {}

  sample(serverNow: number): void {
    if (!Number.isFinite(serverNow)) return
    const local = this.local()
    const candidate = serverNow - local
    if (this.offset === null || candidate > this.offset) this.offset = candidate
    else {
      const relaxed = this.offset - ((local - this.sampledAt) / 1000) * RELAX_MS_PER_S
      this.offset = candidate < this.offset - RESET_BELOW_MS ? candidate : Math.max(candidate, relaxed)
    }
    this.sampledAt = local
  }

  /** Server time in ms, or null before the first world message. */
  now(): number | null {
    return this.offset === null ? null : this.local() + this.offset
  }

  get synced(): boolean {
    return this.offset !== null
  }

  reset(): void {
    this.offset = null
  }
}
