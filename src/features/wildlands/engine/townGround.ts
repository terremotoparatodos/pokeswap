// Town ground baking — WildLands prototype
//
// Bakes a whole town's flat ground into one bitmap from its terrain grid:
// fine diamond paving with curbs, stone plaza slabs, lawns, darker forest
// floor and fountain basins — then "dressing" that ties props to the ground:
// raised city blocks, stone aprons around free-standing buildings, soil beds
// under hedges and small shadows under posts.

import { hash2 } from './noise'
import { inOctagon } from './painter'
import { packColor } from './pixels'
import { sampleTexture, terrainArt } from './terrainArt'
import { T, TILE } from './world'

export interface TileRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** A rectangle in world pixels, end-exclusive. */
export interface PxRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface GroundDressing {
  /** Tiles of raised city blocks (sidewalk paving with a curb around the union). */
  plots?: readonly { tx: number; ty: number }[]
  /**
   * Visible sprite bounds of each building (bottom = where the façade meets the
   * ground). `apron` adds a stone band for buildings standing outside a plot.
   */
  buildings: readonly (PxRect & { apron?: boolean })[]
  /** Tiles holding hedges: they get a soil bed with stone edging. */
  beds: readonly { tx: number; ty: number }[]
  /** Feet of small upright props (lamps, signs) for a tiny contact shadow. */
  posts: readonly { x: number; y: number }[]
}

const C = {
  street: packColor('#d6bd8c'),
  streetLight: packColor('#dfc799'),
  streetLine: packColor('#c8ae7e'),
  streetSpeck: packColor('#bba070'),
  curb: packColor('#957652'),
  curbLight: packColor('#e8d3a8'),
  plaza: packColor('#b8c0d8'),
  plazaLight: packColor('#ccd2e6'),
  plazaDark: packColor('#a6aec8'),
  mortar: packColor('#8e96b2'),
  // Mid-tone brick: the hand-drawn buildings end in a dark foundation row that
  // was painted for Platinum's darker streets and reads as a hard line on pale paving.
  plot: packColor('#c4ab80'),
  plotLight: packColor('#ccb48a'),
  plotJoint: packColor('#b39a70'),
  plotCurb: packColor('#7e6242'),
  plotCurbShade: packColor('#a08460'),
  plotCurbLight: packColor('#dcc49a'),
  apron: packColor('#cdc3ad'),
  apronLight: packColor('#dcd4c0'),
  apronDark: packColor('#bdb29a'),
  apronJoint: packColor('#a89c82'),
  apronEdge: packColor('#8a7c62'),
  soil: packColor('#6e5238'),
  soilDark: packColor('#5a422c'),
  bedEdge: packColor('#c8bea8'),
  bedEdgeDark: packColor('#968a72'),
  rim: packColor('#e6dcc8'),
  rimShade: packColor('#b8ab94'),
  rimDark: packColor('#8a7e6a'),
  water: packColor('#6ccce0'),
  waterLight: packColor('#a8e8f4'),
  waterDeep: packColor('#4ab0cc'),
}

/** Multiplies a packed colour's RGB by `k`. */
function darken(color: number, k: number): number {
  const r = Math.round((color & 255) * k)
  const g = Math.round(((color >>> 8) & 255) * k)
  const b = Math.round(((color >>> 16) & 255) * k)
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0
}

function street(x: number, y: number): number {
  // Small, low-contrast diamond paving with a faint tone per stone.
  const u = (x + y) & 7
  const v = (x - y + 1024) & 7
  if (u === 0 || v === 0) return C.streetLine
  if (hash2(x, y, 61) < 0.015) return C.streetSpeck
  return hash2((x + y) >> 3, (x - y + 1024) >> 3, 62) > 0.72 ? C.streetLight : C.street
}

function plaza(x: number, y: number): number {
  const lx = x & 7
  const ly = y & 7
  if (lx === 0 || ly === 0) return C.mortar
  if (lx === 1 || ly === 1) return C.plazaLight
  const slab = hash2(x >> 3, y >> 3, 63)
  return slab > 0.75 ? C.plazaLight : slab < 0.25 ? C.plazaDark : C.plaza
}

function apron(x: number, y: number): number {
  // Offset 8×8 slabs, like a stone sidewalk.
  const row = y >> 3
  const lx = (x + (row & 1) * 4) & 7
  const ly = y & 7
  if (lx === 0 || ly === 0) return C.apronJoint
  if (ly === 1) return C.apronLight
  const slab = hash2((x + (row & 1) * 4) >> 3, row, 64)
  return slab > 0.8 ? C.apronLight : slab < 0.2 ? C.apronDark : C.apron
}

export function bakeTownGround(
  terrain: readonly string[],
  fountains: readonly TileRect[],
  dressing: GroundDressing = { buildings: [], beds: [], posts: [] },
): Uint32Array {
  const tilesW = terrain[0].length
  const tilesH = terrain.length
  const W = tilesW * TILE
  const H = tilesH * TILE
  const out = new Uint32Array(W * H)
  const grass = terrainArt().textures[T.GRASS]
  const cell = (tx: number, ty: number) =>
    tx < 0 || ty < 0 || tx >= tilesW || ty >= tilesH ? 't' : terrain[ty][tx]

  for (let y = 0; y < H; y++) {
    const ty = y >> 4
    const ly = y & 15
    for (let x = 0; x < W; x++) {
      const tx = x >> 4
      const lx = x & 15
      const kind = cell(tx, ty)
      let col: number
      if (kind === 's') {
        col = street(x, y)
        const edge =
          (ly <= 1 && cell(tx, ty - 1) !== 's') || (ly >= 14 && cell(tx, ty + 1) !== 's') ||
          (lx <= 1 && cell(tx - 1, ty) !== 's') || (lx >= 14 && cell(tx + 1, ty) !== 's')
        const inner =
          (ly === 2 && cell(tx, ty - 1) !== 's') || (lx === 2 && cell(tx - 1, ty) !== 's') ||
          (lx === 13 && cell(tx + 1, ty) !== 's') || (ly === 13 && cell(tx, ty + 1) !== 's')
        if (edge) col = C.curb
        else if (inner) col = C.curbLight
      } else if (kind === 'p') {
        col = plaza(x, y)
        const edge = (ly === 0 && cell(tx, ty - 1) !== 'p') || (lx === 0 && cell(tx - 1, ty) !== 'p') ||
          (lx === 15 && cell(tx + 1, ty) !== 'p') || (ly === 15 && cell(tx, ty + 1) !== 'p')
        if (edge) col = C.rimShade
      } else {
        col = sampleTexture(grass, x, y)
        if (kind === 't') col = darken(col, 0.72)
        else if (ly <= 1 && cell(tx, ty - 1) === 's') col = darken(col, 0.82)
      }
      out[y * W + x] = col
    }
  }

  const put = (x: number, y: number, c: number) => {
    if (x >= 0 && y >= 0 && x < W && y < H) out[y * W + x] = c
  }
  const shade = (x: number, y: number, k: number) => {
    if (x >= 0 && y >= 0 && x < W && y < H) out[y * W + x] = darken(out[y * W + x], k)
  }

  for (const f of fountains) {
    const x0 = f.x0 * TILE
    const y0 = f.y0 * TILE
    const w = (f.x1 - f.x0 + 1) * TILE
    const h = (f.y1 - f.y0 + 1) * TILE
    const cx = x0 + w / 2
    const cy = y0 + h / 2
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        if (!inOctagon(x, y, cx, cy, w / 2 - 2, h / 2 - 1, 12)) continue
        const inner = inOctagon(x, y, cx, cy, w / 2 - 7, h / 2 - 6, 9)
        let col: number
        if (!inOctagon(x, y, cx, cy, w / 2 - 3, h / 2 - 2, 11)) col = C.rimDark
        else if (!inner) col = y > cy + 2 ? C.rimShade : C.rim
        else {
          const ring = Math.hypot((x - cx) / w, (y - cy) / h)
          col = (Math.round(ring * 60) % 5 === 0) ? C.waterLight : y < cy - 4 ? C.waterDeep : C.water
        }
        out[y * W + x] = col
      }
    }
  }

  // City blocks: brick sidewalk with a curb around the outline of the union.
  const plots = new Set((dressing.plots ?? []).map(t => `${t.tx},${t.ty}`))
  const inPlot = (tx: number, ty: number) => plots.has(`${tx},${ty}`)
  for (const { tx, ty } of dressing.plots ?? []) {
    const x0 = tx * TILE
    const y0 = ty * TILE
    const openL = !inPlot(tx - 1, ty)
    const openR = !inPlot(tx + 1, ty)
    const openT = !inPlot(tx, ty - 1)
    const openB = !inPlot(tx, ty + 1)
    for (let ly = 0; ly < TILE; ly++) {
      for (let lx = 0; lx < TILE; lx++) {
        const x = x0 + lx
        const y = y0 + ly
        let c: number
        if ((openL && lx === 0) || (openT && ly === 0) || (openR && lx === 15) || (openB && ly === 15)) c = C.plotCurb
        else if ((openR && lx === 14) || (openB && ly === 14)) c = C.plotCurbShade
        else if ((openL && lx === 1) || (openT && ly === 1)) c = C.plotCurbLight
        else {
          const row = y >> 3
          const bx = (x + (row & 1) * 8) & 15
          if ((y & 7) === 0 || bx === 0) c = C.plotJoint
          else c = hash2((x + (row & 1) * 8) >> 4, row, 66) > 0.78 ? C.plotLight : C.plot
        }
        put(x, y, c)
      }
    }
  }

  // Stone apron along the front and lower sides of free-standing buildings. It
  // stops a tile up the sides: further back the roof hides it, and with the
  // tilted camera a full-depth apron would peek out behind the roofline.
  for (const b of dressing.buildings) {
    if (!b.apron) continue
    const ax0 = b.x0 - 5
    const ax1 = b.x1 + 5
    const ay0 = Math.max(b.y0, b.y1 - 18)
    const ay1 = b.y1 + 7
    for (let y = ay0; y < ay1; y++) {
      for (let x = ax0; x < ax1; x++) {
        const onEdge = x === ax0 || x === ax1 - 1 || y === ay1 - 1
        put(x, y, onEdge ? C.apronEdge : x === ax0 + 1 || y === ay1 - 2 ? C.apronLight : apron(x, y))
      }
    }
  }

  // Soil beds under hedges, edged in stone where the run ends.
  const beds = new Set(dressing.beds.map(t => `${t.tx},${t.ty}`))
  const isBed = (tx: number, ty: number) => beds.has(`${tx},${ty}`)
  for (const { tx, ty } of dressing.beds) {
    const x0 = tx * TILE
    const y0 = ty * TILE
    for (let ly = 0; ly < TILE; ly++) {
      for (let lx = 0; lx < TILE; lx++) {
        const edgeL = lx <= 1 && !isBed(tx - 1, ty)
        const edgeR = lx >= 14 && !isBed(tx + 1, ty)
        const edgeT = ly <= 1 && !isBed(tx, ty - 1)
        const edgeB = ly >= 14 && !isBed(tx, ty + 1)
        let c: number
        if (edgeB || edgeR) c = (lx === 15 || ly === 15) ? C.bedEdgeDark : C.bedEdge
        else if (edgeL || edgeT) c = (lx === 0 || ly === 0) ? C.bedEdgeDark : C.bedEdge
        else c = hash2(x0 + lx, y0 + ly, 65) < 0.3 ? C.soilDark : C.soil
        put(x0 + lx, y0 + ly, c)
      }
    }
  }

  // Buildings get no baked contact shadow: the hand-drawn sprites already shade
  // their own base, and a dark band at the foot of an upright façade reads as a
  // stray line. Thin posts do need one to sit on the ground.
  for (const p of dressing.posts) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -4; dx <= 4; dx++) if ((dx * dx) / 16 + dy * dy <= 1) shade(p.x + dx + 1, p.y + dy, 0.75)
    }
  }
  return out
}
