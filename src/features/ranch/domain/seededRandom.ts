// Deterministic randomness — Rancho
//
// Same input, same ranch: layout details, mock members and their homes are
// derived from hashes so a reload (or another visitor) sees the same place.

/** Murmur3's finaliser: spreads the hash so similar ids ("r1", "r2") land far apart. */
function mix(h: number): number {
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/** FNV-1a over UTF-16 code units, then mixed: a stable, well-spread 32-bit hash. */
export function hashString(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return mix(h >>> 0)
}

/** Uniform [0, 1) from a string. */
export function unitHash(text: string): number {
  return hashString(text) / 0x100000000
}

/** Small, fast seeded PRNG (mulberry32); returns [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000
  }
}
