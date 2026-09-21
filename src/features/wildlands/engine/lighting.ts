// Lighting and screen effects — WildLands prototype
//
// Drawn over the finished scene: day/night multiply tint, additive glows
// (player lantern, street lamps), rain/snow, vignette and the travel fade.

import { actorPosition } from './actors'
import { Precipitation } from './atmosphere'
import type { Projector } from './projection'
import type { Scene } from './renderer'

/** Screen position of a light source (a street lamp globe) drawn this frame. */
export interface LightSource {
  x: number
  y: number
  scale: number
}

export class SceneLighting {
  private readonly rain = new Precipitation()
  private vignette: CanvasGradient | null = null
  private vignetteWidth = 0
  private vignetteHeight = 0

  draw(
    ctx: CanvasRenderingContext2D, scene: Scene, proj: Projector, lights: readonly LightSource[],
    W: number, H: number, dt: number,
  ): void {
    const { tint, darkness } = scene.light
    const wet = scene.weather.intensity
    const r = tint[0] * (1 - wet * 0.22)
    const g = tint[1] * (1 - wet * 0.2)
    const b = tint[2] * (1 - wet * 0.12)
    ctx.globalCompositeOperation = 'multiply'
    ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`
    ctx.fillRect(0, 0, W, H)

    if (darkness > 0.15) {
      ctx.globalCompositeOperation = 'lighter'
      const p = actorPosition(scene.player)
      const sp = proj.project(p.x - scene.camX, p.y - scene.camY)
      if (sp) {
        const radius = 70 * sp.scale
        const glow = ctx.createRadialGradient(sp.x, sp.y - 8 * sp.scale, 0, sp.x, sp.y - 8 * sp.scale, radius)
        glow.addColorStop(0, `rgba(255, 200, 120, ${0.32 * darkness})`)
        glow.addColorStop(1, 'rgba(255, 200, 120, 0)')
        ctx.fillStyle = glow
        ctx.fillRect(sp.x - radius, sp.y - radius - 8 * sp.scale, radius * 2, radius * 2)
      }
      // Street lamps: a warm pool around each globe.
      for (const l of lights) {
        const radius = 46 * l.scale
        const pool = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, radius)
        pool.addColorStop(0, `rgba(255, 236, 180, ${0.55 * darkness})`)
        pool.addColorStop(0.25, `rgba(255, 210, 130, ${0.25 * darkness})`)
        pool.addColorStop(1, 'rgba(255, 200, 120, 0)')
        ctx.fillStyle = pool
        ctx.fillRect(l.x - radius, l.y - radius, radius * 2, radius * 2)
      }
    }
    ctx.globalCompositeOperation = 'source-over'

    this.rain.update(dt, W, H, scene.weather.kind, scene.weather.intensity)
    this.rain.draw(ctx, scene.weather.kind)

    if (!this.vignette || this.vignetteWidth !== W || this.vignetteHeight !== H) {
      this.vignette = ctx.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.35, W / 2, H * 0.55, Math.max(W, H) * 0.75)
      this.vignette.addColorStop(0, 'rgba(10, 14, 30, 0)')
      this.vignette.addColorStop(1, 'rgba(10, 14, 30, 1)')
      this.vignetteWidth = W
      this.vignetteHeight = H
    }
    ctx.globalAlpha = 0.28 + darkness * 0.25
    ctx.fillStyle = this.vignette
    ctx.fillRect(0, 0, W, H)
    ctx.globalAlpha = 1

    if (scene.fade > 0) {
      ctx.fillStyle = `rgba(6, 8, 18, ${Math.min(1, scene.fade)})`
      ctx.fillRect(0, 0, W, H)
    }
  }
}

/** Four-point twinkle on shiny Pokémon and crystals. */
export function drawSparkle(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.fillStyle = '#ffffff'
  const u = Math.max(1, Math.round(s))
  ctx.fillRect(x - u / 2, y - u * 2.5, u, u * 5)
  ctx.fillRect(x - u * 2.5, y - u / 2, u * 5, u)
}
