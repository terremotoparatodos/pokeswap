// WORLD LOCATION-4 harness: seeded randomness, so a failing repetition can be replayed
// with the same latencies (`--seed`).

/** mulberry32: a small, fast, seedable PRNG in [0, 1). */
export function seeded(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const uniform = (random, min, max) => Math.round(min + random() * (max - min))

/**
 * A network-like latency: mostly a few tens of milliseconds, with a long tail
 * (exponential, mean `meanMs`, capped at `maxMs`). Used for every authority request.
 */
export const tail = (random, meanMs = 40, maxMs = 400) => Math.min(maxMs, Math.round(-meanMs * Math.log(1 - random())))

/** min / median / p95 / max of a list of numbers. */
export function spread(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
  return { n: sorted.length, min: sorted[0], p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] }
}

/** Runs `count` jobs with at most `width` at once; resolves with their results in order. */
export async function pool(count, width, job) {
  const results = new Array(count)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(width, count) }, async () => {
    while (next < count) { const i = next++; results[i] = await job(i) }
  }))
  return results
}
