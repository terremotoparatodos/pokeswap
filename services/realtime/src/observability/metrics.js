import { monitorEventLoopDelay } from 'node:perf_hooks'

/**
 * Aggregate-only presence counters. Nothing here may hold a user id, username,
 * token, chat text or coordinate: only counts and process health.
 */
export class PresenceMetrics {
  constructor({ loopDelay = null } = {}) {
    this.connections = 0; this.guests = 0; this.players = 0
    this.rejections = { capacity: 0, invalid: 0, rate: 0, area: 0, replay: 0 }
    this.moves = 0; this.areaChanges = 0; this.reconnectRestores = 0
    // Delta batching (50 ms window). Measurement only: see PresenceRoom.sendDelta.
    this.batching = { queued: 0, stepStacked: 0, stepFoldedIntoUpsert: 0, replaced: 0, batches: 0, maxBatch: 0 }
    this.loopDelay = loopDelay
  }
  joined(kind) { this.connections++; if (kind === 'guest') this.guests++; else this.players++ }
  left(kind) { this.connections = Math.max(0, this.connections - 1); if (kind === 'guest') this.guests = Math.max(0, this.guests - 1); else this.players = Math.max(0, this.players - 1) }
  rejected(kind) { this.rejections[kind] = (this.rejections[kind] ?? 0) + 1 }
  moved() { this.moves++ }
  changedArea() { this.areaChanges++ }
  restored() { this.reconnectRestores++ }
  /** `kind`: how a delta met the one already queued for the same actor and socket. */
  deltaQueued(kind) { this.batching.queued++; if (kind) this.batching[kind]++ }
  batchSent(size) { this.batching.batches++; if (size > this.batching.maxBatch) this.batching.maxBatch = size }
  snapshot() {
    const base = { connections: this.connections, guests: this.guests, players: this.players, rejections: { ...this.rejections } }
    return this.loopDelay === null ? base : { ...base, ...this.runtime() }
  }
  runtime() {
    const memory = process.memoryUsage()
    const ms = value => Math.round(value / 1e4) / 100
    const delay = this.loopDelay
    return {
      moves: this.moves, areaChanges: this.areaChanges, reconnectRestores: this.reconnectRestores, batching: { ...this.batching },
      uptimeSeconds: Math.round(process.uptime()),
      memoryMb: { rss: Math.round(memory.rss / 1048576), heapUsed: Math.round(memory.heapUsed / 1048576) },
      eventLoopDelayMs: { p50: ms(delay.percentile(50)), p99: ms(delay.percentile(99)), max: ms(delay.max) },
    }
  }
}

function startLoopDelay() {
  const histogram = monitorEventLoopDelay({ resolution: 20 })
  histogram.enable()
  return histogram
}

export const metrics = new PresenceMetrics({ loopDelay: startLoopDelay() })
