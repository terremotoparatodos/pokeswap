import { DIRECTIONS } from '../protocol/messages.js'

export const TILE_PER_SECOND = 3.75
export const WALK_INTERVAL_MS = 240
// rAF groups arrivals under load. Ten intents/second remains bounded server-side
// while tolerating the 7.5 tile/s local run cadence and normal frame jitter.
export const RUN_INTERVAL_MS = 100
export const MOVE_MIN_INTERVAL_MS = RUN_INTERVAL_MS
export const BURST_LIMIT = 10

const DELTA = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }

export function acceptMove(actor, direction, now, running, sequence = null) {
  if (!DIRECTIONS.has(direction) || typeof running !== 'boolean') return null
  const currentSequence = Number.isInteger(actor.moveSequence) ? actor.moveSequence : 0
  if (sequence !== null && sequence <= currentSequence) return null
  const interval = running ? RUN_INTERVAL_MS : WALK_INTERVAL_MS
  if (now - actor.lastMoveAt < interval) return null
  actor.moves = actor.moves.filter(at => now - at < 1000)
  if (actor.moves.length >= BURST_LIMIT) return null
  const [dx, dy] = DELTA[direction]
  actor.lastMoveAt = now; actor.moves.push(now); actor.dir = direction; actor.speed = running ? TILE_PER_SECOND * 2 : TILE_PER_SECOND
  actor.moveSequence = sequence ?? currentSequence + 1
  actor.tx += dx; actor.ty += dy
  return actor
}
