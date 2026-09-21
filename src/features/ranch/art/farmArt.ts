// Farm props drawn in code — Rancho
//
// The small things that make the place feel looked after: hay, troughs, berry
// plants, sunflowers, a scarecrow, crates, log seats, the campfire, reeds and
// flower pots. Each is a few dozen pixels in the handheld 3/4 view.

import { Painter } from '../../wildlands/engine/painter'
import type { Sprite } from '../../wildlands/engine/sprite'

const WOOD = { outline: '#3b2412', dark: '#6e4524', mid: '#96643a', light: '#be8650', top: '#dcaa72' }
const HAY = { outline: '#6e5018', dark: '#b88a2c', mid: '#d6ab44', light: '#ecc862', top: '#f6de8c' }
const LEAF = { dark: '#2f6b35', mid: '#3f8a3f', light: '#5aab4c', hi: '#86cf64' }

function disc(p: Painter, cx: number, cy: number, r: number, color: string | ((x: number, y: number) => string)): void {
  p.shape((x, y) => {
    const d = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2
    if (d > r * r) return null
    return typeof color === 'string' ? color : color(x, y)
  })
}

function bale(p: Painter, x: number, y: number, w: number, h: number): void {
  p.rect(x, y, w, 4, HAY.top)
  p.hline(x, y + 3, w, HAY.light)
  p.rect(x, y + 4, w, h - 4, HAY.mid)
  for (let yy = y + 5; yy < y + h; yy += 2) {
    for (let xx = x + ((yy >> 1) % 3); xx < x + w; xx += 3) p.set(xx, yy, HAY.light)
  }
  p.hline(x, y + h - 1, w, HAY.dark)
  for (const tx of [x + Math.round(w * 0.28), x + Math.round(w * 0.68)]) {
    p.vline(tx, y, h, '#8a5a2a')
  }
}

export function buildHay(): Sprite {
  const p = new Painter(18, 15)
  bale(p, 1, 2, 16, 12)
  p.outline(HAY.outline)
  return p.toSprite({ ax: 9, ay: 14 })
}

export function buildHayStack(): Sprite {
  const p = new Painter(34, 24)
  bale(p, 1, 11, 16, 12)
  bale(p, 17, 11, 16, 12)
  bale(p, 9, 1, 16, 11)
  p.outline(HAY.outline)
  return p.toSprite({ ax: 17, ay: 23 })
}

export function buildTrough(): Sprite {
  const p = new Painter(32, 15)
  p.rect(2, 3, 28, 3, WOOD.top)
  p.rect(4, 4, 24, 2, '#4d93e3')
  p.hline(6, 4, 8, '#8cc2f5')
  p.rect(2, 6, 28, 7, WOOD.mid)
  for (let x = 2; x < 30; x += 7) p.vline(x, 6, 7, WOOD.dark)
  p.hline(2, 9, 28, WOOD.light)
  p.rect(3, 13, 3, 2, WOOD.dark)
  p.rect(26, 13, 3, 2, WOOD.dark)
  p.outline(WOOD.outline)
  return p.toSprite({ ax: 16, ay: 14 })
}

/** Oran (blue), Pecha (pink), Cheri (red) and Sitrus (yellow) berry plants. */
const BERRIES = ['#3d6fe0', '#f07aa8', '#e03a3a', '#f0c83a']

export function buildBerryPlant(variant: number): Sprite {
  const p = new Painter(16, 18)
  p.rect(7, 12, 2, 6, WOOD.dark)
  disc(p, 8, 9, 6.5, (x, y) => ((x + y) % 5 === 0 ? LEAF.hi : x < 7 && y < 9 ? LEAF.light : LEAF.mid))
  disc(p, 4.5, 11, 3.5, LEAF.mid)
  disc(p, 11.5, 11, 3.5, LEAF.dark)
  const berry = BERRIES[variant % BERRIES.length]
  for (const [bx, by] of [[5, 7], [10, 6], [8, 11], [12, 10], [4, 12]]) {
    p.rect(bx, by, 2, 2, berry)
    p.set(bx, by, '#ffffff')
  }
  p.outline('#1f3d20')
  return p.toSprite({ ax: 8, ay: 17 })
}

export function buildSunflower(): Sprite {
  const p = new Painter(14, 28)
  p.rect(6, 10, 2, 18, LEAF.mid)
  p.vline(6, 10, 18, LEAF.light)
  p.rect(2, 17, 4, 2, LEAF.light)
  p.rect(8, 20, 4, 2, LEAF.mid)
  disc(p, 7, 6, 6, (x, y) => ((x + y) % 2 === 0 ? '#f6d23c' : '#eab52a'))
  disc(p, 7, 6, 2.6, (x, y) => ((x + y) % 2 === 0 ? '#7a4a1c' : '#5c3614'))
  p.outline('#3a3010')
  return p.toSprite({ ax: 7, ay: 27 })
}

export function buildScarecrow(): Sprite {
  const p = new Painter(22, 32)
  p.rect(10, 12, 2, 20, WOOD.mid)
  p.rect(1, 13, 20, 2, WOOD.mid)
  // Plaid shirt.
  p.shape((x, y) => (x >= 6 && x <= 15 && y >= 11 && y <= 21 ? ((x >> 1) + (y >> 1)) % 2 === 0 ? '#c8403a' : '#9a2e2a' : null))
  p.rect(2, 12, 4, 4, '#c8403a')
  p.rect(16, 12, 4, 4, '#9a2e2a')
  for (const x of [1, 20]) p.vline(x, 13, 4, HAY.light)
  p.rect(7, 22, 8, 2, '#4a5aa0')
  // Burlap head and straw hat.
  disc(p, 11, 7.5, 3.8, '#e6d2a8')
  p.set(9, 7, '#3b2412')
  p.set(13, 7, '#3b2412')
  p.hline(10, 9, 3, '#9a6a40')
  p.rect(3, 4, 16, 2, HAY.mid)
  p.rect(6, 0, 10, 4, HAY.light)
  p.hline(6, 3, 10, '#c8403a')
  p.outline('#2a1a10')
  return p.toSprite({ ax: 11, ay: 31 })
}

export function buildCrate(variant: number): Sprite {
  const p = new Painter(16, 16)
  const tone = variant % 2 === 0 ? WOOD : { ...WOOD, mid: '#a8743f', light: '#c9955a', top: '#e2b784' }
  p.rect(1, 1, 14, 4, tone.top)
  p.rect(1, 5, 14, 10, tone.mid)
  p.frame(1, 5, 14, 10, tone.dark)
  for (let t = 0; t < 10; t++) p.set(2 + Math.round(t * 1.2), 6 + t * 0.8, tone.light)
  p.hline(1, 4, 14, tone.dark)
  p.outline(WOOD.outline)
  return p.toSprite({ ax: 8, ay: 15 })
}

/** Variant 0: a log lying east–west; 1: a stump seat. */
export function buildLogSeat(variant: number): Sprite {
  if (variant === 0) {
    const p = new Painter(24, 12)
    p.rect(2, 2, 18, 9, WOOD.mid)
    p.hline(2, 2, 18, WOOD.light)
    p.hline(2, 10, 18, WOOD.dark)
    for (let x = 4; x < 20; x += 5) p.vline(x, 4, 5, WOOD.dark)
    disc(p, 20, 6.5, 4.5, (x, y) => (Math.hypot(x + 0.5 - 20, y + 0.5 - 6.5) % 2 < 1 ? '#d9b37a' : '#b98c54'))
    p.outline(WOOD.outline)
    return p.toSprite({ ax: 12, ay: 11 })
  }
  const p = new Painter(16, 14)
  p.rect(2, 5, 12, 8, WOOD.mid)
  for (let x = 3; x < 14; x += 3) p.vline(x, 7, 6, WOOD.dark)
  p.shape((x, y) => {
    const d = ((x + 0.5 - 8) / 6) ** 2 + ((y + 0.5 - 5) / 3) ** 2
    if (d > 1) return null
    return Math.floor(d * 3) % 2 === 0 ? '#d9b37a' : '#b98c54'
  })
  p.outline(WOOD.outline)
  return p.toSprite({ ax: 8, ay: 13 })
}

/** Two frames of a crackling campfire inside a ring of stones. */
export function buildCampfire(): Sprite[] {
  return [0, 1].map(frame => {
    const p = new Painter(24, 24)
    // Stone ring.
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2
      const sx = Math.round(12 + Math.cos(a) * 9)
      const sy = Math.round(18 + Math.sin(a) * 4)
      p.rect(sx - 1, sy - 1, 3, 2, '#8f95a0')
      p.set(sx - 1, sy - 1, '#c3c8d0')
    }
    // Crossed logs.
    for (let t = 0; t < 10; t++) {
      p.rect(7 + t, 15 + Math.round(t * 0.3), 2, 2, WOOD.dark)
      p.rect(16 - t, 15 + Math.round(t * 0.3), 2, 2, WOOD.mid)
    }
    // Flames.
    const sway = frame === 0 ? 0 : 1
    p.shape((x, y) => {
      const cx = 12 + (y < 10 ? sway : 0)
      const w = (y - 3) * 0.55
      if (y < 4 || y > 16 || Math.abs(x + 0.5 - cx) > w) return null
      const core = Math.abs(x + 0.5 - cx) < w * 0.45 && y > 9
      return core ? '#fff2b0' : y < 9 ? '#f0802c' : '#f6c23a'
    })
    if (frame === 1) {
      p.set(8, 7, '#f6c23a')
      p.set(16, 5, '#f0802c')
    } else {
      p.set(15, 8, '#f6c23a')
      p.set(9, 5, '#f0802c')
    }
    p.outline('#3a2016')
    return p.toSprite({ ax: 12, ay: 21 })
  })
}

export function buildReeds(): Sprite {
  const p = new Painter(12, 18)
  for (const [x, top] of [[2, 5], [5, 2], [8, 4], [10, 8]]) {
    p.vline(x, top, 18 - top, LEAF.dark)
    p.vline(x + 1, top + 3, 15 - top, LEAF.mid)
    if (top < 7) p.rect(x, top - 3, 2, 4, '#7a4a24')
  }
  return p.toSprite({ ax: 6, ay: 17 })
}

export function buildFlowerpot(variant: number): Sprite {
  const p = new Painter(14, 16)
  const petals = variant % 2 === 0 ? ['#f07aa8', '#fbd0e0'] : ['#f6d23c', '#fff4b0']
  p.rect(3, 9, 8, 6, '#c86a3c')
  p.hline(2, 9, 10, '#e08a58')
  p.hline(3, 14, 8, '#8c4424')
  disc(p, 7, 6, 4.5, LEAF.mid)
  for (const [fx, fy] of [[4, 4], [8, 3], [10, 6], [6, 7]]) {
    p.rect(fx, fy, 2, 2, petals[0])
    p.set(fx, fy, petals[1])
  }
  p.outline('#2a1a10')
  return p.toSprite({ ax: 7, ay: 15 })
}

export function buildBasket(): Sprite {
  const p = new Painter(16, 14)
  p.shape((x, y) => {
    const d = ((x + 0.5 - 8) / 5.5) ** 2 + ((y + 0.5 - 5) / 4.5) ** 2
    return d <= 1 && d >= 0.62 && y < 6 ? WOOD.mid : null
  })
  p.rect(2, 6, 12, 7, '#c9955a')
  for (let x = 3; x < 14; x += 2) p.vline(x, 7, 5, '#a8743f')
  p.rect(3, 5, 10, 2, '#d8484a')
  p.set(5, 5, '#ffffff')
  p.set(9, 5, '#ffffff')
  p.outline(WOOD.outline)
  return p.toSprite({ ax: 8, ay: 13 })
}
