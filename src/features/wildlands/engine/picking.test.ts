// R30 · F-2 — a tap on a tall prop must select that prop, not the ground it
// hides behind it.
//
// The geometry is the real one: the same projector the renderer uses, the same
// rect it builds while drawing, and the same ground unprojection it falls back
// to. What these tests pin is the decision, so they need no canvas.

import { describe, expect, it } from 'vitest'
import { createProjector } from './projection'
import { hitTest, resolvePick, spriteRect, type ActorHit, type PropHit } from './picking'

const TILE = 16
const LENS = { distance: 260, squash: 0.62, zoom: 1.35 }
const VIEW = { width: 800, height: 600, focusY: 600 * 0.56 }
const proj = createProjector(LENS, VIEW)

/** Camera on the tile the player stands on, as the game does. */
const CAM = { x: 0, y: 0 }

/** Where the ground under a screen point is, i.e. what `pick()` answers on a miss. */
function groundTile(sx: number, sy: number): { tx: number; ty: number } | null {
  const ground = proj.unproject(sx, sy)
  if (!ground) return null
  return { tx: Math.floor((CAM.x + ground.wx) / TILE), ty: Math.floor((CAM.y + ground.wy) / TILE) }
}

interface PropArt {
  /** Sprite cell, in sprite pixels. */
  readonly w: number
  readonly h: number
  readonly ax: number
  readonly ay: number
  readonly top: number
}

/** Three real shapes: a tall tree, a low rock and a mid bush. */
const TREE: PropArt = { w: 26, h: 42, ax: 13, ay: 41, top: 0 }
const ROCK: PropArt = { w: 20, h: 16, ax: 10, ay: 15, top: 2 }
const BUSH: PropArt = { w: 18, h: 22, ax: 9, ay: 21, top: 1 }

/** The prop standing on a tile, projected and turned into a hit rect. */
function propOn(tx: number, ty: number, art: PropArt): { hit: PropHit; feet: { x: number; y: number; scale: number } } {
  const wx = tx * TILE + TILE / 2
  const wy = ty * TILE + TILE - 3
  const p = proj.project(wx - CAM.x, wy - CAM.y)!
  const x = p.x - art.ax * p.scale
  const topY = p.y - art.ay * p.scale
  return {
    hit: { ...spriteRect(x, topY, p.y, art.w, art.top, p.scale), tx, ty },
    feet: { x: p.x, y: p.y, scale: p.scale },
  }
}

describe('tall props answer a tap (F-2)', () => {
  const cases: ReadonlyArray<[string, PropArt]> = [['tree', TREE], ['rock', ROCK], ['bush', BUSH]]

  it.each(cases)('%s: a tap at its base selects it', (_name, art) => {
    const { hit, feet } = propOn(3, -4, art)
    expect(hitTest([], [hit], feet.x, feet.y - 2)).toEqual({ kind: 'prop', tx: 3, ty: -4 })
  })

  it.each(cases)('%s: a tap over its art selects it, not the tile behind', (_name, art) => {
    const { hit, feet } = propOn(3, -4, art)
    const drawn = (art.ay - art.top) * feet.scale
    for (const part of [0.5, 0.9]) {
      const sy = feet.y - drawn * part
      // The bug: the ground under that pixel belongs to a tile further north.
      expect(groundTile(feet.x, sy), `${part} up must hide another tile`).not.toEqual({ tx: 3, ty: -4 })
      expect(hitTest([], [hit], feet.x, sy)).toEqual({ kind: 'prop', tx: 3, ty: -4 })
    }
  })

  it('a tree answers 20 and 30 px up, where the ground is one and two tiles behind', () => {
    const { hit, feet } = propOn(3, -4, TREE)
    // Two tiles further north at 30 px: that is the tile the player used to
    // walk to instead of chopping the tree.
    expect(groundTile(feet.x, feet.y - 20)?.ty).toBe(-6)
    expect(groundTile(feet.x, feet.y - 30)?.ty).toBe(-8)
    expect(hitTest([], [hit], feet.x, feet.y - 20)).toEqual({ kind: 'prop', tx: 3, ty: -4 })
    expect(hitTest([], [hit], feet.x, feet.y - 30)).toEqual({ kind: 'prop', tx: 3, ty: -4 })
  })

  it('holds at another camera scale, where the same prop is drawn bigger', () => {
    const near = createProjector(LENS, VIEW)
    const wx = 3 * TILE + TILE / 2
    const wy = 2 * TILE + TILE - 3
    const p = near.project(wx, wy)!
    expect(p.scale).toBeGreaterThan(1.5)
    const hit: PropHit = {
      ...spriteRect(p.x - TREE.ax * p.scale, p.y - TREE.ay * p.scale, p.y, TREE.w, TREE.top, p.scale),
      tx: 3, ty: 2,
    }
    expect(hitTest([], [hit], p.x, p.y - 30)).toEqual({ kind: 'prop', tx: 3, ty: 2 })
  })

  it('a short prop does not answer above its own art', () => {
    const { hit, feet } = propOn(3, -4, ROCK)
    // Well over a 16 px rock: that is sky above it, and must stay ground.
    expect(hitTest([], [hit], feet.x, feet.y - 40)).toBeNull()
  })

  it('open ground beside a prop is still ground', () => {
    const { hit, feet } = propOn(3, -4, TREE)
    const aside = feet.x + TREE.w * feet.scale + 6
    expect(hitTest([], [hit], aside, feet.y)).toBeNull()
    expect(hitTest([], [hit], feet.x, feet.y + 8)).toBeNull()
  })

  it('two props: the frontmost one wins', () => {
    const back = propOn(3, -5, TREE)
    const front = propOn(3, -4, TREE)
    // Drawn back to front, like the renderer sorts them by depth.
    const props = [back.hit, front.hit]
    expect(hitTest([], props, front.feet.x, front.feet.y - 10)).toEqual({ kind: 'prop', tx: 3, ty: -4 })
  })
})

describe('actors keep their priority', () => {
  it('an actor standing over a prop wins the tap', () => {
    const { hit, feet } = propOn(3, -4, TREE)
    const actor: ActorHit<string> = { ...spriteRect(feet.x - 8, feet.y - 24, feet.y, 16, 0, feet.scale, 8), actor: 'npc', tx: 3, ty: -4 }
    expect(hitTest([actor], [hit], feet.x, feet.y - 10)).toEqual({ kind: 'actor', actor: 'npc', tx: 3, ty: -4 })
  })

  it('the prop still answers where no actor is', () => {
    const { hit, feet } = propOn(3, -4, TREE)
    const actor: ActorHit<string> = { ...spriteRect(feet.x + 60, feet.y - 24, feet.y, 16, 0, feet.scale, 8), actor: 'npc', tx: 9, ty: 9 }
    expect(hitTest([actor], [hit], feet.x, feet.y - 10)).toEqual({ kind: 'prop', tx: 3, ty: -4 })
  })
})

describe('what a tap resolves to, ground included', () => {
  const tree = propOn(3, -4, TREE)
  const ground = (sx: number, sy: number) => groundTile(sx, sy)

  it('before the fix: with no prop rects, a tap on the canopy answered the tile behind', () => {
    const was = resolvePick<string>([], [], tree.feet.x, tree.feet.y - 20, ground)
    expect(was.actor).toBeNull()
    expect(was.tile).not.toEqual({ tx: 3, ty: -4 })
    expect(was.tile?.ty).toBe(-6)
  })

  it('after the fix: the same tap answers the tree', () => {
    const now = resolvePick<string>([], [tree.hit], tree.feet.x, tree.feet.y - 20, ground)
    expect(now).toEqual({ tile: { tx: 3, ty: -4 }, actor: null })
  })

  it('open ground still walks where the finger points', () => {
    const sx = tree.feet.x + 120
    const answer = resolvePick<string>([], [tree.hit], sx, tree.feet.y, ground)
    expect(answer.actor).toBeNull()
    expect(answer.tile).toEqual(groundTile(sx, tree.feet.y))
  })

  it('an actor answers with its own tile, as it always did', () => {
    const actor: ActorHit<string> = {
      ...spriteRect(tree.feet.x - 8, tree.feet.y - 24, tree.feet.y, 16, 0, tree.feet.scale, 8),
      actor: 'npc', tx: 9, ty: 9,
    }
    expect(resolvePick([actor], [tree.hit], tree.feet.x, tree.feet.y - 10, ground))
      .toEqual({ tile: { tx: 9, ty: 9 }, actor: 'npc' })
  })
})

describe('the rect is the drawn art', () => {
  it('starts at the first opaque row, not at the top of the cell', () => {
    const rect = spriteRect(100, 50, 92, 20, 6, 2)
    expect(rect).toEqual({ x0: 100, x1: 140, y0: 62, y1: 92 })
  })

  it('pads every side when a fingertip margin is asked for', () => {
    const rect = spriteRect(100, 50, 92, 20, 0, 2, 8)
    expect(rect).toEqual({ x0: 92, x1: 148, y0: 42, y1: 100 })
  })
})
