// Randomness, as data (R32.3).
//
// The rules never call `Math.random()`, never read a clock and never hold
// hidden state. Every roll comes from an `RngState` that lives **inside**
// `BattleState`: two numbers, JSON-safe, that a server can hand to a client
// and a replay can start from.
//
// A draw is a pure function `(state) -> { value, state }`. The cursor is the
// only thing that moves, so "how many rolls has this battle consumed" is an
// observable number and a desync is visible instead of mysterious.
//
// Why a counter and not a running generator: a generator's internal state is
// one number too, but it has to be advanced in the same order by whoever
// replays it. A counter is the same guarantee with an audit trail — a battle
// that took 412 draws took 412 draws on both sides.

export interface RngState {
  /** Chosen by whoever starts the battle; the server owns it from R32.4 on. */
  readonly seed: number
  /** How many values this battle has drawn. Starts at zero. */
  readonly cursor: number
}

export interface RngDraw {
  /** In [0, 1). */
  readonly value: number
  readonly rng: RngState
}

export const createRngState = (seed: number): RngState => ({ seed: seed >>> 0, cursor: 0 })

/** Murmur3's finalizer: makes seeds that differ in one bit land far apart. */
function mix32(input: number): number {
  let hash = input >>> 0
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x85ebca6b)
  hash ^= hash >>> 13
  hash = Math.imul(hash, 0xc2b2ae35)
  hash ^= hash >>> 16
  return hash >>> 0
}

/**
 * The value at one position of a seed's stream.
 *
 * Exported because a test wants to assert a roll without running a battle, and
 * because a server verifying a client's claim needs the same answer without
 * replaying anything.
 */
export const rngValueAt = (seed: number, cursor: number): number =>
  mix32(Math.imul(mix32((seed >>> 0) ^ 0x9e3779b9), 0x27d4eb2f) ^ (cursor >>> 0)) / 4294967296

/** The next float in [0, 1), and the state that follows it. */
export const drawRandom = (rng: RngState): RngDraw => ({
  value: rngValueAt(rng.seed, rng.cursor),
  rng: { seed: rng.seed, cursor: rng.cursor + 1 },
})

/** A whole number in [min, max]. Spends exactly one draw, even when min === max. */
export function drawInt(rng: RngState, min: number, max: number): { value: number; rng: RngState } {
  const draw = drawRandom(rng)
  if (max <= min) return { value: min, rng: draw.rng }
  return { value: min + Math.floor(draw.value * (max - min + 1)), rng: draw.rng }
}

/**
 * True with probability `chance`. Spends one draw whatever the chance is, so a
 * certainty and an impossibility cost the same and adding a guard later cannot
 * shift every roll after it.
 */
export function drawChance(rng: RngState, chance: number): { value: boolean; rng: RngState } {
  const draw = drawRandom(rng)
  return { value: draw.value < Math.max(0, Math.min(1, chance)), rng: draw.rng }
}
