// Fixed-size particle pool for impact effects. Pure: state in, state out.
// A hard cap keeps a burst of swings cheap on phones; the oldest particles
// are dropped first when the pool is full.

import { RARITY_FEEDBACK, type DropRarity } from './miningRarity'

export type ParticleKind = 'chip' | 'dust' | 'spark' | 'glint'

export interface Particle {
  readonly kind: ParticleKind
  /** World feet position. */
  readonly x: number
  readonly y: number
  /** Height above the ground. */
  readonly z: number
  readonly vx: number
  readonly vy: number
  readonly vz: number
  readonly age: number
  readonly life: number
  readonly tone: DropRarity
}

export const MAX_PARTICLES = 40
export const GRAVITY = 140

const LIFE: Readonly<Record<ParticleKind, number>> = { chip: 0.55, dust: 0.45, spark: 0.3, glint: 0.7 }

export interface ImpactOptions {
  readonly x: number
  readonly y: number
  /** Height where the pickaxe hits. */
  readonly z: number
  readonly rarity: DropRarity
  /** Horizontal direction away from the player (-1 left, 1 right, 0 vertical). */
  readonly away: number
  readonly random: () => number
}

export function spawnImpact(pool: readonly Particle[], options: ImpactOptions): Particle[] {
  const feedback = RARITY_FEEDBACK[options.rarity]
  const { random } = options
  const spread = () => (random() - 0.5) * 2
  const make = (kind: ParticleKind, speed: number, lift: number, tone: DropRarity): Particle => ({
    kind, x: options.x, y: options.y, z: options.z, tone,
    vx: (options.away * 0.6 + spread()) * speed, vy: spread() * speed * 0.35, vz: lift + random() * lift * 0.5,
    age: 0, life: LIFE[kind] * (0.8 + random() * 0.4),
  })
  const burst: Particle[] = [
    ...Array.from({ length: feedback.chips }, (_, i) => make('chip', 28, 48, i === 0 ? options.rarity : 'common')),
    ...Array.from({ length: feedback.dust }, () => make('dust', 8, 10, 'common')),
    ...Array.from({ length: feedback.sparks }, () => make('spark', 40, 36, options.rarity)),
    ...Array.from({ length: feedback.glints }, () => make('glint', 6, 30, options.rarity)),
  ]
  const next = [...pool, ...burst]
  return next.length > MAX_PARTICLES ? next.slice(next.length - MAX_PARTICLES) : next
}

export function stepParticles(pool: readonly Particle[], dt: number): Particle[] {
  const next: Particle[] = []
  for (const p of pool) {
    const age = p.age + dt
    if (age >= p.life) continue
    const floats = p.kind === 'dust' || p.kind === 'glint'
    const vz = floats ? p.vz * 0.9 : p.vz - GRAVITY * dt
    let z = p.z + vz * dt
    let vx = p.vx
    if (z <= 0) {
      z = 0
      vx *= 0.4
    }
    next.push({ ...p, age, z, vz: z === 0 && !floats ? 0 : vz, vx, x: p.x + vx * dt, y: p.y + p.vy * dt })
  }
  return next
}
