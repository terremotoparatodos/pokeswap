// Flat ground details — Rancho
//
// Things that lie on the ground and never cover anyone: flower beds, furrows,
// the dock, a rowboat, the picnic blanket, the Poké Ball mosaic of the plaza,
// stepping stones and lily pads. They are painted once into the baked ground
// chunks, so they cost nothing per frame. Patterns hash world coordinates, so
// a decal split across two chunks joins seamlessly.

import { hash2 } from '../../wildlands/engine/noise'
import type { DecalDef } from '../world/ranchLayout'

/** Paints one world pixel. */
export type PixelSink = (x: number, y: number, color: string) => void

const TILE = 16

const BED_THEMES: [string, string][] = [
  ['#e0403c', '#f8f0e8'],
  ['#f6c73a', '#f08a2c'],
  ['#f07aa8', '#a860c8'],
  ['#4a7ae0', '#f8f0e8'],
  ['#e0403c', '#f6c73a'],
  ['#f8f0e8', '#f07aa8'],
]

function flowerBed(px: PixelSink, x0: number, y0: number, w: number, h: number, variant: number): void {
  const [a, b] = BED_THEMES[variant % BED_THEMES.length]
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const edge = x < x0 + 2 || x >= x0 + w - 2 || y < y0 + 2 || y >= y0 + h - 2
      if (edge) {
        const outer = x === x0 || x === x0 + w - 1 || y === y0 || y === y0 + h - 1
        px(x, y, outer ? '#4a2c14' : y === y0 + 1 ? '#c28a55' : '#96643a')
        continue
      }
      px(x, y, hash2(x, y, 5) < 0.2 ? '#5a3a22' : '#6e4a2c')
    }
  }
  // Flowers on a staggered 5 px lattice.
  for (let fy = y0 + 4; fy < y0 + h - 4; fy += 5) {
    const row = Math.round((fy - y0) / 5)
    for (let fx = x0 + 4 + (row % 2) * 2; fx < x0 + w - 4; fx += 5) {
      const color = hash2(fx, fy, 7) < 0.5 ? a : b
      px(fx, fy + 2, '#3f8a3f')
      px(fx + 1, fy + 2, '#5aab4c')
      px(fx, fy - 1, color)
      px(fx - 1, fy, color)
      px(fx + 1, fy, color)
      px(fx, fy + 1, color)
      px(fx, fy, '#f6e27a')
    }
  }
}

function soil(px: PixelSink, x0: number, y0: number, w: number, h: number): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const outer = x === x0 || x === x0 + w - 1 || y === y0 || y === y0 + h - 1
      const furrow = (y - y0) % 4
      px(x, y, outer ? '#4a2c14' : furrow === 0 ? '#8a5e38' : furrow === 3 ? '#4f331c' : hash2(x, y, 9) < 0.15 ? '#5a3a22' : '#6b4629')
    }
  }
}

function dock(px: PixelSink, x0: number, y0: number, w: number, h: number): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const seam = (y - y0) % 4 === 3
      const side = x === x0 || x === x0 + w - 1
      px(x, y, side ? '#6e4524' : seam ? '#8d5f33' : hash2(x, y, 11) < 0.1 ? '#b98a52' : '#c9955a')
    }
  }
  for (const [x, y] of [[x0, y0], [x0 + w - 3, y0], [x0, y0 + h / 2], [x0 + w - 3, y0 + h / 2]]) {
    for (let k = 0; k < 9; k++) px(x + (k % 3), y + Math.floor(k / 3), k === 0 ? '#9a6a3a' : '#4a2c14')
  }
  // Shade on the water beside the planks.
  for (let y = y0 + 1; y < y0 + h; y++) {
    px(x0 + w, y, 'rgba(10, 30, 80, 0.35)')
    px(x0 + w + 1, y, 'rgba(10, 30, 80, 0.18)')
  }
}

function boat(px: PixelSink, x0: number, y0: number, w: number, h: number): void {
  const cx = x0 + w / 2
  const cy = y0 + h / 2
  const rx = 6.5
  const ry = h / 2 - 3
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2
      if (d > 1.12) continue
      if (d > 1) px(x, y, '#3b2412')
      else if (d > 0.62) px(x, y, x < cx ? '#b98a52' : '#8d5f33')
      else px(x, y, (y - y0) % 7 === 0 ? '#6e4524' : '#a87a48')
    }
  }
  for (let y = Math.round(cy - ry); y < cy + ry; y++) px(Math.round(cx + rx + 1), y, 'rgba(10, 30, 80, 0.3)')
}

function blanket(px: PixelSink, x0: number, y0: number, w: number, h: number): void {
  for (let y = y0 + 2; y < y0 + h - 2; y++) {
    for (let x = x0 + 2; x < x0 + w - 2; x++) {
      const edge = x === x0 + 2 || x === x0 + w - 3 || y === y0 + 2 || y === y0 + h - 3
      const check = (Math.floor((x - x0) / 4) + Math.floor((y - y0) / 4)) % 2 === 0
      px(x, y, edge ? '#9c2c2c' : check ? '#d8484a' : '#f6ece0')
    }
  }
}

function mosaic(px: PixelSink, x0: number, y0: number, w: number, h: number): void {
  const cx = x0 + w / 2
  const cy = y0 + h / 2
  const r = Math.min(w, h) / 2 - 2
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      const d = Math.hypot(dx, dy)
      if (d > r + 2) continue
      const grout = (x - x0) % 6 === 0 || (y - y0) % 6 === 0
      let c: string
      if (d > r) c = '#8f95a0'
      else if (Math.abs(dy) < 2) c = '#2c2c34'
      else if (d < 5) c = d < 3.5 ? '#f6f2ea' : '#2c2c34'
      else if (dy < 0) c = grout ? '#b83434' : dx < -4 && dy < -6 ? '#ec6a62' : '#d84440'
      else c = grout ? '#cfc8bc' : '#f0ebe0'
      px(x, y, c)
    }
  }
}

function doormat(px: PixelSink, x0: number, y0: number): void {
  for (let y = y0 + 4; y < y0 + 12; y++) {
    for (let x = x0 + 2; x < x0 + 14; x++) {
      const edge = x === x0 + 2 || x === x0 + 13 || y === y0 + 4 || y === y0 + 11
      px(x, y, edge ? '#6e4524' : y === y0 + 7 || y === y0 + 8 ? '#c8403a' : '#a8743f')
    }
  }
}

function stones(px: PixelSink, x0: number, y0: number): void {
  for (const [sx, sy, rx, ry] of [[4, 5, 3, 2], [11, 4, 2.5, 2], [8, 11, 3.5, 2.2]]) {
    for (let y = -3; y <= 3; y++) {
      for (let x = -4; x <= 4; x++) {
        const d = (x / rx) ** 2 + (y / ry) ** 2
        if (d <= 1) px(x0 + sx + x, y0 + sy + y, y < 0 ? '#c3c8d0' : '#9aa0aa')
      }
    }
  }
}

export function paintDecal(px: PixelSink, decal: DecalDef): void {
  const x0 = decal.at.x0 * TILE
  const y0 = decal.at.y0 * TILE
  const w = (decal.at.x1 - decal.at.x0 + 1) * TILE
  const h = (decal.at.y1 - decal.at.y0 + 1) * TILE
  switch (decal.kind) {
    case 'flowerBed': return flowerBed(px, x0, y0, w, h, decal.variant ?? 0)
    case 'soil': return soil(px, x0, y0, w, h)
    case 'dock': return dock(px, x0, y0, w, h)
    case 'boat': return boat(px, x0, y0, w, h)
    case 'blanket': return blanket(px, x0, y0, w, h)
    case 'mosaic': return mosaic(px, x0, y0, w, h)
    case 'doormat': return doormat(px, x0, y0)
    case 'stones': return stones(px, x0, y0)
  }
}

/** A lily pad on a water tile; some carry a flower. */
export function paintLily(px: PixelSink, tx: number, ty: number, seed: number): void {
  const cx = tx * TILE + 5 + Math.floor(seed * 7)
  const cy = ty * TILE + 5 + Math.floor(seed * 13) % 7
  for (let y = -4; y <= 4; y++) {
    for (let x = -5; x <= 5; x++) {
      const d = (x / 5) ** 2 + (y / 4) ** 2
      if (d > 1 || (x > 0 && Math.abs(y) <= x * 0.35)) continue
      px(cx + x, cy + y, d > 0.7 ? '#2f7a3a' : y < 0 ? '#6cc255' : '#4ea846')
    }
  }
  if (seed > 0.65) {
    px(cx - 1, cy - 1, '#f5a8c8')
    px(cx, cy - 2, '#f5a8c8')
    px(cx + 1, cy - 1, '#f5a8c8')
    px(cx, cy - 1, '#fff4b0')
  }
}
