/**
 * Aggregate, non-identifying counters about this client's presence traffic.
 *
 * They exist so a playtest report can say *which* mechanism moved a player:
 * a normal reconciliation, a safe-spawn repair, a server rejection or a
 * reconnect. Nothing here holds ids, names, tokens, chat or coordinates.
 */
export interface PresenceDiagnosticsSnapshot {
  sent: number
  lastSent: number
  lastAcked: number
  /** Move send → matching `presence:self` ack, over the last samples. */
  rttMs: { p50: number; p95: number; p99: number; max: number; samples: number }
  /** Authority moved the local player to a different tile. */
  reconciliations: number
  /** Authority pointed at collision or an unreachable tile; the client repaired both sides. */
  solidRecoveries: number
  /** Area requests (portal, "Ciudad", repair) sent to the service. */
  placements: number
  /** Acks dropped because they predate a pending placement. */
  staleAcksIgnored: number
  rejections: { rate: number; replay: number; other: number }
  disconnects: number
}

const RTT_WINDOW = 128
const PENDING_LIMIT = 64

export class PresenceDiagnostics {
  private sent = 0
  private lastSent = 0
  private lastAcked = 0
  private reconciliations = 0
  private solidRecoveries = 0
  private placements = 0
  private staleAcksIgnored = 0
  private disconnects = 0
  private readonly rejections = { rate: 0, replay: 0, other: 0 }
  private readonly sentAt = new Map<number, number>()
  private readonly rtts: number[] = []
  private rttIndex = 0

  moveSent(sequence: number, now: number): void {
    this.sent++
    this.lastSent = sequence
    this.sentAt.set(sequence, now)
    // Bounded: a sequence whose ack never comes (disconnect) must not accumulate.
    if (this.sentAt.size > PENDING_LIMIT) this.sentAt.delete(this.sentAt.keys().next().value!)
  }

  ackReceived(sequence: number, now: number): void {
    if (sequence > this.lastAcked) this.lastAcked = sequence
    const at = this.sentAt.get(sequence)
    if (at === undefined) return
    for (const pending of this.sentAt.keys()) {
      if (pending > sequence) break
      this.sentAt.delete(pending)
    }
    const rtt = Math.max(0, now - at)
    if (this.rtts.length < RTT_WINDOW) this.rtts.push(rtt)
    else this.rtts[this.rttIndex] = rtt
    this.rttIndex = (this.rttIndex + 1) % RTT_WINDOW
  }

  reconciled(): void { this.reconciliations++ }
  recoveredFromSolid(): void { this.solidRecoveries++ }
  placementRequested(): void { this.placements++ }
  staleAckIgnored(): void { this.staleAcksIgnored++ }
  disconnected(): void {
    this.disconnects++
    this.sentAt.clear()
  }

  rejected(reason: string): void {
    if (reason === 'movement rate denied') this.rejections.rate++
    else if (reason === 'movement replay denied') this.rejections.replay++
    else this.rejections.other++
  }

  snapshot(): PresenceDiagnosticsSnapshot {
    const sorted = [...this.rtts].sort((a, b) => a - b)
    const at = (fraction: number) => sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]
    const round = (value: number) => Math.round(value * 10) / 10
    return {
      sent: this.sent, lastSent: this.lastSent, lastAcked: this.lastAcked,
      rttMs: { p50: round(at(0.5)), p95: round(at(0.95)), p99: round(at(0.99)), max: round(sorted[sorted.length - 1] ?? 0), samples: sorted.length },
      reconciliations: this.reconciliations, solidRecoveries: this.solidRecoveries, placements: this.placements,
      staleAcksIgnored: this.staleAcksIgnored, rejections: { ...this.rejections }, disconnects: this.disconnects,
    }
  }
}
