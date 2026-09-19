// The caves of an area, as `DungeonSpawn`s.
//
// Placement says *where* (entrancePlacement.ts); the spawn contract says *what*
// and *for how long* (dungeonPrototype/domain/dungeonSpawn.ts). This joins the
// two and is the only place that knows both.
//
// The split is the point, and it is the one §17 of the playtest brief asks for:
// a `DungeonDefinition` is a kind of dungeon and never owns a coordinate; a
// `DungeonSpawn` is one appearance of it, at one place, for one stretch of
// time. Community Playtest 0.1 derives its spawns from the world seed instead
// of receiving them from a server, and that is the one thing here that must
// change before any of it is real.

import { DUNGEON_DEFINITIONS } from '../../dungeonPrototype/data/dungeonCatalog'
import { createSpawn, type DungeonDefinition, type DungeonSpawn } from '../../dungeonPrototype/domain/dungeonSpawn'
import type { Tile } from '../../wildlands/engine/pathfinding'
import { placeEntrances, type EntrancePlacement, type EntranceWorldPort, type PlacementConfig } from './entrancePlacement'

// ── PLAYTEST PARAMETERS ─────────────────────────────────────────────────────
//
// Every number below exists so testers find a cave in one to three minutes
// instead of exploring for half an hour. None of it is balance, and all of it
// is meant to be deleted or dialled back down when real frequency and real
// distribution arrive. Revert = change this one block.

export const COMMUNITY_PLAYTEST_DENSITY: PlacementConfig = {
  /** Three across and two deep: a rock face wide enough to read as a cave. */
  width: 3,
  depth: 2,
  /**
   * Far enough from the arrival pad that walking to a cave never crosses the
   * portal home by accident (the same reason the alchemy bench starts at 4).
   */
  minRing: 6,
  /** Close enough that the minimap shows one before anybody gets bored. */
  maxRing: 26,
  /** PLAYTEST: six around the arrival point. Real distribution will be far sparser. */
  count: 6,
  /** So two caves never read as one bigger rock. */
  minSpacing: 7,
}

/**
 * PLAYTEST: four hours, which outlives a two-hour stream on purpose. The
 * countdown is real and the HUD shows it, so the contract gets exercised; what
 * it must not do is close the dungeons in the middle of the session.
 */
export const COMMUNITY_PLAYTEST_MINUTES = 240

// ── End of playtest parameters ──────────────────────────────────────────────

export interface AreaEntrance {
  readonly spawn: DungeonSpawn
  readonly definition: DungeonDefinition
  readonly placement: EntrancePlacement
}

export interface AreaEntranceInput {
  readonly areaId: string
  readonly origin: Tile
  /** The area's own seed, so the caves are the same for everyone in it. */
  readonly seed: number
  readonly port: EntranceWorldPort
  readonly now: number
  readonly config?: PlacementConfig
  readonly minutes?: number
  readonly definitions?: readonly DungeonDefinition[]
}

/**
 * Which dungeon each cave leads to. Cycled rather than randomised so a player
 * who walks to two different caves meets two different dungeons, which is what
 * we want to watch them do.
 */
const definitionFor = (definitions: readonly DungeonDefinition[], index: number): DungeonDefinition =>
  definitions[index % definitions.length]

export function areaEntrances(input: AreaEntranceInput): AreaEntrance[] {
  const definitions = input.definitions ?? DUNGEON_DEFINITIONS
  if (!definitions.length) return []
  const config = input.config ?? COMMUNITY_PLAYTEST_DENSITY
  const placements = placeEntrances(input.port, input.origin, input.seed, config)
  return placements.map((placement, index) => {
    const definition = definitionFor(definitions, index)
    return {
      placement,
      definition,
      spawn: createSpawn({
        // Stable across re-entries of the area: the id names the place, not the visit.
        spawnId: `${input.areaId}:${placement.anchor.tx}:${placement.anchor.ty}`,
        definition,
        position: { tx: placement.anchor.tx, ty: placement.anchor.ty, areaId: input.areaId },
        now: input.now,
        minutes: input.minutes ?? COMMUNITY_PLAYTEST_MINUTES,
        seed: (input.seed ^ (placement.anchor.tx * 73856093) ^ (placement.anchor.ty * 19349663)) >>> 0,
      }),
    }
  })
}
