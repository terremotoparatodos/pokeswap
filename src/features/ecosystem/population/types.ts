// Shapes of the encounter population engine (ECO-2A).
//
// Pure domain: no Vue, Colyseus, Supabase, Node, sockets, session, clock or
// RNG of its own. Three kinds of data, kept apart on purpose:
//
//   TRUSTED INPUT   PopulationConfig, PopulationTickInput, RetireInput — built by
//                   the future server authority (never by a client).
//   PRIVATE STATE   PopulationState — due times, generations, rarity, the
//                   chosen entry. Never sent to a client as is.
//   PUBLISHABLE     PublicEncounter (`projection.ts`) — what a viewer may see.
//
// Nothing here fights, captures, rewards or persists. "Defeated" and
// "captured" are simulated retire causes: they authorise nothing.

import type { EncounterCatalog, EncounterHabitat, EncounterRarity } from '../encounters/types'

export interface Tile {
  readonly tx: number
  readonly ty: number
}

/**
 * When a nest gets its next spawn opportunity.
 *  - 'per-group':  only once every member of its current group is gone, after
 *                  `delayMs`. Readable "nest cleared → it comes back" cycles.
 *  - 'per-member': after `delayMs` from the first retirement since the last
 *                  spawn, the nest tops itself up to `maxAlive` with a new
 *                  group sized to the gap. Denser, partial groups.
 */
export type RespawnPolicy = 'per-group' | 'per-member'

export interface RespawnConfig {
  readonly policy: RespawnPolicy
  readonly delayMs: number
  /** ±fraction applied to `delayMs` with a trusted random roll; 0…0.5. */
  readonly jitter: number
  /** After a failed attempt (no room, no tile, empty tier…), wait this long. > 0. */
  readonly retryMs: number
}

export interface NestConfig {
  /** Unique within its area; no ':' (it is part of encounter ids). */
  readonly id: string
  /** A zone of the ECO-1 catalog whose `areaId` is this nest's area. */
  readonly zoneId: string
  /** Catalog habitats this nest hosts; an entry of another habitat never spawns here. */
  readonly habitats: readonly EncounterHabitat[]
  /** Candidate tiles, authored by the integration. The engine never invents others. */
  readonly tiles: readonly Tile[]
  /** Most encounters this nest may hold at once. */
  readonly maxAlive: number
  /** Largest group this nest may host; entries whose `group.min` exceeds the room are skipped. */
  readonly groupCap: number
  readonly respawn: RespawnConfig
  /**
   * ECO-CAPACITY-1: the population zone of its area this nest counts against
   * (`AreaConfig.zones`). Optional: a nest without one counts only against
   * its own limit and the area's. Not the catalog `zoneId` (the species pool).
   */
  readonly populationZoneId?: string
}

/**
 * ECO-CAPACITY-1: a subdivision of an area's population (e.g. Pradera abierta
 * and bosque inside the presence area `pradera`). It is NOT a world area: no
 * presence, interest or protocol boundary. `maxAlive` is a MAXIMUM, never a
 * reservation: it caps this zone; it does not keep room free for the others.
 */
export interface PopulationZoneConfig {
  /** Unique within its area; no ':'. */
  readonly id: string
  /** Most encounters alive in this zone at once; omitted = no zone limit (the area's still applies). */
  readonly maxAlive?: number
}

export interface IdleConfig {
  /** Inactive this long → the area goes dormant: its encounters are cleared, nothing is simulated. */
  readonly dormantAfterMs: number
  /** On (re)activation, overdue nests are spread over [min, max] ms instead of all spawning at once. */
  readonly staggerMinMs: number
  readonly staggerMaxMs: number
}

export interface AreaConfig {
  /** Existing presence area id; no ':'. */
  readonly areaId: string
  /** Most encounters alive in the whole area. */
  readonly maxAlive: number
  readonly idle: IdleConfig
  readonly nests: readonly NestConfig[]
  /** ECO-CAPACITY-1: optional population zones. Absent or empty = the engine behaves exactly as before. */
  readonly zones?: readonly PopulationZoneConfig[]
}

export interface PopulationConfig {
  /**
   * Given by the future authority (e.g. a persisted population epoch). Encounter
   * ids are unique only within one namespace: a restart that loses the nest
   * generations MUST come back with a new namespace.
   */
  readonly namespace: string
  readonly areas: readonly AreaConfig[]
}

export type RetireCause = 'defeated' | 'captured' | 'fled'

export interface PopulationEncounter {
  /** `<namespace>:<areaId>:<nestId>:<generation>:<member>` — never reused within a namespace. */
  readonly id: string
  /** `<namespace>:<areaId>:<nestId>:<generation>` — the spawn group it appeared with. */
  readonly groupId: string
  readonly areaId: string
  readonly nestId: string
  /** The nest's population generation this encounter was born in. */
  readonly generation: number
  readonly member: number
  readonly groupSize: number
  readonly entryId: string
  readonly speciesId: number
  /** Evolutionary family. Not the spawn group. */
  readonly familyId: number
  readonly rarity: EncounterRarity
  readonly tile: Tile
  readonly spawnedAt: number
}

export interface NestState {
  /** Last generation spawned; 0 = never. Only grows. */
  readonly generation: number
  readonly alive: readonly PopulationEncounter[]
  /** Server time of the next spawn opportunity, or null when nothing is scheduled. */
  readonly dueAt: number | null
}

/** 'dormant' = not simulated (cleared, or never started). Distinct from an active area whose nests are all empty. */
export type AreaStatus = 'active' | 'idle' | 'dormant'

export interface AreaState {
  readonly status: AreaStatus
  /** When the current status began (null before the first tick). */
  readonly since: number | null
}

export interface PopulationState {
  readonly namespace: string
  /** Latest accepted tick or living-encounter retirement. Historical field name retained for compatibility. */
  readonly lastTickAt: number | null
  readonly areas: Readonly<Record<string, AreaState>>
  /** Keyed `${areaId}/${nestId}`. */
  readonly nests: Readonly<Record<string, NestState>>
}

/** Pure geometry contract, per area, from the integration. Must fold in walls, portals, obstacles and anything else external. */
export interface AreaGeometry {
  isOpenTile(tx: number, ty: number): boolean
}

/** A trusted source of numbers in [0, 1) — a server CSPRNG, or a seeded generator in tests. */
export type RandomSource = () => number

export interface PopulationTickInput {
  readonly now: number
  /** Areas with players right now, decided by the server's presence. */
  readonly activeAreas: ReadonlySet<string>
  readonly geometry: (areaId: string) => AreaGeometry | null
  readonly random: RandomSource
}

export interface RetireInput {
  readonly encounterId: string
  readonly cause: RetireCause
  readonly now: number
  readonly random: RandomSource
}

/**
 * Why a spawn attempt made nothing. Grouped by `spawnFailureCategory`:
 *   nest-full · zone-full · area-full      capacity limits (ECO-CAPACITY-1 adds zone-full)
 *   no-room-for-group                      capacity: the rolled tier has candidates, but every one needs a
 *                                          group larger than the room left (never reported as empty-tier)
 *   no-open-tile · no-geometry             geometry
 *   empty-tier · invalid-distribution · unknown-zone   pool / distribution
 */
export type SpawnFailure =
  | 'area-full' | 'zone-full' | 'nest-full' | 'no-room-for-group' | 'no-open-tile' | 'no-geometry'
  | 'empty-tier' | 'invalid-distribution' | 'unknown-zone'

export type PopulationEvent =
  | { readonly type: 'spawned'; readonly areaId: string; readonly nestId: string; readonly encounters: readonly PopulationEncounter[] }
  | {
    readonly type: 'spawn-failed'; readonly areaId: string; readonly nestId: string; readonly reason: SpawnFailure; readonly retryAt: number
    /** For no-room-for-group: which limit left the smallest room (ties: nest, zone, area, tiles, groupCap). */
    readonly limitedBy?: 'nest' | 'zone' | 'area' | 'tiles' | 'groupCap'
  }
  | { readonly type: 'area-status'; readonly areaId: string; readonly from: AreaStatus; readonly to: AreaStatus; readonly cleared: readonly string[] }

export type TickResult =
  | { readonly ok: true; readonly state: PopulationState; readonly events: readonly PopulationEvent[] }
  | { readonly ok: false; readonly reason: 'clock-regressed' | 'namespace-mismatch'; readonly state: PopulationState }

export type RetireResult =
  | { readonly ok: true; readonly state: PopulationState; readonly retired: PopulationEncounter; readonly cause: RetireCause; readonly dueAt: number | null }
  | { readonly ok: false; readonly reason: 'not-alive' | 'clock-regressed' | 'namespace-mismatch'; readonly state: PopulationState }

export interface PopulationDeps {
  readonly catalog: EncounterCatalog
}
