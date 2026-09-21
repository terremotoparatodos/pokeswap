import { DIRECTIONS } from '../protocol/messages.js'

export const TILE_PER_SECOND = 3.75
export const BURST_LIMIT = 10

const DELTA = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }

export function acceptMove(actor, direction, now, running, sequence = null) {
  if (!DIRECTIONS.has(direction) || typeof running !== 'boolean') return null
  const currentSequence = Number.isInteger(actor.moveSequence) ? actor.moveSequence : 0
  if (sequence !== null && sequence <= currentSequence) return null
  // WebSocket packets sent one tile apart can arrive together after network
  // jitter. Rejecting the second packet by wall-clock spacing makes the
  // authoritative actor fall one tile behind the client; after a turn, that
  // offset can reconcile the player into a building. The rolling burst limit
  // still caps movement above the legitimate 7.5 tiles/s run speed, while the
  // strictly increasing sequence rejects replayed input.
  actor.moves = actor.moves.filter(at => now - at < 1000)
  if (actor.moves.length >= BURST_LIMIT) return null
  const [dx, dy] = DELTA[direction]
  actor.lastMoveAt = now; actor.moves.push(now); actor.dir = direction; actor.speed = running ? TILE_PER_SECOND * 2 : TILE_PER_SECOND
  actor.moveSequence = sequence ?? currentSequence + 1
  actor.tx += dx; actor.ty += dy
  return actor
}
