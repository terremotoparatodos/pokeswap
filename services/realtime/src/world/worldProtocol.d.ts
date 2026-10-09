import type { WorkKind } from './resourceLayout.js'
import type { WorkerStand } from './workPlacement.js'
// ECO-GAMEPLAY-2: types only (the battle core's own wire types); the service never imports the core.
import type { AuthorityEventEnvelope, AuthoritySubmitResult, ClientBattleSnapshot, JoinAck } from '../../../../src/features/battle/authority'

export declare const WORLD_PROTOCOL: 3
/** One attempt of a work action and one swing of the worker (SKILLS PROB-2). */
export declare const WORK_TICK_MS: 600
export declare const ECO_PROTOCOL: 1
/** ECO-GAMEPLAY-2 (provisional): engage range in Chebyshev tiles; the server enforces it. */
export declare const ECO_ENGAGE_RANGE: 6

export declare const WORLD_MESSAGE: Readonly<{
  WORK: 'world:work'
  CANCEL: 'world:cancel'
  ECO_DEV_RETIRE: 'world:eco-dev-retire'
  ECO_ENGAGE: 'world:eco-engage'
  ECO_BATTLE_ACTION: 'world:eco-battle-action'
  ECO_FLEE: 'world:eco-flee'
  SNAPSHOT: 'world:snapshot'
  BATCH: 'world:batch'
  WORK_RESULT: 'world:work:result'
  WORK_DONE: 'world:work:done'
  WORK_YIELD: 'world:work:yield'
  WILD: 'world:wild'
  ECO: 'world:eco'
  ECO_DEV_RETIRE_RESULT: 'world:eco-dev-retire-result'
  ECO_ENGAGE_RESULT: 'world:eco-engage-result'
  ECO_BATTLE: 'world:eco-battle'
  ECO_BATTLE_END: 'world:eco-battle-end'
  ECO_BATTLE_PUBLIC: 'world:eco-battle-public'
  PLAYER_STATE: 'player:state'
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

export type WildStatus = 'loading' | 'ready' | 'unavailable'

/** ECO-GAMEPLAY-1 (experimental): one encounter as every viewer sees it. `id` is opaque; it carries no species or owner meaning. */
export interface EcoEncounter {
  readonly id: string
  readonly groupId: string
  readonly speciesId: number
  readonly tx: number
  readonly ty: number
  /** ECO-GAMEPLAY-2: reserved for someone's test battle (absent from an older server). */
  readonly busy?: boolean
}

/** The whole public population of one area. `not-simulated`: nobody there long enough, or no population in this area. */
export interface EcoArea {
  readonly protocol: 1
  readonly areaId: string
  readonly status: 'active' | 'not-simulated' | 'unavailable'
  readonly encounters: readonly EcoEncounter[]
}

export interface EcoMessage {
  readonly now: number
  readonly eco: EcoArea
}

export interface EcoRetireResult {
  readonly requestId: number | null
  readonly encounterId: string | null
  readonly ok: boolean
  readonly reason?: 'disabled' | 'invalid' | 'not-alive' | 'other-area' | 'not-player' | 'unavailable' | 'client-outdated' | 'busy'
}

export declare function ecoRetireIntent(value: unknown): { requestId: number; encounterId: string } | null

// ── ECO-GAMEPLAY-2 (experimental, development only): test battles against one encounter ──

export declare function ecoEngageIntent(value: unknown): { requestId: number; encounterId: string } | null
export declare function ecoFleeIntent(value: unknown): { battleId: string } | null

export type EcoEngageRefusal =
  | 'invalid' | 'unavailable' | 'battle-unavailable' | 'not-player' | 'not-current-socket' | 'already-battling'
  | 'not-alive' | 'other-area' | 'too-far' | 'busy' | 'client-outdated' | 'disabled'

/** A running test battle as its owner receives it. The player's side is a SYNTHETIC fixture. */
export interface EcoBattleInfo {
  readonly battleId: string
  readonly speciesId: number
  readonly fixture: true
  readonly fixtureLabel: string
  readonly joinAck: JoinAck
  readonly snapshot: ClientBattleSnapshot
  /** Battle time left (it only passes while the owner is connected). */
  readonly expiresInMs: number
}

export interface EcoEngageResult {
  /** null for a resume the server sends after a snapshot. */
  readonly requestId: number | null
  readonly encounterId: string | null
  readonly ok: boolean
  readonly reason?: EcoEngageRefusal
  readonly resumed?: true
  readonly battle?: EcoBattleInfo
}

/** Refusals of an action or a flee BEFORE the core (no snapshot is sent with them). */
export type EcoBattleRefusal = 'not-your-battle' | 'no-battle' | 'client-outdated' | 'disabled'

export interface EcoBattleMessage {
  readonly battleId: string | null
  readonly snapshot?: ClientBattleSnapshot
  readonly events: readonly AuthorityEventEnvelope[]
  readonly result?: AuthoritySubmitResult | { readonly kind: 'rejected'; readonly reason: EcoBattleRefusal | 'NOT_ALLOWED_IN_SANDBOX'; readonly actionId: string | null }
}

export type EcoBattleOutcome = 'victory' | 'defeat' | 'draw' | 'fled' | 'expired' | 'disconnected' | 'left-area' | 'vanished'

export interface EcoBattleEnd {
  readonly battleId: string
  readonly encounterId: string
  readonly outcome: EcoBattleOutcome
  /** True only for the victory that actually retired the individual. */
  readonly retired: boolean
  readonly snapshot: ClientBattleSnapshot
}

/** ECO-BATTLE-SPECTATORS-1: one combatant as a spectator sees it (whitelisted fields only). */
export interface EcoPublicCombatant {
  readonly speciesId: number | null
  readonly level: number | null
  readonly maxHp: number | null
  readonly currentHp: number | null
  readonly majorStatus: string
  readonly confused: boolean
  readonly spe: number | null
  readonly speStage: number
  readonly actionElapsedMs: number
  readonly cooldownMultiplier: number
}

/** The event types a spectator draws, each with only its whitelisted fields. */
export type EcoPublicEvent =
  | { readonly type: 'MOVE_USED'; readonly combatantId: string; readonly moveId: number; readonly targetId: string | null; readonly hits: number }
  | { readonly type: 'MOVE_MISSED'; readonly combatantId: string; readonly moveId: number }
  | { readonly type: 'DAMAGE'; readonly combatantId: string; readonly sourceId: string | null; readonly amount: number; readonly remainingHp: number; readonly critical: boolean; readonly effectiveness: number; readonly hit: number; readonly cause: string }
  | { readonly type: 'HEAL'; readonly combatantId: string; readonly amount: number; readonly remainingHp: number; readonly cause: string }
  | { readonly type: 'STATUS_APPLIED'; readonly combatantId: string; readonly status: string; readonly sourceId: string | null }
  | { readonly type: 'CONFUSION_APPLIED' | 'PROTECT_GAINED' | 'PROTECT_BLOCKED' | 'FAINTED'; readonly combatantId: string }

export interface EcoPublicEventEnvelope {
  readonly sequence: number
  readonly event: EcoPublicEvent
}

/**
 * ECO-BATTLE-SPECTATORS-1 (`world:eco-battle-public`): someone else's test battle in this area.
 * `seq` grows strictly per battle; `ended` marks its last message.
 */
export interface EcoPublicBattle {
  readonly battleId: string
  readonly encounterId: string
  readonly areaId: string
  readonly seq: number
  readonly stage: { readonly owner: { readonly tx: number; readonly ty: number }; readonly wild: { readonly tx: number; readonly ty: number } }
  readonly revision: number
  readonly timeMs: number
  /** False while the owner is disconnected (the battle is paused). */
  readonly connected: boolean
  readonly config: {
    readonly actionBar: { readonly baseSeconds?: number; readonly referenceSpeed?: number; readonly minSeconds?: number; readonly maxSeconds?: number; readonly paralysisMultiplier?: number }
    readonly statStages: { readonly minStage?: number; readonly maxStage?: number; readonly multiplierByStage: Readonly<Record<string, number>> }
  }
  readonly combatants: Readonly<Record<string, EcoPublicCombatant>>
  readonly events?: readonly EcoPublicEventEnvelope[]
  readonly ended?: { readonly outcome: EcoBattleOutcome }
}

export interface WildMessage {
  readonly now: number
  readonly wild: WildRoster | null
  readonly status: WildStatus
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
  readonly worker?: {
    readonly playerId: string
    readonly pokemonInstanceId: number
    readonly speciesId: number
    /** Where the Pokémon stands (the trainer's tile when the work started), fixed by the server. Absent from older servers. */
    readonly stand?: WorkerStand
  }
  /** When the running action started (server clock): the animation phase. Its end is never published (PROB-2). */
  readonly startedAt?: number
  /** When the worker's last unit was confirmed (server clock): a flash, never a count (YIELD-2). */
  readonly yieldAt?: number
  readonly respawnAt?: number
  readonly plot?: PublicPlot
}

export interface WorldSnapshot {
  readonly now: number
  readonly areaId: string
  readonly chunks: readonly string[]
  readonly nodes: readonly PublicNode[]
  readonly wild?: WildRoster
  /** Procedural areas only. Without 'ready' there are no wild Pokémon (fail closed). */
  readonly wildStatus?: WildStatus
  /** ECO-GAMEPLAY-1: only to clients that declared `ecoProtocol`, only from an experimental server. */
  readonly eco?: EcoArea
  readonly ownAction?: { readonly actionId: string; readonly nodeId: string; readonly startedAt: number }
}

export interface WorldBatch {
  readonly now: number
  readonly enter?: readonly { readonly chunk: string; readonly nodes: readonly PublicNode[] }[]
  readonly leave?: readonly string[]
  readonly nodes?: readonly PublicNode[]
}

export type WorkResult =
  | {
      readonly requestId: number; readonly ok: true; readonly actionId: string; readonly nodeId: string; readonly startedAt: number
      readonly farmAction?: 'plant' | 'tend' | 'harvest'
      /** SKILLS' terms for the requester's own UI. */
      readonly details?: { readonly skillId: string; readonly xp: number; readonly reward: { readonly itemId: string; readonly min: number; readonly max: number } | null; readonly aptitude: number }
    }
  | { readonly requestId: number | null; readonly ok: false; readonly reason: string; readonly message?: string }

/** A plot's public crop data. */
export interface PublicPlot {
  readonly cropId: string
  readonly ownerId: string
  readonly plantedAt: number
  readonly growingAt: number
  readonly readyAt: number
  readonly tended: boolean
}

/** The session's own data, sent only to that player. */
export interface PlayerStateMessage {
  readonly playerId: string
  readonly xp: Readonly<Record<string, number>>
  readonly materials: Readonly<Record<string, number>>
  readonly pokemon: readonly { readonly instanceId: number; readonly speciesId: number }[]
}

/** One confirmed unit of the owner's sequence (YIELD-2). No stock, no settlement id, no timing. */
export interface WorkYield {
  readonly actionId: string
  readonly index: number
  readonly summary?: unknown
}

/** Why a sequence ended. */
export type WorkDoneReason = 'depleted' | 'completed' | 'cancelled' | 'moved' | 'disconnected' | 'refused' | 'error' | 'limit'

/** The end of a sequence: `ok` when at least one unit was confirmed. */
export interface WorkDone {
  readonly actionId: string
  readonly ok: boolean
  readonly reason: WorkDoneReason | string
  readonly total: {
    readonly units: number
    readonly xpGained: number
    readonly rewards: readonly { readonly itemId: string; readonly quantity: number }[]
  }
  readonly message?: string
}

export declare function workIntent(value: unknown): { nodeId: string; pokemonInstanceId: number; requestId: number } | null
export declare function cancelIntent(value: unknown): { actionId: string } | null
