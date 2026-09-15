// Real node positions in Pradera Brisa (WORLDS seed 208), the first world
// with shared R30 presence. Found by scanning outward from the world spawn
// with nodeAt; a test re-derives them so procedural changes cannot drift silently.

export const PRADERA_SEED = 208

/** World spawn of Pradera Brisa (World.findSpawn(['grassland'])). */
export const PRADERA_SPAWN = { tx: -5, ty: -69 } as const

export interface NodeLandmark {
  readonly definitionId: string
  readonly tx: number
  readonly ty: number
}

/** Nearest occurrence of every node type to the spawn. */
export const PRADERA_LANDMARKS: readonly NodeLandmark[] = [
  { definitionId: 'berry_bush', tx: -8, ty: -65 },
  { definitionId: 'common_tree', tx: -6, ty: -64 },
  { definitionId: 'stone_outcrop', tx: -5, ty: -77 },
  { definitionId: 'pine_tree', tx: -13, ty: -60 },
  { definitionId: 'herb_patch', tx: -19, ty: -68 },
  { definitionId: 'coal_seam', tx: -11, ty: -94 },
  { definitionId: 'shore_spot', tx: 27, ty: -98 },
  { definitionId: 'iron_vein', tx: -31, ty: -104 },
  { definitionId: 'coastal_spot', tx: 27, ty: -105 },
  { definitionId: 'crystal_cluster', tx: -44, ty: -105 },
  { definitionId: 'reef_spot', tx: 17, ty: -111 },
  { definitionId: 'wild_grove', tx: 95, ty: -46 },
  { definitionId: 'frost_bloom', tx: -94, ty: -169 },
  { definitionId: 'boreal_tree', tx: -110, ty: -169 },
  { definitionId: 'gold_vein', tx: -112, ty: -156 },
  { definitionId: 'hardwood_tree', tx: 107, ty: -91 },
]
