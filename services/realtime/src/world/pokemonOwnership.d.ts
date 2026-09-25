export interface OwnedPokemon { readonly instanceId: number; readonly speciesId: number }
export interface OwnershipPort { verify(playerId: string, instanceId: number): Promise<OwnedPokemon | null> }
export declare const OWNERSHIP_CACHE_MS: number
export declare function ownershipFromPlayerData(playerData: { ownsPokemon(userId: string, instanceId: number): Promise<OwnedPokemon | null> }, now?: () => number): OwnershipPort
export declare const noOwnership: OwnershipPort
export declare function createStaticOwnership(owned: Record<string, readonly number[]>): OwnershipPort
