// Wooden paddock fence — Rancho
//
// One sprite per neighbour mask (N, E, S, W), so runs, corners and ends join
// by themselves. Seen from the handheld 3/4 camera: a post stands at the tile
// centre, two rails run sideways to east/west neighbours, and a rail seen from
// above climbs to the post of the northern neighbour. The southern neighbour
// draws the rail between the two, so every piece sorts correctly by depth.

import { Painter } from '../../wildlands/engine/painter'
import type { Sprite } from '../../wildlands/engine/sprite'

export const FENCE_N = 1
export const FENCE_E = 2
export const FENCE_S = 4
export const FENCE_W = 8

const WOOD = {
  outline: '#3b2412',
  dark: '#6e4524',
  mid: '#96643a',
  light: '#be8650',
  top: '#dcaa72',
}

/** Height of the sprite; the post base sits on its last row. */
export const FENCE_H = 32
/** Where the post base sits inside its tile, in pixels from the tile's top. */
export const FENCE_BASE_Y = 12

function post(p: Painter): void {
  p.rect(6, 18, 4, 14, WOOD.mid)
  p.vline(6, 18, 14, WOOD.light)
  p.vline(9, 18, 14, WOOD.dark)
  p.rect(6, 17, 4, 2, WOOD.top)
  p.hline(6, 31, 4, WOOD.dark)
}

function rail(p: Painter, x: number, y: number, w: number): void {
  p.hline(x, y, w, WOOD.top)
  p.hline(x, y + 1, w, WOOD.mid)
  p.hline(x, y + 2, w, WOOD.dark)
}

function fencePiece(mask: number): Sprite {
  const p = new Painter(16, FENCE_H)
  if (mask & FENCE_N) {
    // Top rail seen from above, from this post up to the northern one.
    p.rect(6, 2, 4, 16, WOOD.light)
    p.vline(9, 2, 16, WOOD.mid)
    for (let y = 5; y < 18; y += 5) p.hline(6, y, 4, WOOD.mid)
  }
  if (mask & FENCE_W) {
    rail(p, 0, 20, 7)
    rail(p, 0, 26, 7)
  }
  if (mask & FENCE_E) {
    rail(p, 9, 20, 7)
    rail(p, 9, 26, 7)
  }
  post(p)
  p.outline(WOOD.outline)
  return p.toSprite({ ax: 8, ay: FENCE_H - 1 })
}

/** Sprites indexed by neighbour mask (0–15). */
export function buildFenceSprites(): Sprite[] {
  return Array.from({ length: 16 }, (_, mask) => fencePiece(mask))
}
