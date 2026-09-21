// Ranch buildings drawn in code — Rancho
//
// The barn, the entrance arch with the ranch's name, the well and the mailbox,
// painted in the handheld 3/4 view (roof on top, façade below) with the same
// limited palettes and 1 px outline as the WildLands props.

import { Painter } from '../../wildlands/engine/painter'
import type { Sprite } from '../../wildlands/engine/sprite'
import { FONT_HEIGHT, paintText, textWidth } from './pixelFont'

const WOOD = { outline: '#3b2412', dark: '#6e4524', mid: '#96643a', light: '#be8650', top: '#dcaa72' }
const TRIM = { light: '#f2eadb', shade: '#cdbfa6' }

/** The farmhouse where Guti and Sky live: 5 tiles of frontage, door facing south. */
export function buildHouse(): Sprite {
  const W = 80
  const H = 80
  const p = new Painter(W, H)
  const roof = { base: '#4f9a54', light: '#68b96b', dark: '#357a3e', ridge: '#27602f' }
  const wall = { base: '#e4d7b8', light: '#f4ebd2', dark: '#c0ac86', sill: '#8d7a56' }

  // Chimney behind the ridge, so the roof overlaps its base.
  p.rect(58, 2, 9, 16, '#8c5a48')
  for (let y = 4; y < 18; y += 3) p.hline(58, y, 9, '#6e4234')
  p.rect(57, 1, 11, 3, '#a8705c')

  // Hipped roof: rows narrow toward the ridge, shingles staggered.
  const roofTop = 8
  const roofBottom = 44
  for (let y = roofTop; y < roofBottom; y++) {
    const inset = Math.round((roofBottom - y) * 0.42)
    const row = Math.floor((y - roofTop) / 4)
    for (let x = 2 + inset; x <= W - 3 - inset; x++) {
      const seam = (x + (row % 2) * 3) % 6 === 0
      const edge = (y - roofTop) % 4 === 3
      p.set(x, y, edge || seam ? roof.dark : (x * 3 + y) % 13 === 0 ? roof.light : roof.base)
    }
  }
  p.rect(2 + Math.round((roofBottom - roofTop) * 0.42), roofTop - 1, W - 4 - 2 * Math.round((roofBottom - roofTop) * 0.42), 2, roof.ridge)
  p.rect(2, roofBottom, W - 4, 2, roof.ridge)

  // Façade.
  p.rect(4, roofBottom + 2, W - 8, H - roofBottom - 3, wall.base)
  for (let y = roofBottom + 2; y < H - 1; y += 4) p.hline(4, y, W - 8, wall.light)
  p.vline(5, roofBottom + 2, H - roofBottom - 3, wall.light)
  p.vline(W - 6, roofBottom + 2, H - roofBottom - 3, wall.dark)
  p.rect(4, H - 3, W - 8, 2, '#a08a62')

  // Door, centred so the doormat tile lines up, with a little porch light.
  const dx = W / 2 - 7
  p.rect(dx - 1, H - 25, 16, 24, wall.sill)
  p.rect(dx, H - 23, 14, 22, '#7a4a2c')
  p.vline(dx + 7, H - 23, 22, '#5c3620')
  p.rect(dx + 2, H - 20, 4, 7, '#a9724a')
  p.rect(dx + 9, H - 20, 4, 7, '#a9724a')
  p.set(dx + 11, H - 11, '#e8c040')
  p.rect(dx + 4, H - 29, 7, 3, '#f2d98a')

  // Windows either side, with shutters and a flower box.
  for (const wx of [11, W - 27]) {
    p.rect(wx - 1, H - 27, 18, 15, wall.sill)
    p.rect(wx + 2, H - 25, 12, 11, '#3c5a6e')
    p.rect(wx + 2, H - 25, 12, 4, '#5b7f95')
    p.vline(wx + 7, H - 25, 11, wall.light)
    p.hline(wx + 2, H - 20, 12, wall.light)
    p.rect(wx - 1, H - 27, 3, 15, '#b8503c')
    p.rect(wx + 14, H - 27, 3, 15, '#b8503c')
    p.rect(wx + 1, H - 13, 14, 4, '#96643a')
    p.hline(wx + 1, H - 13, 14, '#be8650')
    for (let x = wx + 2; x < wx + 15; x += 3) {
      p.set(x, H - 14, '#e0403c')
      p.set(x + 1, H - 14, '#f6c73a')
    }
  }

  p.outline('#2a2230')
  return p.toSprite({ ax: W / 2, ay: H - 1, castShadow: false })
}

export function buildBarn(): Sprite {
  const W = 96
  const H = 86
  const p = new Painter(W, H)
  const roof = { base: '#6d4a3b', light: '#86604c', dark: '#4e3329', ridge: '#3b261e' }
  const wall = { base: '#b5402f', light: '#cb5741', dark: '#8f3122', deep: '#6e2419' }

  // Roof slab, slightly wider at the eaves, with staggered shingle rows.
  for (let y = 6; y < 46; y++) {
    const inset = Math.round((46 - y) * 0.18)
    const x0 = 3 + inset
    const x1 = W - 4 - inset
    const row = Math.floor((y - 6) / 5)
    for (let x = x0; x <= x1; x++) {
      const seam = (x + (row % 2) * 4) % 8 === 0
      const edge = (y - 6) % 5 === 4
      p.set(x, y, edge ? roof.dark : seam ? roof.dark : (x + y) % 11 === 0 ? roof.light : roof.base)
    }
  }
  p.rect(18, 5, W - 36, 2, roof.ridge)
  // Hay-loft door in the gable, open, with hay showing.
  p.rect(38, 22, 20, 18, TRIM.light)
  p.rect(40, 24, 16, 15, '#2c1712')
  p.rect(40, 33, 16, 6, '#d9b24a')
  for (let x = 41; x < 56; x += 3) p.set(x, 32, '#e8c860')
  p.hline(40, 38, 16, '#a88230')
  // Weathervane.
  p.vline(48, 0, 6, '#2c2c34')
  p.rect(45, 1, 7, 1, '#2c2c34')
  p.rect(50, 0, 2, 3, '#2c2c34')
  // Eave shadow.
  p.rect(3, 46, W - 6, 2, '#3a2016')

  // Façade: vertical planks.
  for (let y = 48; y < H - 1; y++) {
    for (let x = 5; x < W - 5; x++) {
      const k = (x - 5) % 6
      p.set(x, y, k === 0 ? wall.dark : k === 1 ? wall.light : wall.base)
    }
  }
  // Corner boards and header.
  p.rect(5, 48, 3, H - 49, TRIM.light)
  p.vline(7, 48, H - 49, TRIM.shade)
  p.rect(W - 8, 48, 3, H - 49, TRIM.light)
  p.vline(W - 6, 48, H - 49, TRIM.shade)
  p.rect(5, 48, W - 10, 2, TRIM.light)
  // Big double door with X braces.
  const dx = 30
  const dw = 36
  p.rect(dx, 56, dw, H - 57, TRIM.light)
  p.rect(dx + 2, 58, dw - 4, H - 59, wall.deep)
  p.vline(dx + dw / 2 - 1, 58, H - 59, TRIM.light)
  p.vline(dx + dw / 2, 58, H - 59, TRIM.shade)
  for (const [x0, x1] of [[dx + 2, dx + dw / 2 - 2], [dx + dw / 2 + 1, dx + dw - 3]]) {
    const h = H - 60
    for (let t = 0; t <= h; t++) {
      const f = t / h
      p.set(Math.round(x0 + (x1 - x0) * f), 58 + t, TRIM.light)
      p.set(Math.round(x1 - (x1 - x0) * f), 58 + t, TRIM.light)
    }
  }
  // Side windows.
  for (const wx of [12, W - 26]) {
    p.rect(wx, 58, 14, 12, TRIM.light)
    p.rect(wx + 2, 60, 10, 8, '#3c4a5c')
    p.vline(wx + 7, 60, 8, TRIM.light)
    p.hline(wx + 2, 63, 10, TRIM.light)
    p.set(wx + 3, 61, '#9fb6cc')
    p.set(wx + 9, 65, '#9fb6cc')
    p.hline(wx - 1, 70, 16, TRIM.shade)
  }
  // Foundation.
  p.rect(5, H - 2, W - 10, 1, '#5a2a20')
  p.outline('#2a1510')
  return p.toSprite({ ax: W / 2, ay: H - 1 })
}

/** Entrance arch spanning the path, with the ranch's name on the board. */
export function buildArch(width: number): Sprite {
  const H = 58
  const p = new Painter(width, H)
  const left = 5
  const right = width - 11
  for (const x of [left, right]) {
    p.rect(x, 12, 6, H - 12, WOOD.mid)
    p.vline(x, 12, H - 12, WOOD.light)
    p.vline(x + 5, 12, H - 12, WOOD.dark)
    p.rect(x - 1, 10, 8, 3, WOOD.top)
  }
  // Board.
  const by = 3
  const bh = 17
  p.rect(1, by, width - 2, bh, '#c9955a')
  p.hline(1, by, width - 2, '#e6bb82')
  p.hline(1, by + bh - 1, width - 2, '#8d5f33')
  for (let x = 1; x < width - 1; x += 23) p.vline(x, by + 1, bh - 2, '#b0804b')
  for (const x of [3, width - 4]) {
    p.set(x, by + 3, '#4a3020')
    p.set(x, by + bh - 4, '#4a3020')
  }
  const text = 'RANCHO DE GUTI'
  const scale = 2
  const tx = Math.round((width - textWidth(text, scale)) / 2)
  const ty = by + Math.round((bh - FONT_HEIGHT * scale) / 2)
  paintText(text, tx + 1, ty + 1, scale, (x, y) => p.set(x, y, '#e6bb82'))
  paintText(text, tx, ty, scale, (x, y) => p.set(x, y, '#3b2412'))
  p.outline(WOOD.outline)
  return p.toSprite({ ax: width / 2, ay: H - 1 })
}

export function buildWell(): Sprite {
  const W = 26
  const H = 34
  const p = new Painter(W, H)
  const stone = { dark: '#5f646e', mid: '#868c97', light: '#adb3bd', hi: '#d3d8de' }
  // Stone wall.
  for (let y = 21; y < H - 1; y++) {
    for (let x = 2; x < W - 2; x++) {
      const row = Math.floor((y - 21) / 3)
      const mortar = (y - 21) % 3 === 2 || (x + (row % 2) * 3) % 6 === 0
      p.set(x, y, mortar ? stone.dark : x < 6 ? stone.light : stone.mid)
    }
  }
  // Rim and water.
  p.shape((x, y) => {
    const d = ((x + 0.5 - W / 2) / 11) ** 2 + ((y + 0.5 - 21) / 3.2) ** 2
    if (d > 1) return null
    const inner = ((x + 0.5 - W / 2) / 8) ** 2 + ((y + 0.5 - 21.5) / 2.2) ** 2
    if (inner <= 1) return y < 21 ? '#1d3346' : '#2b577c'
    return y < 20 ? stone.hi : stone.light
  })
  // Posts, crossbar, rope and bucket.
  for (const x of [3, W - 5]) {
    p.rect(x, 8, 2, 14, WOOD.mid)
    p.vline(x, 8, 14, WOOD.light)
  }
  p.hline(4, 11, W - 8, WOOD.dark)
  p.vline(13, 12, 5, '#c8b890')
  p.rect(11, 16, 5, 4, '#8c6a44')
  p.hline(11, 16, 5, '#b89060')
  // Little shingle roof.
  for (let y = 1; y <= 8; y++) {
    const half = 5 + y * 1.1
    for (let x = Math.round(W / 2 - half); x <= Math.round(W / 2 + half); x++) {
      p.set(x, y, y === 8 ? '#5e3a24' : (x + y) % 4 === 0 ? '#9a4a36' : '#b85a40')
    }
  }
  p.outline('#2a1a14')
  return p.toSprite({ ax: W / 2, ay: H - 1 })
}

export function buildMailbox(): Sprite {
  const p = new Painter(12, 22)
  p.rect(5, 10, 2, 12, WOOD.mid)
  p.vline(5, 10, 12, WOOD.light)
  p.rect(1, 3, 10, 8, '#d04444')
  p.hline(2, 2, 8, '#d04444')
  p.hline(2, 3, 8, '#e87070')
  p.hline(1, 10, 10, '#9c2c2c')
  p.rect(3, 6, 6, 3, '#f4ecdc')
  p.vline(10, 1, 5, '#e8c040')
  p.set(9, 1, '#e8c040')
  p.outline('#3a1616')
  return p.toSprite({ ax: 6, ay: 21 })
}
