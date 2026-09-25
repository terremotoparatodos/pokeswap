export type Terrain = 0 | 1 | 2 | 3 | 4 | 5 | 6
export type Biome = 'deep' | 'ocean' | 'beach' | 'desert' | 'grassland' | 'forest' | 'tundra'
export type DecorKind =
  | 'cactus' | 'rock' | 'boulder' | 'drybush' | 'tree' | 'pine' | 'snowpine'
  | 'bush' | 'palm' | 'icerock' | 'searock' | 'coral' | 'shell' | 'crystal'

export declare const T: Readonly<{ DEEP: 0; WATER: 1; SAND: 2; GRASS: 3; DUNE: 4; TALL: 5; SNOW: 6 }>

export declare function hash2(x: number, y: number, seed: number): number
export declare function valueNoise(x: number, y: number, seed: number, period?: number): number
export declare function fbm(x: number, y: number, seed: number, octaves?: number): number
export declare function isSolidDecor(kind: DecorKind | null): boolean
export declare function isWaterTerrain(t: Terrain): boolean
export declare function biomeAt(seed: number, vx: number, vy: number): Biome
export declare function vertexTerrain(seed: number, vx: number, vy: number): Terrain
export declare function tileTerrain(seed: number, tx: number, ty: number): Terrain
export declare function decorAt(seed: number, tx: number, ty: number, corners?: readonly Terrain[]): DecorKind | null
export declare function isSolidTile(seed: number, tx: number, ty: number): boolean
export declare function isWaterTile(seed: number, tx: number, ty: number): boolean
export declare function findSpawn(seed: number, prefer?: readonly Biome[]): { tx: number; ty: number }
