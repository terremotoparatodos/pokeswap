// Where the alchemy bench stands (R31-C4).
//
// Alchemy has no world node to attach to, so the bench needs a place of its
// own. It is NOT stored anywhere: like every node in R31-A it is *derived* —
// the first clearing found by spiralling out from a world anchor, skipping
// water, solid props and tiles that already host a gathering node. The same
// seed puts the bench on the same tile for everyone, which is what a future
// server would need to validate it.

export interface StationWorldPort {
  isSolid(tx: number, ty: number): boolean
  isWater(tx: number, ty: number): boolean
  /** True when a gathering node already owns the tile. */
  hasNode(tx: number, ty: number): boolean
}

export interface StationTile {
  readonly tx: number
  readonly ty: number
}

/**
 * The anchor is a world spawn, and a world spawn is also the gate back to the
 * town: standing on it travels. The bench therefore starts its search a few
 * tiles out, far enough that walking to it never crosses the gate.
 */
const MIN_RING = 4
const MAX_RING = 14

/** A tile is good enough for a bench when it and all four neighbours are clear. */
function clearing(port: StationWorldPort, tx: number, ty: number): boolean {
  if (port.isSolid(tx, ty) || port.isWater(tx, ty) || port.hasNode(tx, ty)) return false
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    if (port.isSolid(tx + dx, ty + dy) || port.isWater(tx + dx, ty + dy) || port.hasNode(tx + dx, ty + dy)) return false
  }
  return true
}

/**
 * First clearing at or around `anchor`, searched ring by ring so the result is
 * stable and close to where the player arrives. Null when the area is too
 * crowded, and then the bench simply does not appear.
 */
export function alchemyStationTile(port: StationWorldPort, anchor: StationTile): StationTile | null {
  for (let ring = MIN_RING; ring <= MAX_RING; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue
        const tx = anchor.tx + dx
        const ty = anchor.ty + dy
        if (clearing(port, tx, ty)) return { tx, ty }
      }
    }
  }
  return null
}

/** Orthogonal neighbours of the bench: where the player and the Pokémon stand. */
export function besideStation(tile: StationTile): readonly StationTile[] {
  return [
    { tx: tile.tx, ty: tile.ty + 1 },
    { tx: tile.tx - 1, ty: tile.ty },
    { tx: tile.tx + 1, ty: tile.ty },
    { tx: tile.tx, ty: tile.ty - 1 },
  ]
}
