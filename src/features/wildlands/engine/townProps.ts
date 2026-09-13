// Street furniture — WildLands prototype
//
// Small town props painted in code with the same outline/ramp rules as the
// wild props and buildings.

import { Painter } from './painter'
import { ellipses, shade, spriteFromPixels, type Sprite } from './sprite'

export type TownPropKind = 'lamp' | 'sign' | 'bench' | 'hedge' | 'fenceH' | 'fenceV' | 'spray'

const OUTLINE = '#2a2230'

function lamp(): Sprite {
  const p = new Painter(12, 34)
  p.rect(5, 10, 2, 22, '#2c3c64')
  p.vline(5, 10, 22, '#4a5c8c')
  p.rect(3, 30, 6, 3, '#243050')
  p.rect(2, 8, 8, 2, '#2c3c64')
  p.shape((x, y) => {
    const d = Math.hypot(x + 0.5 - 6, y + 0.5 - 5)
    if (d > 4.2) return null
    return d < 2 && x < 6 ? '#ffffff' : y > 6 ? '#dcdcd4' : '#f6f6f0'
  }, 0, 0, 12, 10)
  p.outline(OUTLINE)
  return p.toSprite({ ay: 33 })
}

function sign(): Sprite {
  const p = new Painter(16, 16)
  p.rect(3, 9, 2, 6, '#5a4a3a')
  p.rect(11, 9, 2, 6, '#5a4a3a')
  p.rect(1, 1, 14, 9, '#8a8e96')
  p.rect(2, 2, 12, 7, '#b8bcc4')
  p.hline(2, 2, 12, '#d8dce2')
  for (let i = 0; i < 2; i++) p.hline(4, 4 + i * 2, 8, '#6a6e76')
  p.outline(OUTLINE)
  return p.toSprite()
}

function bench(): Sprite {
  const p = new Painter(16, 14)
  p.rect(1, 2, 14, 4, '#bc6053')
  p.hline(1, 2, 14, '#d88070')
  p.rect(1, 7, 14, 3, '#a14944')
  p.hline(1, 9, 14, '#6a2a24')
  p.rect(2, 10, 2, 3, '#3d3d2a')
  p.rect(12, 10, 2, 3, '#3d3d2a')
  p.outline(OUTLINE)
  return p.toSprite()
}

function hedge(): Sprite {
  const w = 16, h = 14
  return spriteFromPixels(w, h, shade(w, h, ellipses([[8, 8, 7, 5.5], [5, 6, 4, 4], [11, 6, 4, 4]]), {
    tones: ['#2e7a36', '#48a044', '#6cc24e', '#98e070'], outline: '#1c4a24',
  }), 8, 13)
}

function fenceH(): Sprite {
  const p = new Painter(16, 12)
  p.rect(0, 4, 16, 2, '#d7d7b9')
  p.rect(0, 8, 16, 2, '#b8b89a')
  for (const x of [2, 7, 12]) {
    p.rect(x, 1, 3, 10, '#e8e8d0')
    p.vline(x + 2, 1, 10, '#a1a18d')
    p.set(x + 1, 0, '#e8e8d0')
  }
  p.outline('#60606b')
  return p.toSprite()
}

function fenceV(): Sprite {
  const p = new Painter(6, 14)
  p.rect(1, 1, 4, 12, '#e8e8d0')
  p.vline(4, 1, 12, '#a1a18d')
  p.set(2, 0, '#e8e8d0')
  p.outline('#60606b')
  return p.toSprite()
}

function spray(): Sprite {
  const p = new Painter(14, 22)
  p.shape((x, y) => {
    const spread = 1 + (y / 21) * 5
    const dx = Math.abs(x + 0.5 - 7)
    if (dx > spread) return null
    if (y < 3) return '#ffffff'
    return dx < spread - 1.5 ? '#d8f4ff' : '#8fd8f0'
  })
  return p.toSprite({ castShadow: false })
}

export function buildTownProps(): Record<TownPropKind, Sprite> {
  return { lamp: lamp(), sign: sign(), bench: bench(), hedge: hedge(), fenceH: fenceH(), fenceV: fenceV(), spray: spray() }
}
