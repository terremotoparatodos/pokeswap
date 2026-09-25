// Farm plots drawn into the shared scene (INTEGRATION-1).
//
// Everyone sees the same thing: the plot's stage comes from the server's
// timestamps (WORLD), the crop's look from its harvest item (SKILLS' art).
// Soil is painted into the ground buffer; sprouts and ripe crops are sprites
// sorted with the scene. Nothing here decides a stage.

import { PLOTS, plotStageAt } from '../../../../services/realtime/src/world/plots.js'
import type { Area } from '../../wildlands/engine/area'
import type { OverlayLabel, OverlaySprite, SceneOverlay } from '../../wildlands/engine/sceneOverlay'
import type { Sprite } from '../../wildlands/engine/sprite'
import { TILE } from '../../wildlands/engine/world'
import { CROP_BY_ID } from '../../skills/domain/farming'
import { cropIconArt } from '../../skills/scene/art/cropItems'
import { color, pixelArt, toSprite } from '../../skills/scene/art/pixelArt'
import type { SharedWorld } from '../../world/state/sharedWorld'

const SOIL = '#6b4526'
const FURROW = '#4f3119'
const SPROUT = ['#2c7a37', '#44a043', '#6cc255']

const sprites = new Map<string, Sprite>()

function sprout(size: 'small' | 'big'): Sprite {
  const key = `sprout:${size}`
  let sprite = sprites.get(key)
  if (sprite) return sprite
  const art = pixelArt(12, 12, undefined, 6, 11)
  const put = (x: number, y: number, hex: string) => { art.pixels[y * 12 + x] = color(hex) }
  const height = size === 'small' ? 4 : 8
  for (let y = 11; y > 11 - height; y--) put(6, y, SPROUT[0])
  put(5, 11 - height + 1, SPROUT[1]); put(7, 11 - height + 1, SPROUT[1])
  if (size === 'big') { put(4, 7, SPROUT[2]); put(8, 6, SPROUT[2]); put(5, 5, SPROUT[1]); put(7, 4, SPROUT[1]) }
  sprite = toSprite(art, false)
  sprites.set(key, sprite)
  return sprite
}

function ripe(itemId: string): Sprite | null {
  const key = `ripe:${itemId}`
  if (sprites.has(key)) return sprites.get(key)!
  const art = cropIconArt(itemId)
  const sprite = art ? toSprite(art, false) : null
  if (sprite) sprites.set(key, sprite)
  return sprite
}

export class PlotOverlay implements SceneOverlay {
  constructor(private readonly world: SharedWorld, private readonly localPlayer: () => string | null) {}

  private plotsIn(area: Area) {
    return PLOTS.filter(plot => plot.areaId === area.id)
  }

  ground(g: CanvasRenderingContext2D, area: Area, x0: number, y0: number): void {
    for (const plot of this.plotsIn(area)) {
      const x = plot.tx * TILE - x0
      const y = plot.ty * TILE - y0
      g.fillStyle = SOIL
      g.fillRect(x + 1, y + 1, TILE - 2, TILE - 2)
      g.fillStyle = FURROW
      for (let row = 4; row < TILE - 2; row += 4) g.fillRect(x + 2, y + row, TILE - 4, 1)
    }
  }

  sprites(area: Area): readonly OverlaySprite[] {
    const now = this.world.serverNow()
    if (now === null) return []
    const out: OverlaySprite[] = []
    for (const plot of this.plotsIn(area)) {
      const data = this.world.resources.node(plot.id)?.plot
      if (!data) continue
      const stage = plotStageAt(data, now)
      const crop = CROP_BY_ID.get(data.cropId)
      const sprite = stage === 'ready' && crop ? ripe(crop.harvest.itemId) : sprout(stage === 'growing' ? 'big' : 'small')
      if (sprite) out.push({ wx: plot.tx * TILE + TILE / 2, wy: plot.ty * TILE + TILE - 2, sprite })
    }
    return out
  }

  labels(area: Area): readonly OverlayLabel[] {
    const now = this.world.serverNow()
    const me = this.localPlayer()
    if (now === null || me === null) return []
    const out: OverlayLabel[] = []
    for (const plot of this.plotsIn(area)) {
      const data = this.world.resources.node(plot.id)?.plot
      if (data?.ownerId === me && plotStageAt(data, now) === 'ready') {
        out.push({ wx: plot.tx * TILE + TILE / 2, wy: plot.ty * TILE + TILE - 2, lift: 22, text: '¡Listo!', color: '#9be27a' })
      }
    }
    return out
  }
}
