// Seeded randomness for tests and the economy simulator.
//
// Resolvers never use unseeded global randomness: the caller injects `random`.
// In production the server supplies it, because persistent RNG is server-owned
// (AGENTS.md §11).

/** mulberry32 — small, fast, deterministic; not cryptographic. */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Uniform integer in [min, max]. */
export function randomInt(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1))
}
