import type { WorkKind } from './resourceLayout.js'

export declare const WORLD_PROTOCOL: 1
export declare const WORLD_MESSAGE: Readonly<{
  WORK: 'world:work'
  CANCEL: 'world:cancel'
  SNAPSHOT: 'world:snapshot'
  BATCH: 'world:batch'
  WORK_RESULT: 'world:work:result'
  WORK_DONE: 'world:work:done'
  WILD: 'world:wild'
}>

export interface WildEntity {
  readonly id: string
  readonly pokemonId: number
  /** Home tile; the entity patrols around it (patrol.js). */
  readonly tx: number
  readonly ty: number
  readonly habitat: 'land' | 'water'
  readonly shiny: boolean
}

export interface WildRoster {
  readonly areaId: string
  readonly epoch: number
  readonly entities: readonly WildEntity[]
}

/** A node's public, non-base state as every viewer receives it. */
export interface PublicNode {
  readonly id: string
  readonly state: string
  readonly version: number
  /** The node is back in its base state; its record no longer exists on the server. */
  readonly base?: true
  readonly actionId?: string
  readonly workKind?: WorkKind
  readonly worker?: { readonly playerId: string; readonly pokemonInstanceId: number; readonly speciesId: number }
  readonly startedAt?: number
  readonly endsAt?: number
  readonly respawnAt?: number
}

export interface WorldSnapshot {
  readonly now: number
  readonly areaId: string
  readonly chunks: readonly string[]
  readonly nodes: readonly PublicNode[]
  readonly wild?: WildRoster
  readonly ownAction?: { readonly actionId: string; readonly nodeId: string; readonly startedAt: number; readonly endsAt: number }
}

export interface WorldBatch {
  readonly now: number
  readonly enter?: readonly { readonly chunk: string; readonly nodes: readonly PublicNode[] }[]
  readonly leave?: readonly string[]
  readonly nodes?: readonly PublicNode[]
}

export type WorkResult =
  | { readonly requestId: number; readonly ok: true; readonly actionId: string; readonly nodeId: string; readonly startedAt: number; readonly endsAt: number }
  | { readonly requestId: number | null; readonly ok: false; readonly reason: string }

export type WorkDone =
  | { readonly actionId: string; readonly ok: true; readonly status: 'applied' | 'duplicate'; readonly summary?: unknown }
  | { readonly actionId: string; readonly ok: false; readonly reason: string }

export declare function workIntent(value: unknown): { nodeId: string; pokemonInstanceId: number; requestId: number } | null
export declare function cancelIntent(value: unknown): { actionId: string } | null
