// Street furniture — WildLands prototype
//
// Small town props painted in code with the same outline/ramp rules as the
// wild props and buildings (fallbacks while a town's hand-drawn art loads).
//
// Most props fill one tile. Benches are longer (TOWN_PROP_SIZE); their
// (tx, ty) is the top-left tile of the footprint. Fences autotile: a run of
// fence tiles picks straight, vertical or corner pieces from its neighbours
// (fencePiece), so a horizontal run and a vertical run meet at a real post.

import { Painter } from './painter'
import { ellipses, shade, spriteFromPixels, type Sprite } from './sprite'

export type TownPropKind =
  | 'lamp' | 'sign' | 'hedge' | 'fenceH' | 'fenceV' | 'spray'
  /** Plaza benches: long 1×3 (backrest right / left), short 1×2, and 2×1 facing down. */
  | 'bench' | 'benchLeft' | 'benchShort' | 'benchAcross'

/** Footprint in tiles, from the prop's (tx, ty); anything not listed is one tile. */
export const TOWN_PROP_SIZE: Partial<Record<TownPropKind, { readonly w: number; readonly d: number }>> = {
  bench: { w: 1, d: 3 },
  benchLeft: { w: 1, d: 3 },
  benchShort: { w: 1, d: 2 },
  benchAcross: { w: 2, d: 1 },
}

export function townPropSize(kind: TownPropKind): { readonly w: number; readonly d: number } {
  return TOWN_PROP_SIZE[kind] ?? { w: 1, d: 1 }
}

/**
 * Where a prop stands, in world pixels, and the tile row it sorts on: one-tile
 * props 2 px above their tile's bottom; longer ones on the bottom of their footprint.
 */
export function townPropFeet(p: { kind: TownPropKind; tx: number; ty: number }): { x: number; y: number; ty: number } {
  const { w, d } = townPropSize(p.kind)
  if (w === 1 && d === 1) return { x: p.tx * 16 + 8, y: p.ty * 16 + 14, ty: p.ty }
  return { x: (p.tx + w / 2) * 16, y: (p.ty + d) * 16 - 1, ty: p.ty + d - 1 }
}

/** The tiles a prop covers. */
export function townPropTiles(p: { kind: TownPropKind; tx: number; ty: number }): { tx: number; ty: number }[] {
  const { w, d } = townPropSize(p.kind)
  const out: { tx: number; ty: number }[] = []
  for (let dy = 0; dy < d; dy++) for (let dx = 0; dx < w; dx++) out.push({ tx: p.tx + dx, ty: p.ty + dy })
  return out
}

/**
 * Which fence piece a fence tile shows:
 * - `h` straight run; `v` / `vRight` a vertical run under the left / right picket;
 * - `nw` / `ne` a corner where the run turns down; `sw` / `se` where it arrives from above.
 */
export type FencePiece = 'h' | 'v' | 'vRight' | 'nw' | 'ne' | 'sw' | 'se'

type FenceAt = (tx: number, ty: number) => 'h' | 'v' | null

/**
 * Autotiling from the neighbours. A corner is found whether it was laid as a
 * horizontal tile with a vertical run below/above it, or as a vertical tile
 * with a horizontal run beside it. A vertical run sits under the corner post
 * it hangs from, so a run meeting a right-hand corner uses the right picket.
 */
export function fencePiece(at: FenceAt, tx: number, ty: number): FencePiece {
  const self = at(tx, ty)
  const west = at(tx - 1, ty) === 'h'
  const east = at(tx + 1, ty) === 'h'
  const north = at(tx, ty - 1) === 'v'
  const south = at(tx, ty + 1) === 'v'
  if (self === 'h') {
    if (south && !(west && east)) return west ? 'ne' : 'nw'
    if (north && !(west && east)) return west ? 'se' : 'sw'
    return 'h'
  }
  if (self === 'v' && west !== east) {
    if (south && !north) return east ? 'nw' : 'ne'
    if (north && !south) return east ? 'sw' : 'se'
  }
  return rightHanded(at, tx, ty) ? 'vRight' : 'v'
}

/** A vertical run hangs from (or lands on) a right-hand corner: its horizontal neighbour is on the west. */
function rightHanded(at: FenceAt, tx: number, ty: number): boolean {
  const cornerRight = (y: number): boolean | null => {
    const kind = at(tx, y)
    const west = at(tx - 1, y) === 'h'
    const east = at(tx + 1, y) === 'h'
    if (kind === 'h') return west && !east
    if (kind === 'v' && west !== east) return west
    return null
  }
  // Walk to both ends of the run; the first end that is a corner decides.
  for (const step of [-1, 1]) {
    let y = ty
    while (at(tx, y + step) === 'v') {
      y += step
      const end = cornerRight(y)
      if (end !== null && at(tx, y + step) !== 'v') return end
    }
    const beyond = cornerRight(y + step)
    if (beyond !== null) return beyond
  }
  return false
}

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

/** A plaza bench seen from above, sized to its footprint: planks, and a backrest strip on one side. */
function bench(w: number, d: number, back: 'left' | 'right' | 'top'): Sprite {
  const pw = w * 16 - 3
  const ph = d * 16 - 2
  const p = new Painter(pw, ph)
  p.rect(0, 0, pw, ph, '#b05048')
  if (back === 'top') {
    for (let y = 6; y < ph - 1; y += 3) p.hline(0, y, pw, '#90422e')
    p.rect(0, 0, pw, 4, '#cc6a5a')
  } else {
    for (let x = 2; x < pw - 3; x += 4) p.vline(x, 0, ph, '#90422e')
    p.rect(back === 'right' ? pw - 3 : 0, 0, 3, ph, '#cc6a5a')
  }
  p.outline(OUTLINE)
  return p.toSprite({ flatTop: ph })
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
  return {
    lamp: lamp(), sign: sign(), hedge: hedge(), fenceH: fenceH(), fenceV: fenceV(), spray: spray(),
    bench: bench(1, 3, 'right'), benchLeft: bench(1, 3, 'left'), benchShort: bench(1, 2, 'right'), benchAcross: bench(2, 1, 'top'),
  }
}
