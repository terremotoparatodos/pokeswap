// Reach of a gathering action (R31-C1): the player works the node it stands
// orthogonally beside, as WORLD's authority requires (WORK_REACH).
//
// Where the worker Pokémon stands is no longer decided here: the server fixes
// it when the work starts (`worker.stand`, WORLD VISUAL-1) and
// `world/render/workerActors` draws it for its owner and for everyone else.

export interface TilePoint {
  readonly tx: number
  readonly ty: number
}

/** Orthogonally adjacent tiles: the reach of any gathering action. */
export function isBeside(a: TilePoint, b: TilePoint): boolean {
  return Math.abs(a.tx - b.tx) + Math.abs(a.ty - b.ty) === 1
}
