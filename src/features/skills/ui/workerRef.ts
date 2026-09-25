/** The PokemonInstance doing the work: the player's own, never a separate "work Pokémon". */
export interface WorkerRef {
  readonly instanceId: string
  readonly speciesId: number
}
