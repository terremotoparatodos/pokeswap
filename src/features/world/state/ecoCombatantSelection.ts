import { WORLD_MESSAGE, type EcoCombatantState } from '../../../../services/realtime/src/world/worldProtocol.js'

export interface EcoCombatantSink {
  message(state: EcoCombatantState): void
  detached(): void
}
interface Host {
  ecoSend(type: string, payload: unknown): boolean
  setEcoCombatantSink(sink: EcoCombatantSink | null): void
}
export interface EcoCombatantView {
  readonly speciesId: number | null
  readonly options: EcoCombatantState['options']
  readonly pending: boolean
  readonly ready: boolean
  readonly reason: string | null
}

/** Display only: never commits a choice until the server confirms it. */
export class EcoCombatantSelection implements EcoCombatantSink {
  private state: EcoCombatantView = { speciesId: null, options: [], pending: false, ready: false, reason: null }
  private readonly listeners = new Set<(view: EcoCombatantView) => void>()
  private requestId = 0
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly host: Host) { host.setEcoCombatantSink(this) }

  get view(): EcoCombatantView { return this.state }

  subscribe(listener: (view: EcoCombatantView) => void): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => this.listeners.delete(listener)
  }

  select(speciesId: number): void {
    if (this.state.pending) return
    const requestId = ++this.requestId
    if (!this.host.ecoSend(WORLD_MESSAGE.ECO_COMBATANT_SELECT, { requestId, speciesId })) { this.detached(); return }
    this.set({ ...this.state, pending: true, ready: false, reason: null })
    this.timer = setTimeout(() => {
      this.timer = null
      this.set({ ...this.state, pending: false, ready: false, reason: 'no-answer' })
    }, 8_000)
  }

  message(message: EcoCombatantState): void {
    if (message.requestId !== null && message.requestId !== this.requestId) return
    this.clearTimer()
    this.set({ speciesId: message.speciesId, options: message.options, pending: false,
      ready: message.speciesId !== null && message.options.some(c => c.speciesId === message.speciesId), reason: message.ok ? null : message.reason ?? 'invalid' })
  }

  detached(): void {
    this.clearTimer()
    this.set({ ...this.state, options: [], pending: false, ready: false, reason: 'offline' })
  }

  dispose(): void {
    this.clearTimer()
    this.host.setEcoCombatantSink(null)
    this.listeners.clear()
  }

  private set(state: EcoCombatantView): void {
    this.state = state
    for (const listener of this.listeners) listener(state)
  }
  private clearTimer(): void { if (this.timer) clearTimeout(this.timer); this.timer = null }
}
