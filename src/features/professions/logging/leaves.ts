// Falling leaves (R31-C3).
//
// Splinters and sawdust reuse the shared particle pool, but leaves need their
// own motion: they hang in the air, swing side to side and land slowly. That
// difference is most of what makes chopping feel like wood and not like rock.

export interface Leaf {
  readonly x: number
  readonly y: number
  /** Height above the ground, in world pixels. */
  readonly z: number
  readonly vx: number
  readonly vy: number
  /** Sink speed (positive falls). */
  readonly sink: number
  /** How wide it swings and where in the swing it starts. */
  readonly swing: number
  readonly phase: number
  readonly age: number
  readonly life: number
  readonly tone: string
}

export const MAX_LEAVES = 24
export const LEAF_LIFE = 1.6

export interface LeafBurst {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly count: number
  readonly tones: readonly string[]
  readonly random: () => number
}

export function spawnLeaves(pool: readonly Leaf[], burst: LeafBurst): Leaf[] {
  const { random } = burst
  const spread = () => (random() - 0.5) * 2
  const leaves = Array.from({ length: burst.count }, (_, i) => ({
    x: burst.x + spread() * 6,
    y: burst.y + spread() * 3,
    z: burst.z + random() * 6,
    vx: spread() * 4,
    vy: spread() * 2,
    sink: 7 + random() * 6,
    swing: 5 + random() * 7,
    phase: random() * Math.PI * 2,
    age: 0,
    life: LEAF_LIFE * (0.7 + random() * 0.6),
    tone: burst.tones[i % burst.tones.length],
  }))
  const next = [...pool, ...leaves]
  return next.length > MAX_LEAVES ? next.slice(next.length - MAX_LEAVES) : next
}

export function stepLeaves(pool: readonly Leaf[], dt: number): Leaf[] {
  const next: Leaf[] = []
  for (const leaf of pool) {
    const age = leaf.age + dt
    if (age >= leaf.life) continue
    const z = Math.max(0, leaf.z - leaf.sink * dt)
    // Side-to-side drift: the leaf keeps swinging until it settles.
    const sway = Math.cos(leaf.phase + age * 5) * leaf.swing * (z > 0 ? 1 : 0)
    next.push({
      ...leaf,
      age,
      z,
      x: leaf.x + (leaf.vx + sway) * dt,
      y: leaf.y + leaf.vy * dt,
      sink: z > 0 ? leaf.sink : 0,
    })
  }
  return next
}

/** Which of the two leaf frames to draw: it tumbles as it swings. */
export function leafFrame(leaf: Leaf): 0 | 1 {
  return Math.cos(leaf.phase + leaf.age * 5) >= 0 ? 0 : 1
}

/** Leaves fade out over their last third. */
export function leafAlpha(leaf: Leaf): number {
  const left = 1 - leaf.age / leaf.life
  return Math.max(0, Math.min(1, left * 3))
}
