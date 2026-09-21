// Time of day and weather — WildLands prototype
//
// A full day lasts a few real minutes. Weather is regional: a slow noise field
// over (tile position, time) decides where it rains, and tundra snows instead.

import { valueNoise } from './noise'
import type { Biome } from './world'

export const DAY_SECONDS = 240

export type DayPhase = 'Amanecer' | 'Día' | 'Atardecer' | 'Noche'

export interface Lighting {
  phase: DayPhase
  /** Multiply tint applied over the scene. */
  tint: [number, number, number]
  /** 0 at noon, 1 at midnight: drives lamps and glow. */
  darkness: number
  /** Screen-space shadow direction per unit of height, and its opacity. */
  shadow: { dx: number; dy: number; alpha: number }
}

const NIGHT: [number, number, number] = [70, 88, 170]
const DUSK: [number, number, number] = [255, 172, 118]
const DAY: [number, number, number] = [255, 255, 255]

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

/** `clock` in [0, 1): 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset. */
export function lighting(clock: number): Lighting {
  const c = ((clock % 1) + 1) % 1
  const sun = Math.sin((c - 0.25) * Math.PI * 2) // -1 midnight, 1 noon
  const daylight = Math.min(1, Math.max(0, (sun + 0.4) / 0.55))
  const duskness = Math.max(0, 1 - Math.abs(sun + 0.05) / 0.35)
  let tint = mix(NIGHT, DAY, daylight)
  tint = mix(tint, DUSK, duskness * 0.75)

  let phase: DayPhase
  if (sun < -0.2) phase = 'Noche'
  else if (sun < 0.3) phase = c < 0.5 ? 'Amanecer' : 'Atardecer'
  else phase = 'Día'

  // Sun travels east→west: shadows swing from right to left across the day.
  const across = Math.cos((c - 0.25) * Math.PI * 2 + Math.PI)
  const length = 0.35 + (1 - Math.max(0, sun)) * 0.9
  return {
    phase,
    tint,
    darkness: 1 - daylight,
    shadow: { dx: -across * length, dy: 0.22 + 0.12 * length, alpha: 0.28 * daylight + 0.08 },
  }
}

export type WeatherKind = 'clear' | 'rain' | 'snow'

const PRECIPITATION_DENSITY: Record<Exclude<WeatherKind, 'clear'>, number> = { rain: 160, snow: 96 }
const PRECIPITATION_CAP: Record<Exclude<WeatherKind, 'clear'>, number> = { rain: 180, snow: 110 }

/** A restrained particle budget keeps weather legible without taxing wide/high-DPI displays. */
export function precipitationTarget(kind: WeatherKind, intensity: number, width: number): number {
  if (kind === 'clear' || intensity <= 0 || width <= 0) return 0
  const density = PRECIPITATION_DENSITY[kind]
  return Math.min(PRECIPITATION_CAP[kind], Math.round(density * Math.min(1, intensity) * (width / 1400)))
}

export function weatherAt(tx: number, ty: number, biome: Biome, seconds: number, seed: number): { kind: WeatherKind; intensity: number } {
  if (biome === 'deep') return { kind: 'clear', intensity: 0 }
  const field = valueNoise(tx / 90, ty / 90 + seconds / 70, seed + 500)
  const threshold = biome === 'desert' ? 0.72 : 0.56
  const intensity = Math.min(1, Math.max(0, (field - threshold) / 0.12))
  if (intensity <= 0) return { kind: 'clear', intensity: 0 }
  return { kind: biome === 'tundra' ? 'snow' : 'rain', intensity }
}

interface Particle {
  x: number
  y: number
  z: number
  speed: number
  drift: number
}

/** Screen-space rain/snow particles, recycled when they leave the view. */
export class Precipitation {
  private particles: Particle[] = []

  update(dt: number, width: number, height: number, kind: WeatherKind, intensity: number): void {
    const target = precipitationTarget(kind, intensity, width)
    if (target === 0) {
      this.particles.length = 0
      return
    }
    while (this.particles.length < target) {
      this.particles.push({
        x: Math.random() * width, y: Math.random() * height, z: 0.4 + Math.random() * 0.6,
        speed: kind === 'rain' ? 900 + Math.random() * 500 : 50 + Math.random() * 60,
        drift: Math.random() * Math.PI * 2,
      })
    }
    if (this.particles.length > target) this.particles.length = target
    for (const p of this.particles) {
      p.y += p.speed * p.z * dt
      p.x += (kind === 'rain' ? -160 * p.z : Math.sin(p.drift += dt * 1.6) * 30) * dt
      if (p.y > height) { p.y = -20; p.x = Math.random() * (width + 200) }
      if (p.x < -20) p.x += width + 40
    }
  }

  draw(ctx: CanvasRenderingContext2D, kind: WeatherKind): void {
    if (!this.particles.length) return
    ctx.save()
    if (kind === 'rain') {
      ctx.strokeStyle = 'rgba(210, 225, 255, 0.55)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      for (const p of this.particles) {
        ctx.moveTo(p.x, p.y)
        ctx.lineTo(p.x + 5 * p.z, p.y - 22 * p.z)
      }
      ctx.stroke()
    } else {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
      for (const p of this.particles) {
        const s = Math.round(2 + p.z * 3)
        ctx.fillRect(Math.round(p.x), Math.round(p.y), s, s)
      }
    }
    ctx.restore()
  }
}
