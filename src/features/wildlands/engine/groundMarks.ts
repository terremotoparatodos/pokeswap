// Ground markers — WildLands prototype
//
// Flat overlays painted into the ground buffer before projection, so they tilt
// with the terrain: debug tile grid, warp pads and tap-to-move route.

import { actorPosition, type Actor } from './actors'
import type { Scene } from './renderer'
import { TILE } from './world'

/** Glowing warp pads for portals that are not part of the art. */
export function drawPads(g: CanvasRenderingContext2D, scene: Scene, x0: number, y0: number): void {
  const pulse = (Math.sin(scene.seconds * 3) + 1) / 2
  for (const portal of scene.area.portals) {
    if (!portal.pad) continue
    for (const { tx, ty } of portal.tiles) {
      const cx = tx * TILE + TILE / 2 - x0
      const cy = ty * TILE + TILE / 2 - y0
      const glow = g.createRadialGradient(cx, cy, 1, cx, cy, TILE * 0.9)
      glow.addColorStop(0, `rgba(255, 255, 255, ${0.75 + pulse * 0.25})`)
      glow.addColorStop(0.45, `rgba(120, 200, 255, ${0.55 + pulse * 0.2})`)
      glow.addColorStop(1, 'rgba(120, 200, 255, 0)')
      g.fillStyle = glow
      g.fillRect(cx - TILE, cy - TILE, TILE * 2, TILE * 2)
      g.strokeStyle = 'rgba(255, 255, 255, 0.9)'
      g.lineWidth = 1
      g.beginPath()
      g.arc(cx, cy, 5 + pulse * 1.5, 0, Math.PI * 2)
      g.stroke()
    }
  }
}

/** Path dots, a pulsing destination square, or a red cross for unreachable taps. */
export function drawRoute(g: CanvasRenderingContext2D, scene: Scene, x0: number, y0: number): void {
  const { tiles, target, rejected } = scene.route
  g.save()
  g.translate(-x0, -y0)
  g.fillStyle = 'rgba(255, 255, 255, 0.75)'
  tiles.forEach(({ tx, ty }, i) => {
    if (i === tiles.length - 1 && target) return
    g.fillRect(tx * TILE + 7, ty * TILE + 7, 2, 2)
  })
  if (target) {
    const pulse = 1 + Math.sin(scene.seconds * 8) * 0.12
    const size = (TILE - 2) * pulse
    const cx = target.tx * TILE + TILE / 2
    const cy = target.ty * TILE + TILE / 2
    g.lineWidth = 1.5
    g.strokeStyle = 'rgba(20, 20, 30, 0.45)'
    g.strokeRect(cx - size / 2 + 1, cy - size / 2 + 1, size, size)
    g.strokeStyle = '#ffffff'
    g.strokeRect(cx - size / 2, cy - size / 2, size, size)
  }
  if (rejected && rejected.age < 0.6) {
    const cx = rejected.tx * TILE + TILE / 2
    const cy = rejected.ty * TILE + TILE / 2
    g.globalAlpha = 1 - rejected.age / 0.6
    g.strokeStyle = '#e03c3c'
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(cx - 5, cy - 5); g.lineTo(cx + 5, cy + 5)
    g.moveTo(cx + 5, cy - 5); g.lineTo(cx - 5, cy + 5)
    g.stroke()
  }
  g.restore()
}

/** Tile grid, range circle and current-tile marker around the player. */
export function drawGrid(g: CanvasRenderingContext2D, player: Actor, x0: number, y0: number, dpr: number): void {
  const { x, y } = actorPosition(player)
  const ptx = Math.round(player.tx)
  const pty = Math.round(player.ty)
  const radius = 7
  g.save()
  g.translate(-x0, -y0)
  g.lineWidth = 1 / Math.max(1, dpr * 0.75)
  g.strokeStyle = 'rgba(40, 30, 20, 0.16)'
  g.beginPath()
  for (let i = -radius; i <= radius + 1; i++) {
    g.moveTo((ptx + i) * TILE, (pty - radius) * TILE)
    g.lineTo((ptx + i) * TILE, (pty + radius + 1) * TILE)
    g.moveTo((ptx - radius) * TILE, (pty + i) * TILE)
    g.lineTo((ptx + radius + 1) * TILE, (pty + i) * TILE)
  }
  g.stroke()
  g.strokeStyle = 'rgba(58, 104, 214, 0.9)'
  g.lineWidth = 1
  g.beginPath()
  g.arc(x, y - TILE / 2 + 2, (radius + 0.5) * TILE, 0, Math.PI * 2)
  g.stroke()
  g.strokeStyle = 'rgba(255, 255, 255, 0.85)'
  g.strokeRect(Math.round(x - TILE / 2) + 0.5, Math.round(y - TILE + 2) + 0.5, TILE - 1, TILE - 1)
  g.restore()
}
