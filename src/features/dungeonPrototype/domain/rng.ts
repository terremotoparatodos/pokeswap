// Deterministic randomness for the dungeon prototype (D0).
//
// Every random decision in this prototype comes from here, never from
// `Math.random`. A run is reproducible from one seed, and each concern draws
// from its own derived stream so that, say, rolling a capture does not shift
// the numbers a later loot roll would have produced.
//
// CLIENT INTENT / SERVER AUTHORITY: the seed and every draw that changes
// persistent value (drops, keys, capture, boss loot) must eventually be owned
// by the server. This module is the shape that contract should take, not the
// authority itself.

export interface Rng {
  /** Next float in [0, 1). */
  next(): number
  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number
  /** True with probability `chance` (clamped to [0, 1]). */
  chance(chance: number): boolean
  /** One element, or `undefined` for an empty list. */
  pick<T>(items: readonly T[]): T | undefined
  /** A copy of `items` in a shuffled order; the input is not touched. */
  shuffle<T>(items: readonly T[]): T[]
}

/** FNV-1a over the string form of each part: order matters, values do not collide cheaply. */
export function deriveSeed(seed: number, ...parts: (string | number)[]): number {
  let hash = 0x811c9dc5 ^ (seed >>> 0)
  for (const part of parts) {
    const text = String(part)
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i) & 0xff
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
    // A separator keeps ('ab', 'c') distinct from ('a', 'bc').
    hash ^= 0x1f
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** mulberry32: small, fast, good enough for gameplay, and trivially portable to a server. */
export function createRng(seed: number): Rng {
  let state = (seed >>> 0) || 0x9e3779b9
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (min: number, max: number): number => {
    if (max <= min) return min
    return min + Math.floor(next() * (max - min + 1))
  }
  return {
    next,
    int,
    chance: (probability: number) => next() < Math.max(0, Math.min(1, probability)),
    pick: <T>(items: readonly T[]) => (items.length ? items[int(0, items.length - 1)] : undefined),
    shuffle<T>(items: readonly T[]): T[] {
      const out = [...items]
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(0, i)
        ;[out[i], out[j]] = [out[j], out[i]]
      }
      return out
    },
  }
}

/** A stream for one concern of one run: `streamFor(seed, 'floor', 3, 'encounters')`. */
export const streamFor = (seed: number, ...parts: (string | number)[]): Rng =>
  createRng(deriveSeed(seed, ...parts))
