// F-1.1 — who answers a tap when a placed object is on screen.
//
// The rule these tests fix is the order: an actor first, then the world's own
// props, then a placed object *inside the art it declared*, and otherwise the
// ground. The bug this replaces made a bench answer for two rows of plain
// grass behind it, and could take a tap away from a tree F-2 had resolved.
//
// The geometry is the renderer's: same projector, same rect, same ground
// unprojection — only the canvas is missing.

import { describe, expect, it } from 'vitest'
import { hitTest, resolvePick, spriteRect, type ActorHit, type PlacedHit, type PropHit } from './picking'
import { placedObject, type PlacedObject } from './placedObjects'
import { createProjector } from './projection'

const TILE = 16
const LENS = { distance: 260, squash: 0.62, zoom: 1.35 }
const VIEW = { width: 800, height: 600, focusY: 600 * 0.56 }
const proj = createProjector(LENS, VIEW)
const CAM = { x: 0, y: 0 }

const ground = (sx: number, sy: number) => {
  const at = proj.unproject(sx, sy)
  if (!at) return null
  return { tx: Math.floor((CAM.x + at.wx) / TILE), ty: Math.floor((CAM.y + at.wy) / TILE) }
}

/** The Alchemy bench's own art: 34×30 world pixels standing on its tile. */
const BENCH_HITBOX = { width: 34, height: 30 }

/** Exactly what `Renderer.collectPlacedHits` builds for one object. */
function placedHit(object: PlacedObject): { hit: PlacedHit; feet: { x: number; y: number; scale: number } } {
  const box = object.hitbox!
  const feetX = object.anchor.tx * TILE + TILE / 2
  const feetY = object.anchor.ty * TILE + TILE - 2
  const p = proj.project(feetX - CAM.x, feetY - CAM.y)!
  const left = p.x - (box.width / 2 - (box.offsetX ?? 0)) * p.scale
  return {
    hit: {
      ...spriteRect(left, p.y - box.height * p.scale, p.y, box.width, 0, p.scale),
      tx: object.anchor.tx, ty: object.anchor.ty,
    },
    feet: { x: p.x, y: p.y, scale: p.scale },
  }
}

const bench = placedObject({
  id: 'bench', areaId: 'pradera', anchor: { tx: 2, ty: -4 }, kind: 'alchemyTable', hitbox: BENCH_HITBOX,
})

describe('a tap on the bench', () => {
  it('lands on the bench over its art', () => {
    const { hit, feet } = placedHit(bench)
    for (const up of [2, 10, 20]) {
      expect(resolvePick([], [], feet.x, feet.y - up, ground, [hit]), `${up} px up`)
        .toEqual({ tile: { tx: 2, ty: -4 }, actor: null })
    }
  })

  it('still opens from an adjacent tile: the tap answers with the bench tile, which is solid', () => {
    const { hit, feet } = placedHit(bench)
    const answer = resolvePick([], [], feet.x, feet.y - 10, ground, [hit])
    // The game walks beside it and interacts; picking only names the tile.
    expect(answer.tile).toEqual(bench.anchor)
    expect(answer.actor).toBeNull()
  })
})

describe('the ground behind the bench stays ground', () => {
  const { hit, feet } = placedHit(bench)
  const artTop = feet.y - BENCH_HITBOX.height * feet.scale

  // The tiles behind a bench are partly hidden by it, exactly as they are
  // behind a tree: what the art covers belongs to the art (F-2), and what is
  // still visible is still ground. The rejected version took *both*.
  it('the visible part of the first tile behind it is still ground', () => {
    const behind = { tx: 2, ty: -5 }
    const p = proj.project(behind.tx * TILE + TILE / 2 - CAM.x, behind.ty * TILE + TILE - 2 - CAM.y)!
    const visible = p.x + BENCH_HITBOX.width * feet.scale * 0.75
    const answer = resolvePick([], [], visible, p.y, ground, [hit])
    expect(answer.tile).toEqual(ground(visible, p.y))
    expect(answer.tile).not.toEqual(bench.anchor)
  })

  it('the visible part of the second tile behind it is still ground', () => {
    const behind = { tx: 2, ty: -6 }
    const p = proj.project(behind.tx * TILE + TILE / 2 - CAM.x, behind.ty * TILE + TILE - 2 - CAM.y)!
    const visible = p.x - BENCH_HITBOX.width * feet.scale * 0.75
    const answer = resolvePick([], [], visible, p.y, ground, [hit])
    expect(answer.tile).toEqual(ground(visible, p.y))
    expect(answer.tile).not.toEqual(bench.anchor)
  })

  it('and no tile is hijacked outside the columns its art occupies', () => {
    // Two tiles to the side, at the bench's own row and the rows behind it.
    for (const ty of [-4, -5, -6]) {
      const p = proj.project((bench.anchor.tx + 2) * TILE + TILE / 2 - CAM.x, ty * TILE + TILE - 2 - CAM.y)!
      expect(resolvePick([], [], p.x, p.y, ground, [hit]).tile, `tile ${ty}`).toEqual(ground(p.x, p.y))
    }
  })

  it('a point just above its art is ground, not the bench', () => {
    expect(hitTest([], [], feet.x, artTop - 6, [hit])).toBeNull()
  })

  it('and so is a point beside it', () => {
    const aside = feet.x + BENCH_HITBOX.width * feet.scale
    expect(hitTest([], [], aside, feet.y - 10, [hit])).toBeNull()
  })
})

describe('priority', () => {
  const { hit, feet } = placedHit(bench)

  it('an actor over the bench keeps the tap', () => {
    const actor: ActorHit<string> = {
      ...spriteRect(feet.x - 8, feet.y - 24, feet.y, 16, 0, feet.scale, 8), actor: 'npc', tx: 9, ty: 9,
    }
    expect(resolvePick([actor], [], feet.x, feet.y - 10, ground, [hit]))
      .toEqual({ tile: { tx: 9, ty: 9 }, actor: 'npc' })
  })

  it('a procedural prop inside the bench art keeps the tap (F-2 is not overridden)', () => {
    const prop: PropHit = { ...spriteRect(feet.x - 13, feet.y - 40, feet.y, 26, 0, feet.scale), tx: 2, ty: -5 }
    expect(hitTest([], [prop], feet.x, feet.y - 10, [hit])).toEqual({ kind: 'prop', tx: 2, ty: -5 })
    expect(resolvePick([], [prop], feet.x, feet.y - 10, ground, [hit]))
      .toEqual({ tile: { tx: 2, ty: -5 }, actor: null })
  })

  it('the bench answers only where no actor and no prop is', () => {
    const prop: PropHit = { ...spriteRect(feet.x + 80, feet.y - 40, feet.y, 26, 0, feet.scale), tx: 9, ty: 9 }
    expect(resolvePick([], [prop], feet.x, feet.y - 10, ground, [hit]))
      .toEqual({ tile: { tx: 2, ty: -4 }, actor: null })
  })
})

describe('each object answers for its own art', () => {
  it('a taller object reaches higher than a short one, by its own declaration', () => {
    const tall = placedObject({
      id: 'oven', areaId: 'pradera', anchor: { tx: 6, ty: -4 }, kind: 'smelter', hitbox: { width: 34, height: 60 },
    })
    const short = placedObject({
      id: 'fire', areaId: 'pradera', anchor: { tx: 9, ty: -4 }, kind: 'campfire', hitbox: { width: 20, height: 12 },
    })
    const a = placedHit(tall)
    const b = placedHit(short)
    const up = 40 * a.feet.scale
    expect(hitTest([], [], a.feet.x, a.feet.y - up, [a.hit, b.hit])).toEqual({ kind: 'placed', tx: 6, ty: -4 })
    expect(hitTest([], [], b.feet.x, b.feet.y - up, [a.hit, b.hit])).toBeNull()
  })

  it('an object with no hitbox never takes a tap: only its tiles speak', () => {
    const plain = placedObject({ id: 'plain', areaId: 'pradera', anchor: { tx: 2, ty: -4 }, kind: 'workbench' })
    expect(plain.hitbox).toBeUndefined()
    // The renderer contributes no rect for it, so a tap over its tile is ground.
    const p = proj.project(2 * TILE + TILE / 2 - CAM.x, -4 * TILE + TILE - 2 - CAM.y)!
    expect(resolvePick([], [], p.x, p.y - 20, ground, []).tile).toEqual(ground(p.x, p.y - 20))
  })

  it('two overlapping objects: the last drawn wins', () => {
    const back = placedObject({
      id: 'back', areaId: 'pradera', anchor: { tx: 2, ty: -5 }, kind: 'smelter', hitbox: BENCH_HITBOX,
    })
    const front = placedHit(bench)
    expect(hitTest([], [], front.feet.x, front.feet.y - 6, [placedHit(back).hit, front.hit]))
      .toEqual({ kind: 'placed', tx: 2, ty: -4 })
  })
})

describe('camera scale', () => {
  it('the art grows with the camera and so does its hitbox', () => {
    const near = placedObject({
      id: 'near', areaId: 'pradera', anchor: { tx: 2, ty: 3 }, kind: 'alchemyTable', hitbox: BENCH_HITBOX,
    })
    const far = placedHit(bench)
    const close = placedHit(near)
    expect(close.feet.scale).toBeGreaterThan(far.feet.scale)
    const height = (rect: PlacedHit) => rect.y1 - rect.y0
    expect(height(close.hit)).toBeGreaterThan(height(far.hit))
    // Both still answer over their own art and nowhere else.
    expect(hitTest([], [], close.feet.x, close.feet.y - 10, [close.hit])).toEqual({ kind: 'placed', tx: 2, ty: 3 })
    expect(hitTest([], [], close.feet.x, close.hit.y0 - 4, [close.hit])).toBeNull()
  })
})
