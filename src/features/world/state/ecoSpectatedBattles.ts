// ECO-BATTLE-SPECTATORS-1 (experimental, development builds only): the OTHER players' test battles
// in this area, as the server's public view tells them (`world:eco-battle-public`). Watching is
// passive: nothing is ever sent from here, there are no controls, and the player keeps walking.
//
// The server decides everything; this only keeps the latest accepted view of each battle:
//   - a message at or below the last `seq` taken for its battle (a duplicate, a late one) changes
//     nothing — no bar goes back, no effect repeats, no end is prolonged;
//   - a finished battle is never reopened, whatever arrives for it later;
//   - only a newer revision, or a pause / resume (which keep the revision: paused time is not battle
//     time), restarts the interpolation origin;
//   - an end is shown for ECO_SPECTATOR_END_MS, then the battle is gone;
//   - a world snapshot (arrival, area change, rejoin) or a lost connection drops everything: the
//     server sends what is still running, as it is now, right after the snapshot.

import type { EcoBattleOutcome, EcoPublicBattle, EcoPublicEventEnvelope } from '../../../../services/realtime/src/world/worldProtocol.js'

/** How long a spectator sees how someone else's battle ended (decision P1). */
export const ECO_SPECTATOR_END_MS = 1_500
/** Finished battle ids remembered so a late message never reopens one (bounded). */
const ENDED_MEMORY = 256

export interface SpectatedBattle {
  readonly battleId: string
  readonly encounterId: string
  readonly areaId: string
  /** The latest accepted public view. */
  readonly view: EcoPublicBattle
  /** Local ms: the interpolation origin of `view`. */
  readonly receivedAt: number
  readonly ended: { readonly outcome: EcoBattleOutcome; readonly at: number } | null
}

export interface EcoSpectatorSink {
  message(payload: unknown): void
  /** The socket is gone: nothing seen so far is current any more. */
  detached(): void
  /** A world snapshot arrived (join, area change): the server re-sends what is running here. */
  worldSnapshot(): void
}

export interface EcoSpectatorHost {
  setEcoSpectatorSink(sink: EcoSpectatorSink | null): void
  /** The area of the last world snapshot (null before one). */
  currentAreaId(): string | null
}

interface Entry extends SpectatedBattle {
  readonly lastEvent: number
}

type Schedule = (run: () => void, ms: number) => () => void
const timeout: Schedule = (run, ms) => { const id = setTimeout(run, ms); return () => clearTimeout(id) }

export class EcoSpectatedBattles implements EcoSpectatorSink {
  private readonly battles = new Map<string, Entry>()
  private readonly endedIds: string[] = []
  private readonly removals = new Map<string, () => void>()
  private readonly listeners = new Set<(battles: readonly SpectatedBattle[]) => void>()
  private readonly eventListeners = new Set<(battleId: string, events: readonly EcoPublicEventEnvelope[]) => void>()

  /** `own()`: this player's own battle id, if any — never watched as someone else's. */
  constructor(
    private readonly host: EcoSpectatorHost,
    private readonly now: () => number = () => Date.now(),
    private readonly own: () => string | null = () => null,
    private readonly schedule: Schedule = timeout,
  ) {
    host.setEcoSpectatorSink(this)
  }

  dispose(): void {
    this.clear()
    this.host.setEcoSpectatorSink(null)
    this.listeners.clear()
    this.eventListeners.clear()
  }

  /** The battles watched now (this area only). */
  list(): readonly SpectatedBattle[] {
    return [...this.battles.values()]
  }

  subscribe(listener: (battles: readonly SpectatedBattle[]) => void): () => void {
    this.listeners.add(listener)
    listener(this.list())
    return () => this.listeners.delete(listener)
  }

  /** New drawable events of one watched battle, in order and never twice. */
  onEvents(listener: (battleId: string, events: readonly EcoPublicEventEnvelope[]) => void): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  // ── EcoSpectatorSink ─────────────────────────────────────────────────────

  message(payload: unknown): void {
    const view = publicBattle(payload)
    if (!view || this.endedIds.includes(view.battleId) || view.battleId === this.own()) return
    if (view.areaId !== this.host.currentAreaId()) return
    const previous = this.battles.get(view.battleId)
    if (previous && view.seq <= previous.view.seq) return
    const now = this.now()
    // Revisions never go back on one battle's stream; if one did, its state would not be taken.
    const state = previous && view.revision < previous.view.revision ? { ...previous.view, seq: view.seq, connected: view.connected, ended: view.ended } : view
    const restart = !previous || state.revision > previous.view.revision || state.connected !== previous.view.connected
    const fresh = (view.events ?? []).filter(envelope => envelope.sequence > (previous?.lastEvent ?? -1))
    const ended = view.ended ? { outcome: view.ended.outcome, at: now } : null
    this.battles.set(view.battleId, {
      battleId: view.battleId, encounterId: view.encounterId, areaId: view.areaId, view: state,
      receivedAt: restart ? now : previous?.receivedAt ?? now,
      ended,
      lastEvent: fresh.length ? fresh[fresh.length - 1].sequence : previous?.lastEvent ?? -1,
    })
    if (ended) this.finish(view.battleId)
    this.notify()
    if (fresh.length) for (const listener of this.eventListeners) listener(view.battleId, fresh)
  }

  detached(): void {
    this.clear()
  }

  worldSnapshot(): void {
    this.clear()
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /** Shown for ECO_SPECTATOR_END_MS from its arrival, then removed; its id is never taken again. */
  private finish(battleId: string): void {
    this.endedIds.push(battleId)
    if (this.endedIds.length > ENDED_MEMORY) this.endedIds.shift()
    this.removals.set(battleId, this.schedule(() => {
      this.removals.delete(battleId)
      if (this.battles.delete(battleId)) this.notify()
    }, ECO_SPECTATOR_END_MS))
  }

  private clear(): void {
    for (const cancel of this.removals.values()) cancel()
    this.removals.clear()
    if (this.battles.size === 0) return
    this.battles.clear()
    this.notify()
  }

  private notify(): void {
    const list = this.list()
    for (const listener of this.listeners) listener(list)
  }
}

const isTile = (value: unknown): boolean =>
  !!value && typeof value === 'object' && Number.isFinite((value as { tx?: unknown }).tx) && Number.isFinite((value as { ty?: unknown }).ty)

/** The message, if it has the shape this module reads; anything else is ignored. */
function publicBattle(payload: unknown): EcoPublicBattle | null {
  const p = payload as Partial<EcoPublicBattle> | null
  if (!p || typeof p !== 'object') return null
  if (typeof p.battleId !== 'string' || typeof p.encounterId !== 'string' || typeof p.areaId !== 'string') return null
  if (!Number.isSafeInteger(p.seq) || !Number.isFinite(p.revision) || typeof p.connected !== 'boolean') return null
  if (!p.stage || !isTile(p.stage.owner) || !isTile(p.stage.wild) || !p.combatants || typeof p.combatants !== 'object' || !p.config) return null
  if (p.events !== undefined && !Array.isArray(p.events)) return null
  return p as EcoPublicBattle
}
