// City Mapping Lab — how many players fit side by side (DEV only).
//
// A visual heuristic, not a simulation: a tile's *clearance* is the side of
// the largest square of walkable tiles that contains it, capped at 4. A
// corridor one tile wide scores 1 everywhere along it, a two-lane street 2,
// and a plaza 4 ("room for a crowd").

import type { CityGrid } from './cityGrid'

export const MAX_CLEARANCE = 4

/** Clearance per tile (row-major); 0 for solid tiles. */
export function clearanceMap(grid: CityGrid): Uint8Array {
  const { width: W, height: H } = grid
  // Largest walkable square whose bottom-right corner is each tile (classic DP).
  const corner = new Uint8Array(W * H)
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      if (grid.solid(tx, ty)) continue
      const up = ty > 0 ? corner[(ty - 1) * W + tx] : 0
      const left = tx > 0 ? corner[ty * W + tx - 1] : 0
      const diag = tx > 0 && ty > 0 ? corner[(ty - 1) * W + tx - 1] : 0
      corner[ty * W + tx] = Math.min(MAX_CLEARANCE, Math.min(up, left, diag) + 1)
    }
  }
  // Spread each square's size over every tile it covers.
  const out = new Uint8Array(W * H)
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      const size = corner[ty * W + tx]
      for (let dy = 0; dy < size; dy++) {
        for (let dx = 0; dx < size; dx++) {
          const i = (ty - dy) * W + (tx - dx)
          if (out[i] < size) out[i] = size
        }
      }
    }
  }
  return out
}
