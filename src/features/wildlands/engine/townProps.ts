// Street furniture — WildLands prototype
//
// Small town props painted in code with the same outline/ramp rules as the
// wild props and buildings (fallbacks while a town's hand-drawn art loads).
//
// Fences autotile: each fence tile picks a straight, vertical or corner piece
// from its neighbours (fencePiece), so a row and a column meet at a real post.
// A vertical run stands one upright post every 8 px on the ground (fencePosts)
// instead of one sprite per tile, so a tilted camera spaces its posts exactly
// like the ground and the posts in front cover the ones behind.

import { Painter } from './painter'
import { ellipses, shade, spriteFromPixels, type Sprite } from './sprite'

export type TownPropKind = 'lamp' | 'sign' | 'hedge' | 'fenceH' | 'fenceV' | 'spray'

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

/** The art a fence piece draws on its tile: a straight run, a corner picket, or nothing but posts. */
export function fenceTileArt(piece: FencePiece): 'h' | 'cornerLeft' | 'cornerRight' | null {
  if (piece === 'h') return 'h'
  if (piece === 'nw' || piece === 'sw') return 'cornerLeft'
  if (piece === 'ne' || piece === 'se') return 'cornerRight'
  return null
}

/** Picket columns of a straight tile, as post centres (px from the tile's left edge). */
const POST_X = { left: 5, right: 13 } as const

/**
 * Feet (world px) of the upright posts a fence tile stands: two per vertical
 * tile, 8 px apart, and one more on a corner the run arrives at from above,
 * so posts keep their 8 px rhythm into the corner picket.
 */
export function fencePosts(piece: FencePiece, tx: number, ty: number): { x: number; y: number }[] {
  const x0 = tx * 16
  const y0 = ty * 16
  switch (piece) {
    case 'v': return [{ x: x0 + POST_X.left, y: y0 + 6 }, { x: x0 + POST_X.left, y: y0 + 14 }]
    case 'vRight': return [{ x: x0 + POST_X.right, y: y0 + 6 }, { x: x0 + POST_X.right, y: y0 + 14 }]
    case 'sw': return [{ x: x0 + POST_X.left, y: y0 + 6 }]
    case 'se': return [{ x: x0 + POST_X.right, y: y0 + 6 }]
    default: return []
  }
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
  return { lamp: lamp(), sign: sign(), hedge: hedge(), fenceH: fenceH(), fenceV: fenceV(), spray: spray() }
}
