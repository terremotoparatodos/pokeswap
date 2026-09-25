// Shared resource state drawn into the scene (WORLD-1B/1C).
//
// Only what the server said: a node away from its base state. A depleted tree
// is a stump for everyone, a node being worked shakes in time with its worker
// and shows the action's progress from the shared clock. Nothing here decides
// a state; it reads the mirror.

import type { Area } from '../../wildlands/engine/area'
import type { DecorInstance } from '../../wildlands/engine/chunks'
import type { DecorStyle, OverlayLabel, SceneOverlay } from '../../wildlands/engine/sceneOverlay'
import { TILE } from '../../wildlands/engine/world'
import type { WorldClock } from '../domain/worldClock'
import type { WorldResourceMirror } from '../domain/worldResources'
import { depletedSprite } from './depletedArt'

const VERB: Readonly<Record<string, string>> = { chop: 'Talando', mine: 'Minando' }

export class WorldResourceOverlay implements SceneOverlay {
  constructor(private readonly mirror: WorldResourceMirror, private readonly clock: WorldClock) {}

  decor(decor: DecorInstance, area: Area): DecorStyle | null {
    if (this.mirror.activeNodes === 0 || !decor.kind || area.id !== this.mirror.areaId) return null
    const node = this.mirror.node(`${area.id}:${decor.tx}:${decor.ty}:${decor.kind}`)
    if (!node) return null
    if (node.state === 'depleted') {
      const sprite = depletedSprite(decor.kind)
      return sprite ? { sprite } : null
    }
    if (node.actionId) {
      const now = this.clock.now() ?? 0
      return { dx: (now % 600) < 90 ? ((Math.floor(now / 600) % 2) ? 1 : -1) : 0 }
    }
    return null
  }

  ground(g: CanvasRenderingContext2D, area: Area, x0: number, y0: number): void {
    if (this.mirror.activeNodes === 0 || area.id !== this.mirror.areaId) return
    const now = this.clock.now()
    if (now === null) return
    for (const node of this.mirror.active()) {
      if (!node.actionId || node.startedAt === undefined || node.endsAt === undefined) continue
      const [, tx, ty] = node.id.split(':').map(Number) as [number, number, number]
      const progress = Math.min(1, Math.max(0, (now - node.startedAt) / Math.max(1, node.endsAt - node.startedAt)))
      const cx = tx * TILE + TILE / 2 - x0
      const cy = ty * TILE + TILE - 3 - y0
      g.save()
      g.lineWidth = 2
      g.strokeStyle = 'rgba(0, 0, 0, 0.35)'
      g.beginPath(); g.ellipse(cx, cy, 9, 4.5, 0, 0, Math.PI * 2); g.stroke()
      g.strokeStyle = '#ffd27a'
      g.beginPath(); g.ellipse(cx, cy, 9, 4.5, 0, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2); g.stroke()
      g.restore()
    }
  }

  labels(area: Area): readonly OverlayLabel[] {
    if (this.mirror.activeNodes === 0 || area.id !== this.mirror.areaId) return []
    const labels: OverlayLabel[] = []
    for (const node of this.mirror.active()) {
      if (!node.actionId || !node.workKind) continue
      const [, tx, ty] = node.id.split(':').map(Number) as [number, number, number]
      labels.push({ wx: tx * TILE + TILE / 2, wy: ty * TILE + TILE - 2, lift: 30, text: VERB[node.workKind] ?? 'Trabajando', color: '#ffd27a', alpha: 0.9 })
    }
    return labels
  }
}
