// Types for the browser-side acceptance tests; the service itself is plain JS.
import type { EcoArea, EcoEngageResult, EcoRetireResult } from './worldProtocol.js'
export interface WorldSocket { send(type: string, payload: unknown): void }
export interface WorldViewer { id?: string; areaId: string; tx: number; ty: number }
export declare class WorldRoom {
  constructor(options: {
    skills: unknown
    ownership: unknown
    lookupActor(id: string): WorldViewer | null
    clientForPlayer(id: string): WorldSocket | null
    now?: () => number
    /** Draws new generations' hidden stock (YIELD-2). Tests only; default: server crypto randomness. */
    stockRandom?: () => number
    /** ECO-GAMEPLAY-1: the (development-only) ECO population instead of the hourly roster. */
    ecoExperiment?: boolean
    /** ECO-GAMEPLAY-1 tests only: the ECO population's randomness (default: server crypto randomness). */
    ecoRandom?: () => number
    /** ECO-GAMEPLAY-2 tests only: test-battle overrides (`prepare`, `random`, `newId`). */
    ecoBattles?: Record<string, unknown>
    log?: (message: string) => void
  })
  join(client: WorldSocket, options: unknown, auth: { kind: string; userId?: string; token?: string | null }): void
  leave(client: WorldSocket): void
  snapshot(client: WorldSocket, viewer: WorldViewer): void
  viewerMoved(client: WorldSocket, viewer: WorldViewer): void
  /** `client`: the socket the intent came from (default: the player's). An outdated one gets `client-outdated`. */
  work(actor: WorldViewer, payload: unknown, client?: WorldSocket): Promise<unknown>
  cancel(actor: WorldViewer, payload: unknown, client?: WorldSocket): void
  /** ECO-GAMEPLAY-1 test retirement (development only). `actor`: null for a guest. */
  ecoDevRetire(actor: WorldViewer | null | undefined, payload: unknown, client?: WorldSocket): EcoRetireResult
  /** ECO-GAMEPLAY-2 test battles (development only). `actor`: null for a guest. */
  ecoEngage(actor: WorldViewer | null | undefined, payload: unknown, client?: WorldSocket): EcoEngageResult
  ecoBattleAction(actor: WorldViewer | null | undefined, payload: unknown, client?: WorldSocket): unknown
  ecoFlee(actor: WorldViewer | null | undefined, payload: unknown, client?: WorldSocket): unknown
  /** ECO-GAMEPLAY-2: the reservations (null outside the experiment), for acceptance tests. */
  readonly ecoBattles: { readonly ready: Promise<void>; readonly status: string; readonly active: number; isBusy(encounterId: string): boolean } | null
  /** ECO-GAMEPLAY-1: the ECO population (null outside the experiment), for acceptance tests. */
  readonly eco: { view(areaId: string): EcoArea } | null
  /** Server state, for acceptance tests only. */
  readonly authority: { readonly store: { get(id: string): unknown } }
  tick(now?: number): void
  flush(): void
  stats(): Record<string, unknown>
}
