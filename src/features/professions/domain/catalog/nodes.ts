// Gathering node catalog. Nodes are anchored to decor the procedural world
// already generates, so their positions are derived from the seed instead of
// being stored or synchronised (see domain/nodePlacement.ts).
//
// Pacing target: a full 600-energy bar ≈ 60 tier-1 or 30 tier-3 actions,
// ≈ 15–20 minutes of gathering. Energy, not session time, caps the faucet.

import type { DropEntry, GatheringNodeDefinition } from '../types'

const drop = (itemId: string, chance: number, rare = false, min = 1, max = 1): DropEntry => ({ itemId, chance, min, max, rare })

export const GATHERING_NODES: readonly GatheringNodeDefinition[] = [
  // ── Mining ────────────────────────────────────────────────────────────────
  {
    id: 'stone_outcrop', profession: 'mining', name: 'Afloramiento de piedra', tier: 1,
    requiredLevel: 1, energyCost: 10, baseActionSeconds: 12, xp: 30, minToolTier: 0, requiredAccess: null,
    anchors: ['rock'], biomes: ['grassland', 'forest', 'desert'], minZone: 0, spawnWeight: 6,
    personalCharges: 6, respawnSeconds: 90,
    drops: { primary: drop('stone', 1), secondary: [drop('coal', 0.08), drop('evolution_shard', 0.002, true)] },
  },
  {
    id: 'coal_seam', profession: 'mining', name: 'Veta de carbón', tier: 1,
    requiredLevel: 5, energyCost: 15, baseActionSeconds: 14, xp: 55, minToolTier: 1, requiredAccess: null,
    anchors: ['rock', 'boulder'], biomes: ['grassland', 'forest', 'desert'], minZone: 0, spawnWeight: 4,
    personalCharges: 5, respawnSeconds: 120,
    drops: { primary: drop('coal', 1), secondary: [drop('stone', 0.25)] },
  },
  {
    id: 'iron_vein', profession: 'mining', name: 'Veta de hierro', tier: 2,
    requiredLevel: 15, energyCost: 20, baseActionSeconds: 18, xp: 110, minToolTier: 1, requiredAccess: null,
    anchors: ['boulder', 'icerock'], biomes: ['desert', 'tundra'], minZone: 1, spawnWeight: 4,
    personalCharges: 4, respawnSeconds: 240,
    drops: { primary: drop('iron_ore', 1), secondary: [drop('coal', 0.15), drop('evolution_shard', 0.006, true)] },
  },
  {
    id: 'crystal_cluster', profession: 'mining', name: 'Cúmulo cristalino', tier: 2,
    requiredLevel: 20, energyCost: 25, baseActionSeconds: 18, xp: 150, minToolTier: 1, requiredAccess: 'hardRock',
    anchors: ['crystal'], biomes: ['desert', 'tundra', 'grassland'], minZone: 1, spawnWeight: 1,
    personalCharges: 3, respawnSeconds: 900,
    drops: { primary: drop('stone', 1, false, 1, 2), secondary: [drop('evolution_shard', 0.05, true)] },
  },
  {
    id: 'gold_vein', profession: 'mining', name: 'Veta de oro', tier: 3,
    requiredLevel: 30, energyCost: 30, baseActionSeconds: 22, xp: 200, minToolTier: 2, requiredAccess: null,
    anchors: ['boulder', 'icerock'], biomes: ['desert', 'tundra'], minZone: 2, spawnWeight: 2,
    personalCharges: 3, respawnSeconds: 600,
    drops: { primary: drop('gold_ore', 1), secondary: [drop('iron_ore', 0.1), drop('evolution_shard', 0.015, true)] },
  },

  // ── Woodcutting ───────────────────────────────────────────────────────────
  {
    id: 'common_tree', profession: 'woodcutting', name: 'Árbol común', tier: 1,
    requiredLevel: 1, energyCost: 10, baseActionSeconds: 12, xp: 30, minToolTier: 0, requiredAccess: null,
    anchors: ['tree', 'palm'], biomes: ['grassland', 'beach', 'forest'], minZone: 0, spawnWeight: 6,
    personalCharges: 6, respawnSeconds: 90,
    drops: { primary: drop('common_log', 1), secondary: [drop('resin', 0.05), drop('apricorn', 0.003, true)] },
  },
  {
    id: 'pine_tree', profession: 'woodcutting', name: 'Pino', tier: 1,
    requiredLevel: 8, energyCost: 15, baseActionSeconds: 14, xp: 60, minToolTier: 1, requiredAccess: null,
    anchors: ['pine'], biomes: ['forest'], minZone: 0, spawnWeight: 4,
    personalCharges: 5, respawnSeconds: 120,
    drops: { primary: drop('common_log', 1), secondary: [drop('resin', 0.3)] },
  },
  {
    id: 'hardwood_tree', profession: 'woodcutting', name: 'Árbol de madera dura', tier: 2,
    requiredLevel: 15, energyCost: 20, baseActionSeconds: 18, xp: 110, minToolTier: 1, requiredAccess: null,
    anchors: ['tree'], biomes: ['forest'], minZone: 1, spawnWeight: 3,
    personalCharges: 4, respawnSeconds: 240,
    drops: { primary: drop('hardwood_log', 1), secondary: [drop('resin', 0.1), drop('apricorn', 0.01, true)] },
  },
  {
    id: 'boreal_tree', profession: 'woodcutting', name: 'Pino boreal', tier: 3,
    requiredLevel: 30, energyCost: 30, baseActionSeconds: 22, xp: 200, minToolTier: 2, requiredAccess: null,
    anchors: ['snowpine'], biomes: ['tundra'], minZone: 2, spawnWeight: 3,
    personalCharges: 3, respawnSeconds: 600,
    drops: { primary: drop('boreal_log', 1), secondary: [drop('resin', 0.2), drop('apricorn', 0.02, true)] },
  },

  // ── Fishing ───────────────────────────────────────────────────────────────
  {
    id: 'shore_spot', profession: 'fishing', name: 'Orilla', tier: 1,
    requiredLevel: 1, energyCost: 10, baseActionSeconds: 15, xp: 35, minToolTier: 0, requiredAccess: null,
    anchors: ['shore'], biomes: ['grassland', 'forest', 'beach'], minZone: 0, spawnWeight: 6,
    personalCharges: 6, respawnSeconds: 90,
    drops: { primary: drop('fish', 1), secondary: [drop('seaweed', 0.3), drop('pearl', 0.001, true)] },
  },
  {
    id: 'coastal_spot', profession: 'fishing', name: 'Banco costero', tier: 2,
    requiredLevel: 15, energyCost: 20, baseActionSeconds: 18, xp: 110, minToolTier: 1, requiredAccess: null,
    anchors: ['shore'], biomes: ['beach'], minZone: 1, spawnWeight: 3,
    personalCharges: 4, respawnSeconds: 240,
    drops: {
      primary: drop('quality_fish', 1),
      secondary: [drop('fish', 0.3), drop('seaweed', 0.2), drop('pearl', 0.004, true), drop('heart_scale', 0.004, true)],
    },
  },
  {
    id: 'reef_spot', profession: 'fishing', name: 'Arrecife', tier: 3,
    requiredLevel: 30, energyCost: 30, baseActionSeconds: 22, xp: 200, minToolTier: 2, requiredAccess: 'deepWater',
    anchors: ['coral', 'searock'], biomes: ['ocean', 'deep'], minZone: 1, spawnWeight: 2,
    personalCharges: 3, respawnSeconds: 600,
    drops: {
      primary: drop('quality_fish', 1),
      secondary: [drop('seaweed', 0.3), drop('pearl', 0.012, true), drop('heart_scale', 0.02, true)],
    },
  },

  // ── Alchemy foraging ──────────────────────────────────────────────────────
  {
    id: 'berry_bush', profession: 'alchemy', name: 'Arbusto de bayas', tier: 1,
    requiredLevel: 1, energyCost: 10, baseActionSeconds: 12, xp: 30, minToolTier: 0, requiredAccess: null,
    anchors: ['bush'], biomes: ['grassland', 'forest'], minZone: 0, spawnWeight: 6,
    personalCharges: 6, respawnSeconds: 90,
    drops: { primary: drop('oran_berry', 1), secondary: [drop('medicinal_herb', 0.25)] },
  },
  {
    id: 'herb_patch', profession: 'alchemy', name: 'Parche de hierbas', tier: 1,
    requiredLevel: 5, energyCost: 10, baseActionSeconds: 13, xp: 45, minToolTier: 0, requiredAccess: null,
    anchors: ['tallGrass'], biomes: ['grassland'], minZone: 0, spawnWeight: 4,
    personalCharges: 5, respawnSeconds: 120,
    drops: { primary: drop('medicinal_herb', 1), secondary: [drop('oran_berry', 0.2)] },
  },
  {
    id: 'wild_grove', profession: 'alchemy', name: 'Arboleda silvestre', tier: 2,
    requiredLevel: 15, energyCost: 20, baseActionSeconds: 18, xp: 110, minToolTier: 1, requiredAccess: null,
    anchors: ['bush'], biomes: ['forest'], minZone: 1, spawnWeight: 3,
    personalCharges: 4, respawnSeconds: 240,
    drops: { primary: drop('sitrus_berry', 1), secondary: [drop('leppa_berry', 0.35), drop('revival_herb', 0.006, true)] },
  },
  {
    id: 'frost_bloom', profession: 'alchemy', name: 'Flor de escarcha', tier: 3,
    requiredLevel: 30, energyCost: 30, baseActionSeconds: 22, xp: 200, minToolTier: 2, requiredAccess: 'frozenGround',
    anchors: ['crystal'], biomes: ['tundra'], minZone: 2, spawnWeight: 2,
    personalCharges: 3, respawnSeconds: 600,
    drops: { primary: drop('leppa_berry', 1), secondary: [drop('sitrus_berry', 0.3), drop('revival_herb', 0.03, true)] },
  },
]

export const NODE_BY_ID: ReadonlyMap<string, GatheringNodeDefinition> = new Map(GATHERING_NODES.map(node => [node.id, node]))
