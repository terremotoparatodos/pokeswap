export class PresenceMetrics {
  constructor() { this.connections = 0; this.guests = 0; this.players = 0; this.rejections = { capacity: 0, invalid: 0, rate: 0, area: 0 } }
  joined(kind) { this.connections++; if (kind === 'guest') this.guests++; else this.players++ }
  left(kind) { this.connections = Math.max(0, this.connections - 1); if (kind === 'guest') this.guests = Math.max(0, this.guests - 1); else this.players = Math.max(0, this.players - 1) }
  rejected(kind) { this.rejections[kind] = (this.rejections[kind] ?? 0) + 1 }
  snapshot() { return { connections: this.connections, guests: this.guests, players: this.players, rejections: { ...this.rejections } } }
}
export const metrics = new PresenceMetrics()
