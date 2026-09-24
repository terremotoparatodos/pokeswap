// Summary statistics for PERF-1 measurements. Pure; no DOM.

export interface Summary {
  n: number
  mean: number
  p50: number
  p95: number
  p99: number
  max: number
}

const round = (value: number) => Math.round(value * 100) / 100

/** Nearest-rank percentile over an already sorted array. */
export function percentileSorted(sorted: ArrayLike<number>, fraction: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))]
}

export function summarize(values: ArrayLike<number>): Summary {
  const n = values.length
  if (n === 0) return { n: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0 }
  const sorted = Float64Array.from(values).sort()
  let total = 0
  for (let i = 0; i < n; i++) total += sorted[i]
  return {
    n,
    mean: round(total / n),
    p50: round(percentileSorted(sorted, 0.5)),
    p95: round(percentileSorted(sorted, 0.95)),
    p99: round(percentileSorted(sorted, 0.99)),
    max: round(sorted[n - 1]),
  }
}

/**
 * Fixed-capacity sample buffer. It keeps the most recent `capacity` values so a
 * long soak cannot grow memory; `total` still counts every sample recorded.
 */
export class SampleRing {
  private readonly data: Float64Array
  private index = 0
  total = 0

  constructor(readonly capacity: number) {
    this.data = new Float64Array(capacity)
  }

  push(value: number): void {
    this.data[this.index] = value
    this.index = (this.index + 1) % this.capacity
    this.total++
  }

  values(): Float64Array {
    return this.total >= this.capacity ? this.data.slice() : this.data.slice(0, this.index)
  }

  clear(): void {
    this.index = 0
    this.total = 0
  }
}

/** Counts integer-bucketed values, the last bucket collecting everything at or above it. */
export class Histogram {
  readonly counts: number[]

  constructor(readonly buckets: number) {
    this.counts = new Array(buckets).fill(0)
  }

  add(value: number): void {
    const bucket = Math.max(0, Math.min(this.buckets - 1, Math.round(value)))
    this.counts[bucket]++
  }

  clear(): void {
    this.counts.fill(0)
  }
}
