export interface OwnedPokemon { readonly instanceId: number; readonly speciesId: number }
export interface OwnershipPort { verify(playerId: string, instanceId: number, credentials?: unknown): Promise<OwnedPokemon | null> }
export declare const OWNERSHIP_CACHE_MS: number
export declare function createSupabaseOwnership(env: Record<string, string | undefined>, fetcher?: typeof fetch, now?: () => number): OwnershipPort
export declare function createStaticOwnership(owned: Record<string, readonly number[]>): OwnershipPort
