// Water particles for fishing (R31-C2): droplets when the line lands, foam
// when something breaks the surface. Reuses the shared particle pool so the
// cap and the physics stay the same as the mining impact effects.

import { MAX_PARTICLES, stepParticles, type Particle } from '../mining/particles'
import type { DropRarity } from '../mining/miningRarity'

export { stepParticles, MAX_PARTICLES }

export interface SplashOptions {
  readonly x: number
  readonly y: number
  /** Height of the water surface in world pixels. */
  readonly z: number
  readonly droplets: number
  readonly foam: number
  readonly rarity: DropRarity
  readonly random: () => number
}

/** A short burst: droplets fly out and fall, foam puffs hang for a moment. */
export function spawnSplash(pool: readonly Particle[], options: SplashOptions): Particle[] {
  const { random } = options
  const spread = () => (random() - 0.5) * 2
  const make = (kind: Particle['kind'], speed: number, lift: number): Particle => ({
    kind, x: options.x, y: options.y, z: options.z, tone: options.rarity,
    vx: spread() * speed, vy: spread() * speed * 0.4, vz: lift + random() * lift * 0.6,
    age: 0, life: (kind === 'chip' ? 0.5 : 0.4) * (0.8 + random() * 0.4),
  })
  const burst = [
    ...Array.from({ length: options.droplets }, () => make('chip', 22, 40)),
    ...Array.from({ length: options.foam }, () => make('dust', 7, 8)),
  ]
  const next = [...pool, ...burst]
  return next.length > MAX_PARTICLES ? next.slice(next.length - MAX_PARTICLES) : next
}
