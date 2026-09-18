// The dungeon, drawn on a canvas (D1.1 §2, §3, §8).
//
// A small top-down renderer that lives inside the prototype. It reuses the
// engine's sprite recipe and its real character/Pokémon sheets, but not
// `engine/renderer.ts`: that one draws a perspective world out of an `Area`
// (chunks, decor, projector, lighting, weather), and faking an Area for a
// procedural cave would mean either reimplementing half the world or changing
// production. Documented in the D1.1 notes as the one piece not reused.
//
// Everything here is presentation. It never decides anything.

import type { Sprite } from '../../wildlands/engine/sprite'
import type { Dir } from '../../wildlands/engine/characters'
import { isWalkable, tileAt, type FloorEntity, type FloorTiles } from '../domain/floorTiles'
import { chestSprite, pokeballSprite, TILE, tileSprite } from './tileArt'
import { playerSprite, speciesSprite } from './dungeonSprites'

export interface CombatantView {
  readonly id: string
  readonly speciesId: number
  readonly side: 'ally' | 'enemy'
  readonly hpFraction: number
  readonly fainted: boolean
  /** 2 for an Alpha. */
  readonly scale: number
  readonly aura: boolean
  readonly shield: number
}

export interface RenderView {
  readonly tiles: FloorTiles
  readonly entities: readonly FloorEntity[]
  /** Smoothed tile position, so walking looks like walking. */
  readonly player: { readonly x: number; readonly y: number; readonly dir: Dir; readonly moving: boolean }
  readonly seconds: number
  /** Set while a fight is running: the map stays visible underneath. */
  readonly combat: {
    readonly allies: readonly CombatantView[]
    readonly enemies: readonly CombatantView[]
    readonly at: { readonly x: number; readonly y: number }
    readonly telegraph: { readonly name: string; readonly progress: number } | null
  } | null
  /** Encounter ids another player is fighting, drawn as OCUPADO. */
  readonly busyIds: readonly string[]
  readonly dimmed: boolean
}

export type VfxKind =
  | 'ballThrow' | 'summon' | 'recall' | 'physical' | 'special' | 'status'
  | 'buff' | 'debuff' | 'protect' | 'shieldBreak' | 'impact' | 'damage' | 'heal'
  | 'capture' | 'captureFail' | 'reward' | 'key' | 'aoe'

export interface Vfx {
  readonly kind: VfxKind
  /** World pixels. */
  readonly x: number
  readonly y: number
  readonly bornAt: number
  readonly life: number
  readonly text?: string
  readonly colour?: string
  /** For a throw or a hit: where it goes. */
  readonly toX?: number
  readonly toY?: number
}

const COLOURS: Partial<Record<VfxKind, string>> = {
  physical: '#ffd27a', special: '#8ec7ff', status: '#c38efc', buff: '#7ee2a8',
  debuff: '#ff9f7a', protect: '#8ec7ff', shieldBreak: '#ff6b6b', damage: '#ff6b6b',
  heal: '#7ee2a8', capture: '#ffd27a', captureFail: '#93a2c6', reward: '#ffd27a',
  key: '#ffd27a', aoe: '#ff4d4d',
}

export class DungeonRenderer {
  private readonly ctx: CanvasRenderingContext2D
  private vfx: Vfx[] = []
  private shake = 0

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!
    this.ctx.imageSmoothingEnabled = false
  }

  /** Queues an effect. The renderer owns its lifetime. */
  spawn(effect: Vfx): void {
    this.vfx.push(effect)
    if (effect.kind === 'impact' || effect.kind === 'aoe') this.shake = effect.kind === 'aoe' ? 5 : 3
  }

  clearVfx(): void {
    this.vfx = []
  }

  /** World pixels for a tile, so callers can place effects without maths. */
  static world(x: number, y: number): { x: number; y: number } {
    return { x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 }
  }

  draw(view: RenderView): void {
    const { canvas, ctx } = this
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr))
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    ctx.imageSmoothingEnabled = false
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = '#0b1020'
    ctx.fillRect(0, 0, w, h)

    // Zoom so a phone sees a useful slice and a desktop is not a wall of tiles.
    const zoom = Math.max(1.5, Math.min(2.5, (w / dpr) / 420)) * dpr
    const focus = view.combat ? view.combat.at : view.player
    const camX = focus.x * TILE + TILE / 2
    const camY = focus.y * TILE + TILE / 2
    const shakeX = this.shake ? (Math.random() - 0.5) * this.shake : 0
    const shakeY = this.shake ? (Math.random() - 0.5) * this.shake : 0
    this.shake = Math.max(0, this.shake - 0.4)

    ctx.setTransform(zoom, 0, 0, zoom, w / 2 - camX * zoom + shakeX, h / 2 - camY * zoom + shakeY)

    const halfW = w / (2 * zoom)
    const halfH = h / (2 * zoom)
    const x0 = Math.floor((camX - halfW) / TILE) - 1
    const x1 = Math.ceil((camX + halfW) / TILE) + 1
    const y0 = Math.floor((camY - halfH) / TILE) - 1
    const y1 = Math.ceil((camY + halfH) / TILE) + 1

    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const kind = tileAt(view.tiles, tx, ty)
        const sprite = tileSprite(view.tiles.theme, kind)
        ctx.drawImage(sprite.canvas, tx * TILE, ty * TILE)
      }
    }

    // Wall edges: a bright lip on the face that meets the floor and a shadow
    // cast onto it. This is what turns a grid of tiles into a cave you can read.
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (tileAt(view.tiles, tx, ty) !== 'rock') continue
        const below = isWalkable(view.tiles, tx, ty + 1)
        if (below) {
          ctx.fillStyle = 'rgba(255,255,255,0.10)'
          ctx.fillRect(tx * TILE, (ty + 1) * TILE - 3, TILE, 3)
          ctx.fillStyle = 'rgba(0,0,0,0.38)'
          ctx.fillRect(tx * TILE, (ty + 1) * TILE, TILE, 6)
        }
        if (isWalkable(view.tiles, tx - 1, ty)) {
          ctx.fillStyle = 'rgba(0,0,0,0.22)'
          ctx.fillRect(tx * TILE - 3, ty * TILE, 3, TILE)
        }
        if (isWalkable(view.tiles, tx + 1, ty)) {
          ctx.fillStyle = 'rgba(0,0,0,0.22)'
          ctx.fillRect((tx + 1) * TILE, ty * TILE, 3, TILE)
        }
      }
    }

    if (view.dimmed) {
      ctx.fillStyle = 'rgba(5,8,18,0.5)'
      ctx.fillRect((x0 - 1) * TILE, (y0 - 1) * TILE, (x1 - x0 + 3) * TILE, (y1 - y0 + 3) * TILE)
    }

    this.drawEntities(view)
    if (view.combat) this.drawCombat(view, view.combat)
    else this.drawPlayer(view)
    this.drawVfx(view.seconds)

    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }

  private shadow(x: number, y: number, radius: number): void {
    const { ctx } = this
    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    ctx.beginPath()
    ctx.ellipse(x, y, radius, radius * 0.4, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  private blit(sprite: Sprite, x: number, y: number, scale = 1, alpha = 1): void {
    const { ctx } = this
    if (alpha < 1) ctx.globalAlpha = alpha
    ctx.drawImage(
      sprite.canvas,
      Math.round(x - sprite.ax * scale), Math.round(y - sprite.ay * scale),
      sprite.w * scale, sprite.h * scale,
    )
    if (alpha < 1) ctx.globalAlpha = 1
  }

  private drawEntities(view: RenderView): void {
    const { ctx } = this
    // Back to front, so a Pokémon standing lower overlaps the one above it.
    const sorted = [...view.entities].filter(entity => !entity.taken).sort((a, b) => a.at.y - b.at.y)
    for (const entity of sorted) {
      const { x, y } = DungeonRenderer.world(entity.at.x, entity.at.y)
      const bottom = y + TILE / 2 - 2

      if (entity.kind === 'chest') {
        this.shadow(x, bottom, 9)
        this.blit(chestSprite(false), x, bottom)
        continue
      }

      const scale = entity.isAlpha ? 2 : 1
      if (entity.kind === 'lucky') {
        // Lucky Pokémon: a halo and a slow sparkle ring, unmistakable at a glance.
        const pulse = 1 + Math.sin(view.seconds * 3) * 0.12
        ctx.strokeStyle = 'rgba(142,240,192,0.85)'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.ellipse(x, bottom - 6, 13 * pulse, 10 * pulse, 0, 0, Math.PI * 2)
        ctx.stroke()
      }
      if (entity.isAlpha) this.drawAura(x, bottom - 12, 20, view.seconds)

      this.shadow(x, bottom, 8 * scale)
      this.blit(speciesSprite(entity.speciesId ?? 74, 'down', view.seconds), x, bottom, scale)

      if (view.busyIds.includes(entity.id)) {
        ctx.fillStyle = 'rgba(10,14,26,0.85)'
        ctx.fillRect(x - 20, bottom - 34, 40, 11)
        ctx.fillStyle = '#ff9f7a'
        ctx.font = 'bold 8px system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('OCUPADO', x, bottom - 26)
      }
    }
  }

  private drawAura(x: number, y: number, radius: number, seconds: number): void {
    const { ctx } = this
    for (let ring = 0; ring < 3; ring++) {
      const phase = (seconds * 0.6 + ring / 3) % 1
      ctx.strokeStyle = `rgba(255,60,60,${0.5 * (1 - phase)})`
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.ellipse(x, y, radius * (0.7 + phase), radius * 0.45 * (0.7 + phase), 0, 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  private drawPlayer(view: RenderView): void {
    const { x, y } = DungeonRenderer.world(view.player.x, view.player.y)
    const bottom = y + TILE / 2 - 2
    this.shadow(x, bottom, 8)
    this.blit(playerSprite(view.player.dir, view.seconds, view.player.moving), x, bottom)
  }

  /** The fight happens on the map: both sides stand on real tiles. */
  private drawCombat(view: RenderView, combat: NonNullable<RenderView['combat']>): void {
    const { ctx } = this
    const centre = DungeonRenderer.world(combat.at.x, combat.at.y)

    combat.allies.forEach((ally, i) => {
      const x = centre.x - 34 - i * 22
      const y = centre.y + 14 + i * 10
      this.drawFighter(ally, x, y, view.seconds, 'right')
    })
    combat.enemies.forEach((enemy, i) => {
      const x = centre.x + 30 + i * 22
      const y = centre.y - 6 - i * 8
      this.drawFighter(enemy, x, y, view.seconds, 'left')
    })

    if (combat.telegraph) {
      const width = 96
      ctx.fillStyle = 'rgba(58,15,20,0.92)'
      ctx.fillRect(centre.x - width / 2, centre.y - 52, width, 16)
      ctx.strokeStyle = '#ff4d4d'
      ctx.lineWidth = 1
      ctx.strokeRect(centre.x - width / 2, centre.y - 52, width, 16)
      ctx.fillStyle = '#ff4d4d'
      ctx.fillRect(centre.x - width / 2, centre.y - 38, width * combat.telegraph.progress, 2)
      ctx.fillStyle = '#ffd0d0'
      ctx.font = 'bold 8px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(`⚠ ${combat.telegraph.name}`.slice(0, 22), centre.x, centre.y - 41)
    }
  }

  private drawFighter(view: CombatantView, x: number, y: number, seconds: number, facing: Dir): void {
    const { ctx } = this
    if (view.aura) this.drawAura(x, y - 14 * view.scale, 22 * view.scale, seconds)
    this.shadow(x, y, 9 * view.scale)
    this.blit(speciesSprite(view.speciesId, facing, seconds), x, y, view.scale, view.fainted ? 0.3 : 1)

    if (view.shield > 0) {
      ctx.strokeStyle = 'rgba(142,199,255,0.9)'
      ctx.lineWidth = view.shield
      ctx.beginPath()
      ctx.ellipse(x, y - 12 * view.scale, 16 * view.scale, 18 * view.scale, 0, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = '#8ec7ff'
      ctx.font = 'bold 8px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(`◈${view.shield}`, x, y - 32 * view.scale)
    }
  }

  private drawVfx(seconds: number): void {
    const { ctx } = this
    this.vfx = this.vfx.filter(effect => seconds - effect.bornAt < effect.life)
    for (const effect of this.vfx) {
      const t = Math.max(0, Math.min(1, (seconds - effect.bornAt) / effect.life))
      const colour = effect.colour ?? COLOURS[effect.kind] ?? '#ffffff'

      if (effect.kind === 'ballThrow' || effect.kind === 'recall') {
        // An arc from thrower to target, so the ball reads as thrown.
        const toX = effect.toX ?? effect.x
        const toY = effect.toY ?? effect.y
        const px = effect.x + (toX - effect.x) * t
        const py = effect.y + (toY - effect.y) * t - Math.sin(t * Math.PI) * 22
        this.blit(pokeballSprite(), px, py, 1)
        continue
      }
      if (effect.kind === 'summon' || effect.kind === 'capture' || effect.kind === 'captureFail') {
        // Burst rings; capture shakes the ball three times before it settles.
        const shakes = effect.kind === 'captureFail' ? 2 : 3
        const wobble = Math.sin(t * Math.PI * 2 * shakes) * (1 - t) * 4
        this.blit(pokeballSprite(), effect.x + wobble, effect.y, 1, effect.kind === 'summon' ? 1 - t : 1)
        ctx.strokeStyle = colour
        ctx.globalAlpha = 1 - t
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.ellipse(effect.x, effect.y, 6 + t * 20, 5 + t * 15, 0, 0, Math.PI * 2)
        ctx.stroke()
        ctx.globalAlpha = 1
        continue
      }
      if (effect.kind === 'damage' || effect.kind === 'heal' || effect.kind === 'reward' || effect.kind === 'key') {
        ctx.globalAlpha = t > 0.7 ? (1 - t) / 0.3 : 1
        ctx.fillStyle = colour
        ctx.font = 'bold 11px system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.strokeStyle = 'rgba(10,14,26,0.9)'
        ctx.lineWidth = 3
        ctx.lineJoin = 'round'
        const text = effect.text ?? ''
        ctx.strokeText(text, effect.x, effect.y - t * 20)
        ctx.fillText(text, effect.x, effect.y - t * 20)
        ctx.globalAlpha = 1
        continue
      }
      if (effect.kind === 'impact' || effect.kind === 'aoe') {
        ctx.globalAlpha = 1 - t
        ctx.fillStyle = colour
        ctx.beginPath()
        ctx.ellipse(effect.x, effect.y, (effect.kind === 'aoe' ? 30 : 14) * (0.4 + t), (effect.kind === 'aoe' ? 20 : 10) * (0.4 + t), 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 1
        continue
      }
      // The generic move grammar: a shape travelling from user to target.
      const toX = effect.toX ?? effect.x
      const toY = effect.toY ?? effect.y
      const px = effect.x + (toX - effect.x) * t
      const py = effect.y + (toY - effect.y) * t
      ctx.globalAlpha = 1 - t * 0.4
      ctx.fillStyle = colour
      ctx.strokeStyle = colour
      ctx.lineWidth = 2
      if (effect.kind === 'physical') {
        // A slash.
        ctx.beginPath()
        ctx.moveTo(px - 8, py - 8)
        ctx.lineTo(px + 8, py + 8)
        ctx.stroke()
      } else if (effect.kind === 'special') {
        ctx.beginPath()
        ctx.arc(px, py, 5 + t * 4, 0, Math.PI * 2)
        ctx.fill()
      } else if (effect.kind === 'protect') {
        ctx.beginPath()
        ctx.ellipse(px, py - 10, 16, 18, 0, 0, Math.PI * 2)
        ctx.stroke()
      } else if (effect.kind === 'shieldBreak') {
        for (let i = 0; i < 4; i++) {
          const angle = (i * Math.PI) / 2 + t * 2
          ctx.beginPath()
          ctx.moveTo(px, py - 10)
          ctx.lineTo(px + Math.cos(angle) * (10 + t * 14), py - 10 + Math.sin(angle) * (10 + t * 14))
          ctx.stroke()
        }
      } else {
        // status / buff / debuff: rising or falling chevrons.
        const dir = effect.kind === 'debuff' ? 1 : -1
        for (let i = 0; i < 3; i++) {
          const offset = (t * 18 + i * 7) * dir
          ctx.beginPath()
          ctx.moveTo(px - 6, py + offset)
          ctx.lineTo(px, py + offset - 5 * dir)
          ctx.lineTo(px + 6, py + offset)
          ctx.stroke()
        }
      }
      ctx.globalAlpha = 1
    }
  }
}
