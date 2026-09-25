// Gatherable resources: the Talar and Minería ladders, 1–50.
//
// A resource is a *kind* of thing in the world (a pine, an iron vein). Which
// ones exist, where, whether one is depleted and when it comes back belong to
// WORLD. Skills answers: who may work it, how long it takes, what it gives.
//
// Ids are the art ids the scene already draws, so WORLD, the art and Skills
// all name a pine `pine_tree`.
//
// `world` is ADVISORY design data for WORLD (where it should appear, how
// many actions a node should last). Skills never reads it to decide anything;
// the WORLD × SKILLS mapping (src/features/worldSkills/resourceMapping.ts)
// uses it to say which resource each physical node is.

import type { Aptitude } from './aptitude/aptitudeScale'
import type { MaterialId } from './materials'
import type { SkillId } from './skills'

export type GatherSkillId = Extract<SkillId, 'woodcutting' | 'mining'>

export type ResourceId =
  | 'common_tree' | 'pine_tree' | 'hardwood_tree' | 'boreal_tree'
  | 'stone_outcrop' | 'coal_seam' | 'iron_vein' | 'gold_vein' | 'crystal_cluster'

/** Where a resource belongs. Biomes are the WildLands biomes; `cave` is a dungeon. */
export type Habitat = 'grassland' | 'forest' | 'desert' | 'tundra' | 'beach' | 'cave'

/** The decor a node is drawn on. */
export type ResourceAnchor = 'tree' | 'palm' | 'pine' | 'snowpine' | 'rock' | 'boulder' | 'icerock' | 'crystal'

/** "Muy básico → especializado": the words the design uses for the ladder. */
export type ResourceTier = 'muy básico' | 'básico' | 'intermedio' | 'avanzado' | 'especializado'

export interface ResourceWorldHints {
  readonly habitats: readonly Habitat[]
  /** Distance ring from an area's entrance: 0 = right outside, 2 = far. */
  readonly minRing: 0 | 1 | 2
  readonly anchors: readonly ResourceAnchor[]
  /** Relative frequency among resources that share an anchor and habitat. */
  readonly spawnWeight: number
  /** Completed actions before the node is depleted, as [min, max]. */
  readonly charges: readonly [number, number]
  readonly respawnSeconds: number
}

export interface ResourceDefinition {
  readonly id: ResourceId
  readonly skill: GatherSkillId
  readonly name: string
  readonly tier: ResourceTier
  readonly requiredLevel: number
  /** Minimum worker aptitude. 1 everywhere except the top of each ladder. */
  readonly minAptitude: Aptitude
  readonly xp: number
  /** Duration for an aptitude-3 worker with no Ritmo. */
  readonly baseDurationMs: number
  readonly drop: { readonly itemId: MaterialId; readonly min: number; readonly max: number }
  readonly world: ResourceWorldHints
}

export const RESOURCES: readonly ResourceDefinition[] = [
  // ── Talar ────────────────────────────────────────────────────────────────
  {
    id: 'common_tree', skill: 'woodcutting', name: 'Árbol común', tier: 'muy básico',
    requiredLevel: 1, minAptitude: 1, xp: 10, baseDurationMs: 3000,
    drop: { itemId: 'common_log', min: 1, max: 1 },
    world: { habitats: ['grassland', 'forest', 'beach'], minRing: 0, anchors: ['tree', 'palm'], spawnWeight: 6, charges: [3, 5], respawnSeconds: 30 },
  },
  {
    id: 'pine_tree', skill: 'woodcutting', name: 'Pino', tier: 'básico',
    requiredLevel: 12, minAptitude: 1, xp: 22, baseDurationMs: 3600,
    drop: { itemId: 'pine_log', min: 1, max: 1 },
    world: { habitats: ['forest', 'tundra'], minRing: 0, anchors: ['pine'], spawnWeight: 5, charges: [4, 6], respawnSeconds: 45 },
  },
  {
    id: 'hardwood_tree', skill: 'woodcutting', name: 'Árbol de madera dura', tier: 'intermedio',
    requiredLevel: 25, minAptitude: 1, xp: 40, baseDurationMs: 4400,
    drop: { itemId: 'hardwood_log', min: 1, max: 1 },
    world: { habitats: ['forest'], minRing: 1, anchors: ['tree'], spawnWeight: 3, charges: [4, 6], respawnSeconds: 75 },
  },
  {
    id: 'boreal_tree', skill: 'woodcutting', name: 'Pino boreal', tier: 'avanzado',
    requiredLevel: 40, minAptitude: 2, xp: 68, baseDurationMs: 5200,
    drop: { itemId: 'boreal_log', min: 1, max: 1 },
    world: { habitats: ['tundra'], minRing: 2, anchors: ['snowpine'], spawnWeight: 3, charges: [5, 7], respawnSeconds: 120 },
  },

  // ── Minería ──────────────────────────────────────────────────────────────
  {
    id: 'stone_outcrop', skill: 'mining', name: 'Roca', tier: 'muy básico',
    requiredLevel: 1, minAptitude: 1, xp: 10, baseDurationMs: 3200,
    drop: { itemId: 'stone', min: 1, max: 1 },
    world: { habitats: ['grassland', 'forest', 'desert', 'beach'], minRing: 0, anchors: ['rock'], spawnWeight: 6, charges: [3, 5], respawnSeconds: 30 },
  },
  {
    id: 'coal_seam', skill: 'mining', name: 'Veta de carbón', tier: 'básico',
    requiredLevel: 10, minAptitude: 1, xp: 18, baseDurationMs: 3800,
    drop: { itemId: 'coal', min: 1, max: 1 },
    world: { habitats: ['forest', 'desert', 'grassland'], minRing: 1, anchors: ['rock', 'boulder'], spawnWeight: 4, charges: [3, 5], respawnSeconds: 45 },
  },
  {
    id: 'iron_vein', skill: 'mining', name: 'Veta de hierro', tier: 'intermedio',
    requiredLevel: 20, minAptitude: 1, xp: 30, baseDurationMs: 4400,
    drop: { itemId: 'iron_ore', min: 1, max: 1 },
    world: { habitats: ['desert', 'tundra', 'cave'], minRing: 1, anchors: ['boulder', 'icerock'], spawnWeight: 4, charges: [3, 5], respawnSeconds: 75 },
  },
  {
    id: 'gold_vein', skill: 'mining', name: 'Veta de oro', tier: 'avanzado',
    requiredLevel: 35, minAptitude: 1, xp: 50, baseDurationMs: 5200,
    drop: { itemId: 'gold_ore', min: 1, max: 1 },
    world: { habitats: ['desert', 'tundra', 'cave'], minRing: 2, anchors: ['boulder', 'icerock'], spawnWeight: 2, charges: [2, 4], respawnSeconds: 150 },
  },
  {
    id: 'crystal_cluster', skill: 'mining', name: 'Cúmulo cristalino', tier: 'especializado',
    requiredLevel: 45, minAptitude: 2, xp: 75, baseDurationMs: 6000,
    drop: { itemId: 'crystal', min: 1, max: 1 },
    world: { habitats: ['cave', 'tundra'], minRing: 2, anchors: ['crystal'], spawnWeight: 1, charges: [2, 3], respawnSeconds: 300 },
  },
]

export const RESOURCE_BY_ID: ReadonlyMap<string, ResourceDefinition> = new Map(RESOURCES.map(entry => [entry.id, entry]))

export const resourcesOf = (skill: GatherSkillId): readonly ResourceDefinition[] =>
  RESOURCES.filter(entry => entry.skill === skill)
