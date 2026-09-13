// Deterministic hashing and value noise — WildLands prototype
//
// Everything generated from these functions is cosmetic and client-side:
// the same seed always yields the same world, so nothing needs persisting.

/** Integer hash of a 2D lattice point, returned in [0, 1). */
export function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t)
}

/** Smooth value noise in [0, 1]. `period` (optional) makes it tile seamlessly. */
export function valueNoise(x: number, y: number, seed: number, period = 0): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = smooth(x - x0)
  const fy = smooth(y - y0)
  const wrap = (v: number) => (period > 0 ? ((v % period) + period) % period : v)
  const a = hash2(wrap(x0), wrap(y0), seed)
  const b = hash2(wrap(x0 + 1), wrap(y0), seed)
  const c = hash2(wrap(x0), wrap(y0 + 1), seed)
  const d = hash2(wrap(x0 + 1), wrap(y0 + 1), seed)
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
}

/** Fractal value noise, stretched so the output covers most of [0, 1]. */
export function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let sum = 0
  let amp = 0.5
  let freq = 1
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + i * 1013)
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  const v = (sum / norm - 0.5) * 2.2 + 0.5
  return v < 0 ? 0 : v > 1 ? 1 : v
}
