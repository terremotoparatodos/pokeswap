// R33 — a placed object that is bigger than one tile.
//
// F-1 shipped the footprint as a list and tested a 2×2 registry entry, but
// nothing ever placed one, so three rules downstream had never been exercised
// with a real multi-tile object: where its art's tap box is projected from,
// which tile a tap on it should answer with, and whether the walker and the
// navigator treat all of its tiles as one obstacle.
//
// These tests drive the real walker, the real TapNavigator, the real picking
// order and the renderer's own geometry — only the canvas is missing. The 1×1
// case is asserted alongside each one, because the whole point is that the
// generic path did not change what already worked.

import { describe, expect, it } from 'vitest'
import { advance, createActor, createWalkerState, driveWalker, WALK_SPEED, type Actor, type MoveRules } from './actors'
import { TapNavigator } from './navigator'
import { findPath, pathTiles } from './pathfinding'
import { besidePlaced, nearestTile, placedFeet, placedObject, PlacedObjects } from './placedObjects'
import { hitTest, spriteRect, type PlacedHit } from './picking'
import { createProjector } from './projection'

const AREA = 'pradera'
const TILE = 16

// ── Shape ───────────────────────────────────────────────────────────────────

describe('a footprint bigger than one tile', () => {
  const furnace = placedObject({ id: 'furnace', areaId: AREA, anchor: { tx: 4, ty: 6 }, kind: 'smelter', width: 2, depth: 2 })

  it('covers four tiles, growing east and north from its anchor', () => {
    expect([...furnace.footprint].map(tile => `${tile.tx},${tile.ty}`).sort())
      .toEqual(['4,5', '4,6', '5,5', '5,6'])
  })

  it('is solid on every one of them and on none of their neighbours', () => {
    const placed = new PlacedObjects()
    placed.register(furnace)
    for (const tile of furnace.footprint) expect(placed.isSolid(AREA, tile.tx, tile.ty)).toBe(true)
    expect(placed.isSolid(AREA, 6, 6)).toBe(false)
    expect(placed.isSolid(AREA, 3, 6)).toBe(false)
    expect(placed.isSolid(AREA, 4, 7)).toBe(false)
    expect(placed.isSolid(AREA, 4, 4)).toBe(false)
  })

  it('answers as itself from any of its tiles, not only the anchor', () => {
    const placed = new PlacedObjects()
    placed.register(furnace)
    for (const tile of furnace.footprint) expect(placed.at(AREA, tile.tx, tile.ty)?.id).toBe('furnace')
  })

  it('has an approach ring of eight tiles, and none of them is its own', () => {
    const ring = besidePlaced(furnace).map(tile => `${tile.tx},${tile.ty}`)
    expect(ring).toHaveLength(8)
    for (const tile of furnace.footprint) expect(ring).not.toContain(`${tile.tx},${tile.ty}`)
  })

  it('an explicit cell list places a shape a rectangle cannot', () => {
    // A plus: the anchor, one either side, and one behind.
    const forge = placedObject({
      id: 'forge', areaId: AREA, anchor: { tx: 10, ty: 10 }, kind: 'smelter',
      cells: [{ dx: 0, dy: 0 }, { dx: -0, dy: 1 }, { dx: 1, dy: 1 }, { dx: 2, dy: 1 }],
    })
    expect([...forge.footprint].map(tile => `${tile.tx},${tile.ty}`).sort())
      .toEqual(['10,10', '10,9', '11,9', '12,9'])
  })

  it('a cell list always includes the anchor, so a malformed one still stands somewhere', () => {
    const odd = placedObject({ id: 'odd', areaId: AREA, anchor: { tx: 1, ty: 1 }, kind: 'campfire', cells: [{ dx: 3, dy: 0 }] })
    expect(odd.footprint).toContainEqual({ tx: 1, ty: 1 })
  })

  it('and a one-tile object is exactly what it always was', () => {
    const bench = placedObject({ id: 'bench', areaId: AREA, anchor: { tx: 2, ty: 2 }, kind: 'alchemyTable' })
    expect(bench.footprint).toEqual([{ tx: 2, ty: 2 }])
    expect(besidePlaced(bench)).toHaveLength(4)
  })
})

// ── Collision and navigation ────────────────────────────────────────────────

function setup(placed: PlacedObjects, actors: Actor[] = []) {
  const player = createActor({ id: 'p', kind: 'player', habitat: 'any', tx: 0, ty: 0, speed: WALK_SPEED })
  // Exactly how `game.ts` composes it: the area first, placed objects on top.
  const solid = (tx: number, ty: number) => placed.isSolid(AREA, tx, ty)
  const occupied = (tx: number, ty: number) => actors.some(a => a.tx === tx && a.ty === ty)
  const nav = new TapNavigator({ isSolid: solid, occupied, isInteractive: (tx, ty) => placed.isInteractive(AREA, tx, ty) })
  const rules: MoveRules = { blocked: (_a, tx, ty) => solid(tx, ty), occupied }
  const walker = createWalkerState()
  const tick = (seconds: number) => {
    for (let t = 0; t < seconds; t += 1 / 60) {
      driveWalker(player, nav.active ? nav.next : null, 1 / 60, rules, walker, () => nav.arrived(), true)
      nav.update(player, 1 / 60)
      for (const a of actors) advance(a, 1 / 60)
    }
  }
  return { player, nav, tick, solid }
}

describe('walking around a 2×2 furnace', () => {
  const furnace = placedObject({ id: 'furnace', areaId: AREA, anchor: { tx: 0, ty: 4 }, kind: 'smelter', width: 2, depth: 2 })

  it('the player cannot step onto any of its four tiles', () => {
    const placed = new PlacedObjects()
    placed.register(furnace)
    const { player, nav, tick } = setup(placed)
    nav.goTo(player, { tile: { tx: 0, ty: 8 }, actor: null })
    tick(12)
    for (const tile of furnace.footprint) {
      expect(`${player.tx},${player.ty}`).not.toBe(`${tile.tx},${tile.ty}`)
    }
  })

  it('pathfinding goes round it instead of through it', () => {
    const placed = new PlacedObjects()
    placed.register(furnace)
    const start = { tx: 0, ty: 2 }
    const path = findPath({
      start, target: { tx: 0, ty: 8 },
      isGoal: (x, y) => x === 0 && y === 8,
      blocked: (tx, ty) => placed.isSolid(AREA, tx, ty),
    })
    expect(path).not.toBeNull()
    const tiles = pathTiles(start, path!).map(tile => `${tile.tx},${tile.ty}`)
    for (const tile of furnace.footprint) expect(tiles).not.toContain(`${tile.tx},${tile.ty}`)
  })

  it('a route never ends inside the footprint', () => {
    const placed = new PlacedObjects()
    placed.register(furnace)
    const { player, nav, tick } = setup(placed)
    // Aim straight at the far corner of the furnace itself.
    nav.goTo(player, { tile: { tx: 1, ty: 3 }, actor: null })
    tick(12)
    expect(placed.isSolid(AREA, player.tx, player.ty)).toBe(false)
    expect(besidePlaced(furnace).some(tile => tile.tx === player.tx && tile.ty === player.ty)).toBe(true)
  })

  it('and a gap of one tile between two furnaces is still walkable', () => {
    const placed = new PlacedObjects()
    placed.register(placedObject({ id: 'a', areaId: AREA, anchor: { tx: -3, ty: 4 }, kind: 'smelter', width: 2, depth: 2 }))
    placed.register(placedObject({ id: 'b', areaId: AREA, anchor: { tx: 0, ty: 4 }, kind: 'smelter', width: 2, depth: 2 }))
    expect(placed.isSolid(AREA, -1, 4)).toBe(false)
    const start = { tx: -1, ty: 2 }
    const path = findPath({
      start, target: { tx: -1, ty: 7 },
      isGoal: (x, y) => x === -1 && y === 7,
      blocked: (tx, ty) => placed.isSolid(AREA, tx, ty),
    })
    expect(pathTiles(start, path!).map(tile => `${tile.tx},${tile.ty}`)).toContain('-1,4')
  })
})

// ── Interaction: which tile a tap answers with ──────────────────────────────

describe('reaching a multi-tile station', () => {
  const furnace = placedObject({ id: 'furnace', areaId: AREA, anchor: { tx: 4, ty: 6 }, kind: 'smelter', width: 2, depth: 2 })

  /** What `game.placedRetarget` does: a tap answers with the anchor, and it is moved to the nearest tile. */
  const retarget = (playerTx: number, playerTy: number) => nearestTile(furnace, playerTx, playerTy)

  it('a player at the far corner is one step from the tile a tap retargets to', () => {
    // Standing east of the object's right column: the anchor is two tiles away.
    const anchorDistance = Math.abs(furnace.anchor.tx - 6) + Math.abs(furnace.anchor.ty - 5)
    expect(anchorDistance).toBe(3)
    const tile = retarget(6, 5)
    expect(Math.abs(tile.tx - 6) + Math.abs(tile.ty - 5)).toBe(1)
  })

  it('every tile of the approach ring is one step from some tile of the object', () => {
    for (const stand of besidePlaced(furnace)) {
      const tile = retarget(stand.tx, stand.ty)
      expect(Math.abs(tile.tx - stand.tx) + Math.abs(tile.ty - stand.ty)).toBeLessThanOrEqual(1)
    }
  })

  it('a one-tile object always retargets to itself', () => {
    const bench = placedObject({ id: 'bench', areaId: AREA, anchor: { tx: 2, ty: 2 }, kind: 'alchemyTable' })
    expect(nearestTile(bench, 9, 9)).toEqual({ tx: 2, ty: 2 })
  })
})

// ── Picking: where the art's tap box sits ───────────────────────────────────

const LENS = { distance: 260, squash: 0.62, zoom: 1.35 }
const proj = createProjector(LENS, { width: 800, height: 600, focusY: 600 * 0.56 })

/** Exactly what `Renderer.collectPlacedHits` builds for one object. */
function placedHit(object: ReturnType<typeof placedObject>): { hit: PlacedHit; feet: { x: number; y: number; scale: number } } {
  const box = object.hitbox!
  const feet = placedFeet(object, TILE)
  const p = proj.project(feet.x, feet.y)!
  const left = p.x - (box.width / 2 - (box.offsetX ?? 0)) * p.scale
  return {
    hit: { ...spriteRect(left, p.y - box.height * p.scale, p.y, box.width, 0, p.scale), tx: object.anchor.tx, ty: object.anchor.ty },
    feet: { x: p.x, y: p.y, scale: p.scale },
  }
}

describe('the furnace art is centred over its whole footprint', () => {
  // The furnace's own art: 30×34 world pixels, standing on 2×2 tiles.
  const HITBOX = { width: 30, height: 34 }
  const furnace = placedObject({
    id: 'furnace', areaId: AREA, anchor: { tx: 2, ty: -4 }, kind: 'smelter', width: 2, depth: 2, hitbox: HITBOX,
  })

  it('its feet sit between its two front tiles, not over the anchor', () => {
    const feet = placedFeet(furnace, TILE)
    // Anchor tx = 2, so the two front tiles span x 32..64 and their middle is 48.
    expect(feet.x).toBe(48)
    // Front row is ty = -4, the same row the anchor is on.
    expect(feet.y).toBe(-4 * TILE + TILE - 2)
  })

  it('a tap on the art answers with the furnace', () => {
    const { hit, feet } = placedHit(furnace)
    expect(hitTest([], [], feet.x, feet.y - 10, [hit])).toEqual({ kind: 'placed', tx: 2, ty: -4 })
  })

  it('and a tap a full tile to the side of the art is not the furnace', () => {
    const { hit, feet } = placedHit(furnace)
    expect(hitTest([], [], feet.x + 30 * feet.scale, feet.y - 10, [hit])).toBeNull()
  })

  it('an actor standing in front of it still keeps the tap', () => {
    const { hit, feet } = placedHit(furnace)
    const actor = { x0: feet.x - 8, x1: feet.x + 8, y0: feet.y - 20, y1: feet.y, actor: 'pikachu', tx: 2, ty: -3 }
    expect(hitTest([actor], [], feet.x, feet.y - 10, [hit])).toEqual({ kind: 'actor', actor: 'pikachu', tx: 2, ty: -3 })
  })

  it('a one-tile object is projected from exactly the point it always was', () => {
    const bench = placedObject({ id: 'bench', areaId: AREA, anchor: { tx: 2, ty: -4 }, kind: 'alchemyTable' })
    expect(placedFeet(bench, TILE)).toEqual({ x: 2 * TILE + TILE / 2, y: -4 * TILE + TILE - 2 })
  })
})
