import { DIRECTIONS } from '../protocol/messages.js'

export const TILE_PER_SECOND = 3.75
/** Sustained cap: above the legitimate 7.5 tiles/s run, one move per token. */
export const MOVE_TOKENS_PER_SECOND = 10
/**
 * Burst allowance. A WebSocket stall delivers every move queued behind it at
 * once; the old 10-per-rolling-second window rejected legitimate running input
 * after any stall of ~350 ms, leaving the server permanently one tile behind
 * per rejection. Fifteen tokens absorb a 1.5 s stall at run speed (see
 * `presence.test.js`) while the sustained rate stays bounded at ten tiles/s.
 * Walkability is decided by the client either way: this bounds pace, not
 * collision.
 */
export const MOVE_BURST_CAPACITY = 15
/** @deprecated kept for callers that still read the old constant name. */
export const BURST_LIMIT = MOVE_TOKENS_PER_SECOND

const DELTA = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }

/** Returns `null` when the move is accepted (and applied), else the rejection reason. */
export function applyMove(actor, direction, now, running, sequence = null) {
  if (!DIRECTIONS.has(direction) || typeof running !== 'boolean') return 'invalid'
  const currentSequence = Number.isInteger(actor.moveSequence) ? actor.moveSequence : 0
  if (sequence !== null && sequence <= currentSequence) return 'replay'
  if (!Number.isFinite(actor.moveTokens)) { actor.moveTokens = MOVE_BURST_CAPACITY; actor.moveTokensAt = now }
  const elapsed = Math.max(0, now - actor.moveTokensAt)
  actor.moveTokens = Math.min(MOVE_BURST_CAPACITY, actor.moveTokens + elapsed * MOVE_TOKENS_PER_SECOND / 1000)
  actor.moveTokensAt = now
  if (actor.moveTokens < 1) return 'rate'
  actor.moveTokens -= 1
  const [dx, dy] = DELTA[direction]
  actor.lastMoveAt = now; actor.dir = direction; actor.speed = running ? TILE_PER_SECOND * 2 : TILE_PER_SECOND
  actor.moveSequence = sequence ?? currentSequence + 1
  actor.tx += dx; actor.ty += dy
  return null
}

export function acceptMove(actor, direction, now, running, sequence = null) {
  return applyMove(actor, direction, now, running, sequence) === null ? actor : null
}
