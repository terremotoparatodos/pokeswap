import type { Biome } from './terrain.js'
export interface WildCatalogEntry { id: number; type1: string | null; type2: string | null; is_legendary?: boolean | null; base_aura?: number | null }
export declare const WILD_POOL_SIZE: number
export declare const WILD_ROTATE_MS: number
export declare const WILD_CHUNK_TILES: number
export declare const WILD_SPEED: number
export declare const NPC_SPEED: number
export declare const SHINY_ODDS: number
export declare const BIOME_TYPES: Readonly<Record<Biome, readonly string[]>>
export declare function wildEpoch(now: number): number
export declare function seededRandom(seed: number): () => number
export declare function rollWildPool<T extends { id: number; is_legendary?: boolean | null; base_aura?: number | null }>(pokemon: readonly T[], ownedIds: ReadonlySet<number>, random: () => number, size?: number): number[]
export declare function normaliseType(type: string | null): string | null
export declare function fitsBiome(biome: Biome, entry: { type1: string | null; type2: string | null }): boolean
export declare function wildSpawnTiles(seed: number, cx: number, cy: number): { tx: number; ty: number; water: boolean; biome: Biome }[]
