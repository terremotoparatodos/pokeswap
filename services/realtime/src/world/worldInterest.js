import { WORLD_CHUNK_TILES } from './areas.js'

/**
 * Spatial interest for world entities (WORLD-1B), same philosophy as PERF-2.
 *
 * A viewer subscribes to the world chunks around it. Entering a chunk sends
 * the chunk's current non-base state at once; changes inside a subscribed
 * chunk arrive as deltas; leaving it tells the client to drop what it held.
 * Resource nodes do not move, so the subscription only changes when the
 * viewer crosses into a new chunk band — at most once every 16 tiles — not on
 * every step.
 *
 * Radii: the widest view (1920 px at 3×) shows ~20 tiles either side, the same
 * figure presence uses. 24 covers it with room to spare; chunks are kept until
 * 32, so walking back and forth across a chunk edge does not resubscribe
 * (hysteresis, like RETAIN_MARGIN_TILES for actors).
 */
export const WORLD_VIEW_TILES = 24
export const WORLD_RETAIN_TILES = 32

function range(tx, ty, radius) {
  return {
    x0: Math.floor((tx - radius) / WORLD_CHUNK_TILES), x1: Math.floor((tx + radius) / WORLD_CHUNK_TILES),
    y0: Math.floor((ty - radius) / WORLD_CHUNK_TILES), y1: Math.floor((ty + radius) / WORLD_CHUNK_TILES),
  }
}

/** Chunk ids a viewer at (tx, ty) must hold. */
export function chunksInView(tx, ty, radius = WORLD_VIEW_TILES) {
  const { x0, x1, y0, y1 } = range(tx, ty, radius)
  const chunks = []
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) chunks.push(`${cx},${cy}`)
  return chunks
}

/** Whether a held chunk is still close enough to keep. */
export function isChunkRetained(chunkId, tx, ty, radius = WORLD_RETAIN_TILES) {
  const [cx, cy] = chunkId.split(',').map(Number)
  const { x0, x1, y0, y1 } = range(tx, ty, radius)
  return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1
}
