// Town buildings — WildLands prototype
//
// Every building is painted in code, sized to its footprint (tiles × 16 px).
// The upper part of each sprite is the roof seen from above (marked as
// `flatTop` so the renderer squashes it with the camera tilt) and the lower
// part is the upright façade. Designs echo Ciudad Corazón's landmarks with
// this engine's palette rules: short ramps, a light top edge, a dark eave and
// a 1px outline.

import { inOctagon, Painter } from './painter'
import type { Sprite } from './sprite'

export type BuildingStyle =
  | 'pokecenter' | 'house' | 'apartment' | 'gym' | 'mart' | 'redhouse'
  | 'cathedral' | 'contest' | 'amityGate' | 'routeGate'

export interface BuildingSpec {
  style: BuildingStyle
  /** Footprint in tiles. */
  w: number
  d: number
  /** Door side for route gates. */
  door?: 'left' | 'right' | 'none'
}

const OUTLINE = '#2a2230'
const T = 16

function finish(p: Painter, wallH: number): Sprite {
  p.outline(OUTLINE)
  return p.toSprite({ flatTop: p.h - wallH, castShadow: false })
}

/** Picks a colour from a light→dark ramp by t in [0, 1]. */
function ramp(tones: readonly string[], t: number): string {
  return tones[Math.max(0, Math.min(tones.length - 1, Math.floor(t * tones.length)))]
}

/** Glass window with frame, highlight and sill. */
function glassWindow(p: Painter, x: number, y: number, w: number, h: number, glass = '#8fc8e8', frame = '#3c3a48'): void {
  p.rect(x, y, w, h, frame)
  p.rect(x + 1, y + 1, w - 2, h - 2, glass)
  p.hline(x + 1, y + 1, w - 2, '#d8f0ff')
  p.set(x + 1, y + 2, '#d8f0ff')
  p.hline(x - 1, y + h, w + 2, '#d8d0c0')
  p.hline(x - 1, y + h + 1, w + 2, '#8a8070')
}

/** Automatic glass double door with frame and floor mat. */
function glassDoor(p: Painter, cx: number, w: number, h: number): void {
  const x = Math.round(cx - w / 2)
  const y = p.h - h
  p.rect(x - 2, y - 2, w + 4, h + 2, '#4a4a56')
  p.rect(x, y, w, h, '#58b0d8')
  p.rect(x, y, w, 4, '#a8e4f4')
  p.rect(x + 1, y + 5, 2, h - 7, '#8ad0ec')
  p.vline(Math.round(cx), y, h, '#2f6c90')
  p.rect(x - 2, p.h - 2, w + 4, 2, '#3a3a44')
}

/** Wooden door with frame, knob and a stone step. */
function woodDoor(p: Painter, cx: number, w: number, h: number, color = '#3a6a78', light = '#5a96a4'): void {
  const x = Math.round(cx - w / 2)
  const y = p.h - h
  p.rect(x - 1, y - 1, w + 2, h + 1, '#2a2a30')
  p.rect(x, y, w, h - 2, color)
  p.hline(x, y, w, light)
  p.rect(x + 2, y + 3, w - 4, 4, light)
  p.set(x + w - 3, y + Math.round(h / 2), '#e8c060')
  p.rect(x - 2, p.h - 2, w + 4, 2, '#b8b0a0')
}

/** Upright wall block with top trim, side shading and a darker footing. */
function wall(p: Painter, y: number, h: number, base: string, dark: string, light: string, x0 = 1, x1 = p.w - 1): void {
  p.rect(x0, y, x1 - x0, h, base)
  p.hline(x0, y, x1 - x0, dark)
  p.hline(x0, y + 1, x1 - x0, light)
  p.rect(x0, y + h - 3, x1 - x0, 3, dark)
  p.vline(x0, y, h, light)
  p.vline(x1 - 1, y, h, dark)
}

/** Roof slab seen from above: light back edge, body, shaded front and a thick eave. */
function slab(p: Painter, x: number, y: number, w: number, h: number, tones: { light: string; base: string; dark: string; eave: string }): void {
  p.rect(x, y, w, h, tones.base)
  p.rect(x, y, w, 2, tones.light)
  p.dither(x, y + 2, w, 3, tones.base, tones.light, 0.4)
  p.rect(x, y, 2, h, tones.light)
  p.rect(x + w - 2, y, 2, h, tones.dark)
  p.dither(x, y + h - 9, w, 3, tones.base, tones.dark, 0.45)
  p.rect(x, y + h - 6, w, 6, tones.eave)
  p.hline(x, y + h - 6, w, tones.dark)
  p.hline(x, y + h - 1, w, OUTLINE)
}

/** Ball emblem: ring, band and centre button. */
function emblem(p: Painter, cx: number, cy: number, r: number, color = '#ffffff', band = true): void {
  p.shape((x, y) => {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
    if (d <= r && d >= r - 1.7) return color
    if (band && Math.abs(y + 0.5 - cy) < 0.9 && d <= r) return color
    return d <= 1.8 ? color : null
  }, cx - r - 1, cy - r - 1, cx + r + 2, cy + r + 2)
}

function pokecenter(s: BuildingSpec): Sprite {
  const p = new Painter(s.w * T, s.d * T)
  const wallH = 26
  const roofH = p.h - wallH
  const cx = p.w / 2
  // Main roof with chamfered back corners.
  p.shape((x, y) => {
    if (!inOctagon(x, y, cx, (roofH + 4) / 2, cx - 1, (roofH - 4) / 2, 7) || y >= roofH) return null
    return y < 7 ? '#f4b04c' : x < 4 ? '#f09a3a' : x > p.w - 5 ? '#c8641c' : '#e8862a'
  })
  p.dither(2, 7, p.w - 4, 3, '#e8862a', '#f4b04c', 0.35)
  p.rect(1, roofH - 10, p.w - 2, 10, '#b8561a')
  p.hline(1, roofH - 10, p.w - 2, '#d06c1c')
  p.hline(1, roofH - 1, p.w - 2, OUTLINE)
  // White "U" band with a red keyline, stopping at the hump.
  const band = (x: number, y: number, w: number, h: number) => {
    p.rect(x, y, w, h, '#ffffff')
  }
  band(7, 14, 2, roofH - 26)
  band(p.w - 9, 14, 2, roofH - 26)
  band(7, roofH - 14, 20, 2)
  band(p.w - 27, roofH - 14, 20, 2)
  p.vline(10, 14, roofH - 27, '#c83a10')
  p.vline(p.w - 11, 14, roofH - 27, '#c83a10')
  // Cylindrical hump across the middle of the roof.
  const hx0 = cx - 15
  const hx1 = cx + 15
  p.shape((x, y) => {
    const t = (x + 0.5 - hx0) / (hx1 - hx0)
    const top = 2 + Math.round((2 * t - 1) ** 2 * 3)
    const bottom = roofH - 20 + Math.round(Math.sin(t * Math.PI) * 6)
    if (y < top || y > bottom) return null
    if (y > bottom - 2) return '#a04a14'
    const tone = ramp(['#fbd07c', '#f6b04e', '#ee9838', '#e08028', '#c8641c'], t)
    return (x - hx0) % 5 === 0 && y > top + 1 ? '#d8741e' : tone
  }, hx0, 0, hx1, roofH)
  emblem(p, cx, roofH - 5, 5)
  // Façade
  wall(p, roofH, wallH, '#a8aeb6', '#5c6068', '#d4d8dc')
  for (const px of [1, p.w - 7]) {
    p.rect(px, roofH, 6, wallH, '#707684')
    p.vline(px + 1, roofH + 2, wallH - 4, '#9aa0ac')
  }
  glassWindow(p, 10, roofH + 6, 16, 9, '#a8e0ec')
  glassWindow(p, p.w - 26, roofH + 6, 16, 9, '#a8e0ec')
  p.rect(cx - 14, roofH + 2, 28, wallH - 2, '#5c6068')
  p.rect(cx - 15, roofH, 30, 5, '#e8862a')
  for (let x = cx - 15; x < cx + 15; x += 4) p.rect(x, roofH, 2, 5, '#ffffff')
  p.hline(cx - 15, roofH + 5, 30, '#8a3a10')
  glassDoor(p, cx, 16, 18)
  return finish(p, wallH)
}

function house(s: BuildingSpec): Sprite {
  const p = new Painter(s.w * T, s.d * T)
  const wallH = 30
  const roofH = p.h - wallH
  const cx = p.w / 2
  // Hip roof: a ridge line across the middle, slopes shaded towards the eaves.
  p.shape((x, y) => {
    if (y >= roofH || x < 1 || x >= p.w - 1 || y < 3) return null
    const side = Math.min(x - 1, p.w - 2 - x)
    if (side < 3) return x < cx ? '#78d080' : '#3a8a44'
    if (y > roofH - 7) return '#3a8a44'
    const ridge = Math.round(roofH * 0.42)
    if (y === ridge) return '#9ae4a0'
    const tone = y < ridge ? ramp(['#78d080', '#6cc874', '#62bc6a'], (y - 3) / ridge) : ramp(['#58b060', '#50a458', '#46984e'], (y - ridge) / (roofH - ridge))
    return (y + (x % 2)) % 4 === 0 ? '#4fa257' : tone
  })
  p.hline(1, roofH - 7, p.w - 2, '#2f7438')
  // Chimney
  p.rect(p.w - 18, 0, 8, 12, '#8a5a3a')
  p.rect(p.w - 18, 0, 8, 3, '#b07a52')
  p.rect(p.w - 17, 1, 6, 1, '#3a2a22')
  wall(p, roofH, wallH, '#b4a07a', '#766448', '#d8c49c')
  p.dither(2, roofH + 2, p.w - 4, wallH - 5, '#b4a07a', '#aa966e', 0.2)
  for (const wx of [7, p.w - 21]) {
    glassWindow(p, wx, roofH + 7, 14, 10, '#8a8ad8')
    p.rect(wx - 3, roofH + 7, 3, 10, '#4e8a54')
    p.rect(wx + 14, roofH + 7, 3, 10, '#4e8a54')
    p.rect(wx - 1, roofH + 19, 16, 3, '#8a5a3a')
    for (let i = 0; i < 4; i++) p.set(wx + 1 + i * 4, roofH + 18, i % 2 ? '#f070a0' : '#f8d040')
  }
  woodDoor(p, cx, 12, 18)
  return finish(p, wallH)
}

function apartment(s: BuildingSpec): Sprite {
  const p = new Painter(s.w * T, s.d * T)
  const wallH = 50
  const roofH = p.h - wallH
  const cx = p.w / 2
  slab(p, 1, 2, p.w - 2, roofH, { light: '#9a6468', base: '#7a4a4e', dark: '#5e383e', eave: '#4c3036' })
  for (let y = 7; y < roofH - 9; y += 4) {
    for (let x = 3; x < p.w - 3; x++) if ((x + (y >> 2)) % 6 !== 0) p.set(x, y, '#6c4046')
  }
  // Front gable pushing out of the roof over the façade.
  p.shape((x, y) => {
    const t = (y - (roofH - 24)) / 28
    if (t < 0 || t > 1) return null
    const half = t * 24
    const dx = Math.abs(x + 0.5 - cx)
    if (dx > half) return null
    if (dx > half - 2) return '#3a2a30'
    return x < cx ? '#9a6468' : '#6c4046'
  }, 0, roofH - 24, p.w, roofH + 4)
  p.rect(cx - 5, roofH - 5, 10, 7, '#c8c0b0')
  for (let i = 0; i < 3; i++) p.hline(cx - 4, roofH - 4 + i * 2, 8, '#7a7468')
  wall(p, roofH + 3, wallH - 3, '#746c5e', '#484038', '#948a78')
  for (let y = roofH + 6; y < p.h - 4; y += 4) {
    for (let x = 3 + ((y >> 2) % 2) * 3; x < p.w - 3; x += 6) p.set(x, y, '#645c50')
  }
  p.rect(1, roofH + 3, 3, wallH - 3, '#8a806e')
  p.rect(p.w - 4, roofH + 3, 3, wallH - 3, '#5a5248')
  for (let row = 0; row < 2; row++) {
    for (const wx of [8, cx - 6, p.w - 20]) {
      const wy = roofH + 9 + row * 16
      glassWindow(p, wx, wy, 12, 9, '#6a78c8')
      p.rect(wx - 1, wy + 9, 14, 3, '#58b050')
      p.hline(wx - 1, wy + 9, 14, '#8ada70')
      p.set(wx + 3, wy + 9, '#f070a0')
      p.set(wx + 8, wy + 9, '#f8d040')
    }
  }
  woodDoor(p, cx, 14, 13, '#2f6a78')
  return finish(p, wallH)
}

function gym(s: BuildingSpec): Sprite {
  const p = new Painter(s.w * T, s.d * T)
  const wallH = 34
  const roofH = p.h - wallH
  const cx = p.w / 2
  slab(p, 1, 2, p.w - 2, roofH - 2, { light: '#d09a64', base: '#ae794b', dark: '#865a34', eave: '#6c492a' })
  for (let x = 6; x < p.w - 6; x += 5) p.vline(x, 5, roofH - 16, '#9e6c40')
  // Thick white arched ribs sweeping in from each side, with a grey underside.
  for (const [y0, dir] of [[9, -1], [27, -1], [9, 1], [27, 1]] as const) {
    p.shape((x, y) => {
      const u = dir < 0 ? x - 4 : p.w - 5 - x
      if (u < 0 || u > 38) return null
      const curve = y0 + Math.round((u / 38) ** 1.6 * 11)
      const thick = 4 - Math.floor(u / 16)
      if (y >= curve && y < curve + thick) return y === curve ? '#ffffff' : '#e8e0e4'
      if (y === curve + thick) return '#6c6468'
      return null
    }, 0, y0, p.w, y0 + 18)
  }
  // Brown dome canopy over the entrance with the half-ball badge.
  p.shape((x, y) => {
    const nx = (x + 0.5 - cx) / 24
    const ny = (y + 0.5 - roofH) / 14
    const d = nx * nx + ny * ny
    if (d > 1) return null
    if (y >= roofH + 8) return null
    return d > 0.8 ? '#5a3a20' : y < roofH - 6 ? '#b07a48' : x < cx ? '#9a6638' : '#7e5028'
  }, 0, roofH - 14, p.w, roofH + 9)
  p.shape((x, y) => {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - (roofH + 2))
    return y <= roofH + 2 && d <= 7.5 && d >= 4.8 ? '#ffffff' : null
  }, cx - 9, roofH - 7, cx + 9, roofH + 4)
  wall(p, roofH, wallH, '#94949a', '#5a5a60', '#babac0')
  for (const wx of [8, p.w - 36]) {
    for (let i = 0; i < 3; i++) glassWindow(p, wx + i * 10, roofH + 8, 8, 8, '#8ec8f0')
    p.rect(wx, roofH + 20, 28, 9, '#6a6a70')
    p.frame(wx, roofH + 20, 28, 9, '#48484e')
    for (let i = 0; i < 3; i++) p.hline(wx + 3 + i * 8, roofH + 24, 6, '#b8b0b0')
  }
  glassDoor(p, cx, 18, 22)
  return finish(p, wallH)
}

function mart(s: BuildingSpec): Sprite {
  const p = new Painter(s.w * T, s.d * T)
  const wallH = 22
  const roofH = p.h - wallH
  const cx = p.w / 2
  p.shape((x, y) => {
    if (!inOctagon(x, y, cx, roofH / 2 + 1, cx - 1, roofH / 2, 9) || y >= roofH) return null
    if (y > roofH - 6) return '#2f3d9e'
    if (inOctagon(x, y, cx, roofH / 2, cx - 9, roofH / 2 - 8, 6)) return y < roofH / 2 - 3 ? '#d0ecfa' : '#94c9ed'
    return y < 6 || x < 5 ? '#7a98e6' : x > p.w - 6 ? '#3d55c0' : '#496cd3'
  })
  emblem(p, cx, roofH / 2 + 1, 5, '#2f4cb8')
  wall(p, roofH, wallH, '#b8c0d0', '#6a7284', '#dce2ec')
  p.rect(2, roofH + 3, p.w - 4, 4, '#496cd3')
  for (let x = 2; x < p.w - 2; x += 4) p.rect(x, roofH + 3, 2, 4, '#ffffff')
  glassWindow(p, 6, roofH + 10, 12, 7, '#a8e0f4')
  glassDoor(p, cx + 8, 14, 13)
  return finish(p, wallH)
}

function redhouse(s: BuildingSpec): Sprite {
  const p = new Painter(s.w * T, s.d * T)
  const wallH = 36
  const roofH = p.h - wallH
  const cx = p.w / 2
  // Ridge runs front to back: the left slope catches light, the right is in shade.
  p.shape((x, y) => {
    if (y >= roofH || x < 1 || x >= p.w - 1) return null
    if (Math.abs(x + 0.5 - cx) < 1) return '#f4a080'
    if (y > roofH - 5) return '#8a3a28'
    const tile = (y % 5 === 0) || ((x + (y >> 2) * 3) % 7 === 0 && y % 5 !== 1)
    return x < cx ? (tile ? '#d85a40' : '#ec7658') : (tile ? '#9c4230' : '#bc553c')
  })
  // Front gable with trim and a round window.
  p.shape((x, y) => {
    const t = (y - (roofH - 18)) / 20
    if (t < 0 || t > 1) return null
    const half = 6 + t * 22
    const dx = Math.abs(x + 0.5 - cx)
    if (dx > half) return null
    if (dx > half - 2) return '#f6f2ea'
    return y % 3 === 0 ? '#bcac8e' : '#cebe9e'
  }, 0, roofH - 18, p.w, roofH + 2)
  p.shape((x, y) => {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - (roofH - 5))
    return d <= 4.5 ? (d > 3.2 ? '#f6f2ea' : y < roofH - 5 ? '#a8c8f0' : '#6a8ad0') : null
  }, cx - 6, roofH - 11, cx + 6, roofH + 1)
  wall(p, roofH + 2, wallH - 2, '#b8a888', '#706048', '#d8c8a4')
  for (const wx of [7, p.w - 20]) {
    glassWindow(p, wx, roofH + 9, 13, 11, '#6a8ad0')
    p.vline(wx + 6, roofH + 10, 9, '#3c3a48')
    p.hline(wx + 1, roofH + 14, 11, '#3c3a48')
  }
  woodDoor(p, cx, 12, 18, '#7a4a2a', '#a06a44')
  return finish(p, wallH)
}

function cathedral(s: BuildingSpec): Sprite {
  const p = new Painter(s.w * T, s.d * T)
  const wallH = 60
  const roofH = p.h - wallH
  const cx = p.w / 2
  // Stone terrace with a light rim and corner turrets.
  p.rect(5, 3, p.w - 10, roofH, '#848e86')
  p.dither(6, 5, p.w - 12, roofH - 4, '#848e86', '#78827a', 0.3)
  p.frame(5, 3, p.w - 10, roofH, '#b8c0b8')
  p.frame(6, 4, p.w - 12, roofH - 2, '#a4aca4')
  for (const [tx, ty] of [[5, 3], [p.w - 15, 3], [5, roofH - 10], [p.w - 15, roofH - 10]]) {
    p.rect(tx, ty, 10, 10, '#9aa29c')
    p.rect(tx, ty, 10, 2, '#c4ccc6')
    p.rect(tx + 8, ty, 2, 10, '#6c746e')
    p.rect(tx + 3, ty + 3, 4, 4, '#5a625c')
  }
  // Drum and striped dome with a lantern.
  p.rect(cx - 26, roofH - 14, 52, 12, '#dce2ea')
  p.hline(cx - 26, roofH - 3, 52, '#9aa2ac')
  const domeCy = roofH - 34
  p.shape((x, y) => {
    const nx = (x + 0.5 - cx) / 25
    const ny = (y + 0.5 - domeCy) / 24
    if (nx * nx + ny * ny > 1 || y > roofH - 8) return null
    const band = Math.floor((y - (domeCy - 24)) / 5) % 2
    if (nx < -0.45) return band ? '#6aa4de' : '#c4def4'
    if (nx > 0.5) return band ? '#2c5a98' : '#7aa8d8'
    return band ? '#3d7ac0' : '#a8cdef'
  }, 0, 0, p.w, roofH)
  p.rect(cx - 4, domeCy - 28, 8, 7, '#e8eef4')
  p.rect(cx - 4, domeCy - 28, 8, 2, '#ffffff')
  p.rect(cx + 2, domeCy - 28, 2, 7, '#a8b0bc')
  // Spires rising from the front corners.
  for (const sx of [12, p.w - 13]) {
    p.shape((x, y) => {
      const t = (y - (roofH - 26)) / 28
      if (t < 0 || t > 1) return null
      const half = 1 + t * 8
      const dx = x + 0.5 - sx
      if (Math.abs(dx) > half) return null
      return dx < 0 ? '#aab2ac' : '#6c746e'
    }, sx - 10, roofH - 26, sx + 11, roofH + 3)
  }
  // Façade: pilasters, lancet windows, rose window and a pointed doorway.
  wall(p, roofH + 2, wallH - 2, '#7c887e', '#4e5650', '#a8b0aa')
  for (const px of [2, 22, p.w - 25, p.w - 5]) {
    p.rect(px, roofH + 2, 3, wallH - 4, '#98a29a')
    p.vline(px + 2, roofH + 2, wallH - 4, '#5c645e')
  }
  const lancet = (lx: number, ly: number, h: number) => {
    p.rect(lx, ly + 2, 6, h - 2, '#2c3440')
    p.rect(lx + 1, ly + 1, 4, 1, '#2c3440')
    p.rect(lx + 2, ly, 2, 1, '#2c3440')
    p.rect(lx + 1, ly + 3, 2, h - 5, '#5a7aa8')
  }
  for (const lx of [9, p.w - 15]) {
    lancet(lx, roofH + 8, 16)
    lancet(lx, roofH + 32, 14)
  }
  p.shape((x, y) => {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - (roofH + 12))
    if (d > 7) return null
    if (d > 5.6) return '#c8d0c8'
    const a = Math.atan2(y + 0.5 - (roofH + 12), x + 0.5 - cx)
    return ['#d05a5a', '#f0c040', '#5a8ad0', '#60b060'][Math.floor(((a + Math.PI) / Math.PI) * 4) % 4]
  }, cx - 8, roofH + 4, cx + 8, roofH + 20)
  p.shape((x, y) => {
    const dx = Math.abs(x + 0.5 - cx)
    const top = p.h - 34
    if (y < top || dx > 14) return null
    const archY = top + (dx / 14) ** 2 * 12
    if (y < archY) return null
    if (dx > 11.5 || y < archY + 2.5) return '#b4bcb6'
    if (y > p.h - 5) return (y % 2) ? '#6a7278' : '#8a9298'
    return y < archY + 6 ? '#1e2228' : '#2c3036'
  }, 0, p.h - 34, p.w, p.h)
  return finish(p, wallH)
}

function contest(s: BuildingSpec): Sprite {
  const p = new Painter(s.w * T, s.d * T)
  const wallH = 34
  const roofH = p.h - wallH
  const cx = p.w / 2
  const inBody = (x: number, y: number) => inOctagon(x, y, cx, p.h / 2, cx - 1, p.h / 2 - 1, 34)
  // Roof: pastel skylight terrace at the back, stone ring around the dome.
  p.shape((x, y) => {
    if (!inBody(x, y) || y >= roofH) return null
    if (y < 20) return ['#f8dccc', '#bfe8ee', '#8cd0dc', '#f0c8c0'][Math.floor(y / 5) % 4]
    const block = (Math.floor(y / 5) + Math.floor(x / 10)) % 2
    return block ? '#a69676' : '#b2a282'
  })
  p.rect(cx - 12, 7, 24, 7, '#ecd29c')
  p.frame(cx - 12, 7, 24, 7, '#b09060')
  const domeCy = roofH - 6
  const rx = cx - 14
  const ry = roofH - 22
  // Rim ring
  p.shape((x, y) => {
    const nx = (x + 0.5 - cx) / (rx + 4)
    const ny = (y + 0.5 - domeCy) / (ry + 4)
    return nx * nx + ny * ny <= 1 && y < roofH ? '#8a7a5c' : null
  }, 0, 0, p.w, roofH)
  // Ribbed dome: soft alternating panels, lit from the left.
  p.shape((x, y) => {
    const nx = (x + 0.5 - cx) / rx
    const ny = (y + 0.5 - domeCy) / ry
    const d = nx * nx + ny * ny
    if (d > 1 || y >= roofH) return null
    const angle = Math.atan2(y + 0.5 - domeCy, x + 0.5 - cx)
    const panel = Math.floor(((angle + Math.PI) / Math.PI) * 12)
    const rib = Math.abs(((angle + Math.PI) / Math.PI) * 12 - Math.round(((angle + Math.PI) / Math.PI) * 12)) < 0.06
    if (rib) return '#b4b4ba'
    const lit = nx < -0.2 ? 2 : nx < 0.3 ? 1 : 0
    const tones = panel % 2 ? ['#d4d4d8', '#e8e8ec', '#f8f8fa'] : ['#c6c6cc', '#dcdce0', '#eeeef2']
    return d > 0.9 ? '#a8a8b0' : tones[lit]
  }, 0, 0, p.w, roofH)
  p.rect(cx - 5, domeCy - ry - 3, 10, 5, '#f4f4f8')
  p.frame(cx - 5, domeCy - ry - 3, 10, 5, '#9a9aa2')
  emblem(p, cx, roofH - 14, 6, '#ffffff', false)
  // Façade: stone band, pilasters, arched windows and the entrance.
  p.shape((x, y) => {
    if (!inBody(x, y) || y < roofH) return null
    const brick = (Math.floor(y / 4) + (Math.floor(x / 8) % 2)) % 2
    return brick ? '#6c604b' : '#7a6d54'
  }, 0, roofH, p.w, p.h)
  p.hline(10, roofH, p.w - 20, '#c0b090')
  p.hline(10, roofH + 1, p.w - 20, '#9a8a6c')
  for (let wx = 16; wx < p.w - 16; wx += 20) {
    if (Math.abs(wx + 5 - cx) < 18) continue
    p.rect(wx - 3, roofH + 2, 2, wallH - 4, '#8a7c60')
    p.rect(wx, roofH + 9, 10, 17, '#4e5c48')
    p.rect(wx + 1, roofH + 8, 8, 1, '#4e5c48')
    p.rect(wx + 3, roofH + 7, 4, 1, '#4e5c48')
    p.rect(wx + 1, roofH + 11, 3, 13, '#6a7a60')
  }
  p.rect(cx - 14, roofH + 3, 28, 5, '#d8c8a4')
  for (let x = cx - 14; x < cx + 14; x += 4) p.rect(x, roofH + 3, 2, 5, '#b8a47c')
  glassDoor(p, cx, 16, 20)
  return finish(p, wallH)
}

/** A small round statue creature: body, head, ears or crest and dot eyes. */
function statue(p: Painter, fx: number, baseY: number, base: string, dark: string, feature: 'ears' | 'crest' | 'tuft'): void {
  p.shape((x, y) => {
    const body = ((x + 0.5 - fx) / 9) ** 2 + ((y + 0.5 - (baseY - 7)) / 7) ** 2
    const head = ((x + 0.5 - fx) / 6.5) ** 2 + ((y + 0.5 - (baseY - 16)) / 6) ** 2
    if (body > 1 && head > 1) return null
    return x > fx + 3 ? dark : base
  }, fx - 10, baseY - 24, fx + 10, baseY)
  if (feature === 'ears') {
    for (const ex of [fx - 5, fx + 4]) p.rect(ex, baseY - 24, 2, 4, dark)
  } else if (feature === 'crest') {
    p.rect(fx - 1, baseY - 25, 3, 4, dark)
    p.rect(fx + 2, baseY - 24, 2, 2, base)
  } else {
    p.rect(fx - 2, baseY - 24, 4, 2, dark)
  }
  p.set(fx - 3, baseY - 17, '#2a2230')
  p.set(fx + 2, baseY - 17, '#2a2230')
  p.hline(fx - 1, baseY - 13, 2, dark)
}

function amityGate(s: BuildingSpec): Sprite {
  const p = new Painter(s.w * T, s.d * T)
  const wallH = 42
  const roofH = p.h - wallH
  const cx = p.w / 2
  const roofTop = 4
  const terrace = roofH - 30
  // Chevron-striped blue roof with a pink frame and a ridge cap.
  p.shape((x, y) => {
    if (x < 6 || x >= p.w - 6 || y < roofTop || y >= terrace) return null
    const band = Math.floor((y + Math.abs(x + 0.5 - cx) * 0.4) / 6) % 2
    const edge = x < 9 ? 1 : x > p.w - 10 ? -1 : 0
    if (band) return edge > 0 ? '#5aa2e0' : edge < 0 ? '#2c6cae' : '#3d86ca'
    return edge > 0 ? '#9ad0f0' : edge < 0 ? '#5aa0cc' : '#79bce5'
  })
  p.rect(4, roofTop - 2, p.w - 8, 3, '#f8d0dc')
  p.frame(4, roofTop - 2, p.w - 8, terrace - roofTop + 3, '#f2b8cc')
  p.frame(5, roofTop - 1, p.w - 10, terrace - roofTop + 1, '#e090b0')
  // Statue terrace with a scalloped pink trim.
  p.rect(4, terrace, p.w - 8, 28, '#f4d0b4')
  p.dither(4, terrace + 16, p.w - 8, 12, '#f4d0b4', '#e8bea0', 0.35)
  p.hline(4, terrace, p.w - 8, '#fde8d8')
  for (let x = 5; x < p.w - 6; x += 6) {
    p.rect(x, roofH - 4, 5, 2, '#f6a8c4')
    p.rect(x + 1, roofH - 2, 3, 1, '#f6a8c4')
  }
  statue(p, cx - 24, terrace + 25, '#f4d84a', '#c0a020', 'tuft')
  statue(p, cx, terrace + 24, '#f49a40', '#c0661a', 'crest')
  statue(p, cx + 24, terrace + 25, '#9a8ae0', '#6656b0', 'ears')
  // Façade: striped pillars, a deep entrance and wide stairs.
  wall(p, roofH, wallH, '#8a98ae', '#4c586c', '#b0bccc')
  for (const px of [3, p.w - 17]) {
    p.rect(px, roofH, 14, wallH, '#7888a0')
    for (let y = roofH + 2; y < p.h - 2; y += 4) p.hline(px, y, 14, '#5c6a82')
    p.vline(px, roofH, wallH, '#a4b2c6')
  }
  p.rect(cx - 18, roofH + 3, 36, 18, '#2c2c34')
  p.rect(cx - 16, roofH + 5, 32, 3, '#1c1c22')
  p.rect(cx - 16, roofH + 14, 32, 7, '#7a7a5a')
  p.hline(cx - 16, roofH + 14, 32, '#a4a47a')
  for (let i = 0; i < 4; i++) {
    const y = roofH + 22 + i * 5
    p.rect(cx - 18 + i, y, 36 - i * 2, 4, i % 2 ? '#9296a0' : '#b4b8c2')
    p.hline(cx - 18 + i, y + 3, 36 - i * 2, '#5a5e68')
  }
  return finish(p, wallH)
}

function routeGate(s: BuildingSpec): Sprite {
  const p = new Painter(s.w * T, s.d * T)
  const wallH = 30
  const roofH = p.h - wallH
  const cx = p.w / 2
  p.rect(2, 2, p.w - 4, roofH, '#b89080')
  p.rect(2, 2, p.w - 4, 2, '#d8b4a4')
  p.rect(p.w - 4, 2, 2, roofH, '#8a6a5c')
  p.rect(6, 6, p.w - 12, roofH - 12, '#6c79b0')
  for (let y = 9; y < roofH - 8; y += 6) p.rect(6, y, p.w - 12, 2, '#8686ca')
  // Raised skylight ridge and vents.
  p.rect(cx - 10, 8, 20, roofH - 18, '#9aa4d8')
  p.frame(cx - 10, 8, 20, roofH - 18, '#495573')
  for (let y = 11; y < roofH - 12; y += 5) p.hline(cx - 8, y, 16, '#c8d0f0')
  for (const vx of [12, p.w - 20]) {
    p.rect(vx, 12, 8, 5, '#5a5e70')
    p.hline(vx, 12, 8, '#8a8ea0')
  }
  p.rect(2, roofH - 6, p.w - 4, 6, '#6a4c40')
  p.hline(2, roofH - 6, p.w - 4, '#495573')
  wall(p, roofH, wallH, '#86644c', '#4a3428', '#a8866a')
  p.rect(6, roofH + 6, p.w - 12, 8, '#3c3a48')
  for (let x = 7; x < p.w - 8; x += 12) {
    p.rect(x, roofH + 7, 10, 6, '#a8e4f4')
    p.hline(x, roofH + 7, 10, '#e0f6fc')
  }
  if (s.door === 'left' || s.door === 'right') {
    const x = s.door === 'left' ? 2 : p.w - 16
    p.rect(x, p.h - 18, 14, 18, '#9a9ea8')
    p.rect(x + 2, p.h - 16, 10, 16, '#343440')
    for (let i = 0; i < 3; i++) p.hline(x + 2, p.h - 13 + i * 4, 10, '#6a6e78')
  } else {
    glassWindow(p, cx - 6, roofH + 17, 12, 8, '#a8e4f4')
  }
  return finish(p, wallH)
}

const BUILDERS: Record<BuildingStyle, (s: BuildingSpec) => Sprite> = {
  pokecenter, house, apartment, gym, mart, redhouse, cathedral, contest, amityGate, routeGate,
}

export function buildingSprite(spec: BuildingSpec): Sprite {
  return BUILDERS[spec.style](spec)
}
