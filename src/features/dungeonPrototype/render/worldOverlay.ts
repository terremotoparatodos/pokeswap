// Everything the fight adds to the scene (D1.2 §11, §12, §13, §14, §19, §24).
//
// The engine already has a port for this: `SceneOverlay` lets a prototype add
// flat ground marks, extra depth-sorted sprites and short canvas labels without
// the renderer knowing what any of them mean. So the dungeon's health bars,
// Poké Balls, attack flashes, Alpha aura and damage numbers all go through it —
// no renderer change, and every one of them is projected, tilted and lit with
// the rest of the world.

import type { Area } from '../../wildlands/engine/area'
import type { DecorInstance } from '../../wildlands/engine/chunks'
import type { DecorStyle, OverlayLabel, OverlaySprite, SceneOverlay } from '../../wildlands/engine/sceneOverlay'
import { ellipses, shade, spriteFromPixels, type Sprite } from '../../wildlands/engine/sprite'
import { ballFrames, barSprite, statusChip } from '../world/dungeonProps'

export type StatusMark = 'burn' | 'paralysis' | 'poison' | 'freeze' | 'sleep' | 'confused'

/** Type colours, used as the whole visual language of a move (§14). */
export const TYPE_COLOUR: Readonly<Record<string, string>> = {
  normal: '#c6c0a8', fire: '#f08030', water: '#6890f0', electric: '#f8d030',
  grass: '#78c850', ice: '#9ad8d8', fighting: '#c03028', poison: '#a040a0',
  ground: '#e0c068', flying: '#a890f0', psychic: '#f85888', bug: '#a8b820',
  rock: '#b8a038', ghost: '#705898', dragon: '#7038f8', dark: '#6b5a4a',
  steel: '#b8b8d0', fairy: '#ee99ac',
}

export const colourOfType = (type: string | undefined): string =>
  TYPE_COLOUR[(type ?? 'normal').toLowerCase()] ?? TYPE_COLOUR.normal

const STATUS_COLOUR: Record<StatusMark, string> = {
  burn: '#f0603c', paralysis: '#f8d030', poison: '#a040a0',
  freeze: '#9ad8d8', sleep: '#8b93b8', confused: '#e8a33c',
}

/** A combatant's floating readout: the world *is* the HUD (§12). */
export interface WorldBar {
  wx: number
  wy: number
  /** 0..1 */
  hp: number
  /** 0..1 while the action bar fills, or null when it does not apply. */
  action: number | null
  status: StatusMark | null
  confused: boolean
  /** Draws the Alpha's aura on the ground beneath it (§19). */
  alpha?: boolean
  /** Scales the bar: the Alpha is twice the size, so is its bar. */
  scale?: number
  /** Height above the feet, so the bar clears the sprite it belongs to. */
  lift?: number
}

export type EffectKind =
  | 'ball' | 'open' | 'summon' | 'recall' | 'swallow' | 'shake'
  | 'physical' | 'special' | 'statusHit' | 'shield' | 'heal' | 'aoe'| 'ball' | 'open' | 'summon' | 'recall'
  | 'physical' | 'special' | 'statusHit' | 'shield' | 'heal' | 'aoe' | 'shake'

export interface WorldEffect {
  kind: EffectKind
  wx: number
  wy: number
  /** Flight target, for a thrown ball. */
  toX?: number
  toY?: number
  bornAt: number
  life: number
  colour?: string
}

export interface WorldText {
  wx: number
  wy: number
  text: string
  colour: string
  bornAt: number
  life: number
  /** Extra height, so two numbers on the same tile do not overlap. */
  rise?: number
}

/** A prop the fight or the floor adds: a chest, the stairway door, the entrance. */
export interface WorldProp {
  wx: number
  wy: number
  sprite: Sprite
  lift?: number
  alpha?: number
  scale?: number
  depthBias?: number
}

export interface OverlaySource {
  seconds(): number
  bars(): readonly WorldBar[]
  effects(): readonly WorldEffect[]
  texts(): readonly WorldText[]
  props(): readonly WorldProp[]
  /** Swapped per frame so wall torches flicker. */
  torch(seconds: number): Sprite
}

// ── Generated bits ─────────────────────────────────────────────────────────

const burstCache = new Map<string, Sprite>()

/** A soft coloured ball of light, the one shape every attack effect is made of. */
export function burst(colour: string, radius: number): Sprite {
  const key = `${colour}:${radius}`
  const hit = burstCache.get(key)
  if (hit) return hit
  const size = radius * 2 + 2
  const made = spriteFromPixels(size, size, shade(size, size, ellipses([[size / 2, size / 2, radius, radius]]), {
    tones: [colour, mix(colour, '#ffffff', 0.35), mix(colour, '#ffffff', 0.7), '#ffffff'],
    outline: mix(colour, '#000000', 0.45),
    dither: 0.35,
  }), size / 2, size - 1)
  made.castShadow = false
  burstCache.set(key, made)
  return made
}

function mix(a: string, b: string, t: number): string {
  const parse = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  const [ar, ag, ab] = parse(a)
  const [br, bg, bb] = parse(b)
  const to = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0')
  return `#${to(ar, br)}${to(ag, bg)}${to(ab, bb)}`
}

const ease = (t: number): number => 1 - (1 - t) * (1 - t)

// ── The overlay ────────────────────────────────────────────────────────────

export function createWorldOverlay(source: OverlaySource): SceneOverlay {
  return {
    decor(decor: DecorInstance): DecorStyle | null {
      // Wall torches are the only animated prop: the area gives them no kind.
      return decor.kind === null && decor.light ? { sprite: source.torch(source.seconds()) } : null
    },

    ground(g: CanvasRenderingContext2D, _area: Area, x0: number, y0: number, seconds: number): void {
      // Aura rings sit on the floor, so the camera tilts them like the ground.
      for (const bar of source.bars()) {
        if (!bar.alpha) continue
        const radius = 16 + Math.sin(seconds * 2.4) * 3
        for (let ring = 0; ring < 3; ring++) {
          const phase = (seconds * 0.55 + ring / 3) % 1
          g.strokeStyle = `rgba(226, 64, 48, ${(1 - phase) * 0.55})`
          g.lineWidth = 2
          g.beginPath()
          g.ellipse(bar.wx - x0, bar.wy - y0, radius + phase * 26, (radius + phase * 26) * 0.6, 0, 0, Math.PI * 2)
          g.stroke()
        }
      }
      // A hit leaves a short bright ring where it landed.
      for (const effect of source.effects()) {
        if (effect.kind !== 'aoe' && effect.kind !== 'physical' && effect.kind !== 'special') continue
        const t = (source.seconds() - effect.bornAt) / effect.life
        if (t < 0 || t > 1) continue
        const spread = effect.kind === 'aoe' ? 64 : 18
        g.strokeStyle = `rgba(255,255,255,${(1 - t) * 0.5})`
        g.lineWidth = effect.kind === 'aoe' ? 3 : 2
        g.beginPath()
        g.ellipse(effect.wx - x0, effect.wy - y0, 4 + ease(t) * spread, (4 + ease(t) * spread) * 0.55, 0, 0, Math.PI * 2)
        g.stroke()
      }
    },

    sprites(): readonly OverlaySprite[] {
      const now = source.seconds()
      const out: OverlaySprite[] = []

      for (const prop of source.props()) {
        out.push({ wx: prop.wx, wy: prop.wy, sprite: prop.sprite, lift: prop.lift, alpha: prop.alpha, scale: prop.scale, depthBias: prop.depthBias })
      }

      for (const bar of source.bars()) {
        const scale = bar.scale ?? 1
        const lift = bar.lift ?? 20 * scale
        const tone = bar.hp > 0.5 ? 'hp' : bar.hp > 0.2 ? 'low' : 'critical'
        out.push({ wx: bar.wx, wy: bar.wy, sprite: barSprite(bar.hp, tone), lift, scale, depthBias: 4 })
        if (bar.action !== null) {
          out.push({ wx: bar.wx, wy: bar.wy, sprite: barSprite(bar.action, 'action'), lift: lift + 4 * scale, scale, depthBias: 4 })
        }
        let slot = 0
        if (bar.status) {
          out.push({ wx: bar.wx - 12 * scale, wy: bar.wy, sprite: statusChip(STATUS_COLOUR[bar.status], bar.status), lift: lift + 9 * scale, scale, depthBias: 4 })
          slot++
        }
        if (bar.confused) {
          out.push({ wx: bar.wx + (slot ? 12 : -12) * scale, wy: bar.wy, sprite: statusChip(STATUS_COLOUR.confused, 'confused'), lift: lift + 9 * scale, scale, depthBias: 4 })
        }
      }

      const balls = ballFrames()
      for (const effect of source.effects()) {
        const t = (now - effect.bornAt) / effect.life
        if (t < 0 || t > 1) continue
        const colour = effect.colour ?? '#ffffff'
        switch (effect.kind) {
          case 'ball': {
            // A thrown ball arcs to its target.
            const x = effect.wx + ((effect.toX ?? effect.wx) - effect.wx) * t
            const y = effect.wy + ((effect.toY ?? effect.wy) - effect.wy) * t
            out.push({ wx: x, wy: y, sprite: balls[0], lift: Math.sin(t * Math.PI) * 22 + 4, depthBias: 6 })
            break
          }
          case 'open':
            out.push({ wx: effect.wx, wy: effect.wy, sprite: balls[t < 0.5 ? 1 : 2], lift: 6, scale: 1 + t, alpha: 1 - t * 0.5, depthBias: 6 })
            break
          case 'swallow':
            // The wild Pokémon is drawn in: a flash that shrinks into the ball.
            out.push({
              wx: effect.wx, wy: effect.wy, sprite: burst('#ff9d6a', 9), lift: 8,
              scale: 1.6 - t * 1.3, alpha: 1 - t * 0.5, depthBias: 6,
            })
            out.push({ wx: effect.wx, wy: effect.wy, sprite: balls[0], lift: 4, depthBias: 7 })
            break
          case 'shake': {
            // One wobble: the ball tips left, then right, then settles.
            const swing = Math.sin(t * Math.PI * 2) * 3
            out.push({ wx: effect.wx + swing, wy: effect.wy, sprite: balls[0], lift: 4, depthBias: 7 })
            break
          }
          case 'summon':
          case 'recall':
            out.push({
              wx: effect.wx, wy: effect.wy, sprite: burst('#ffe6a0', 8), lift: 8,
              scale: effect.kind === 'summon' ? 0.4 + t * 1.6 : 1.6 - t * 1.4,
              alpha: 1 - t, depthBias: 6,
            })
            break
          case 'physical':
            out.push({ wx: effect.wx, wy: effect.wy, sprite: burst(colour, 7), lift: 10 + t * 8, scale: 1.4 - t * 0.6, alpha: 1 - t, depthBias: 6 })
            break
          case 'special': {
            // A small projectile travelling into the target, then a flash.
            const x = effect.wx + ((effect.toX ?? effect.wx) - effect.wx) * Math.min(1, t * 1.6)
            const y = effect.wy + ((effect.toY ?? effect.wy) - effect.wy) * Math.min(1, t * 1.6)
            out.push({ wx: x, wy: y, sprite: burst(colour, 6), lift: 12, scale: 0.8 + t, alpha: 1 - t * 0.8, depthBias: 6 })
            break
          }
          case 'statusHit':
            out.push({ wx: effect.wx, wy: effect.wy, sprite: burst(colour, 9), lift: 6 + t * 16, scale: 0.7 + t * 0.5, alpha: 0.75 * (1 - t), depthBias: 6 })
            break
          case 'shield':
            out.push({ wx: effect.wx, wy: effect.wy, sprite: burst('#8fd0ff', 12), lift: 10, scale: 1 + Math.sin(t * Math.PI) * 0.2, alpha: 0.5 * (1 - t), depthBias: 6 })
            break
          case 'heal':
            out.push({ wx: effect.wx, wy: effect.wy, sprite: burst('#7de08a', 6), lift: 4 + t * 26, scale: 1 - t * 0.4, alpha: 1 - t, depthBias: 6 })
            break
          default:
            break
        }
      }
      return out
    },

    labels(): readonly OverlayLabel[] {
      const now = source.seconds()
      const out: OverlayLabel[] = []
      for (const text of source.texts()) {
        const t = (now - text.bornAt) / text.life
        if (t < 0 || t > 1) continue
        out.push({
          wx: text.wx,
          wy: text.wy,
          lift: 26 + (text.rise ?? 0) + ease(t) * 18,
          text: text.text,
          color: text.colour,
          alpha: 1 - t * t,
        })
      }
      return out
    },
  }
}
