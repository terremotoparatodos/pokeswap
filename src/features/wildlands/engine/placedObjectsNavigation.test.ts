// F-1 — what a placed object does to walking and to navigation.
//
// The engine composes its solidity the way the game does: the area first, then
// whatever was placed on top. These tests drive the real walker and the real
// TapNavigator through that composed port, so what they prove is the wiring,
// not a mock.

import { describe, expect, it } from 'vitest'
import { advance, createActor, createWalkerState, driveWalker, WALK_SPEED, type Actor, type MoveRules } from './actors'
import { TapNavigator } from './navigator'
import { findPath, pathTiles } from './pathfinding'
import { placedObject, PlacedObjects } from './placedObjects'

const AREA = 'pradera'

/** The area's own solidity: a bare field, plus an optional rock wall. */
const emptyArea = () => () => false

function setup(placed: PlacedObjects, areaSolid: (tx: number, ty: number) => boolean = emptyArea(), actors: Actor[] = []) {
  const player = createActor({ id: 'p', kind: 'player', habitat: 'any', tx: 0, ty: 0, speed: WALK_SPEED })
  // Exactly how `game.ts` composes it: area first, placed objects on top.
  const solid = (tx: number, ty: number) => areaSolid(tx, ty) || placed.isSolid(AREA, tx, ty)
  const occupied = (tx: number, ty: number) => actors.some(a => a.tx === tx && a.ty === ty)
  const nav = new TapNavigator({
    isSolid: solid,
    occupied,
    isInteractive: (tx, ty) => placed.isInteractive(AREA, tx, ty),
  })
  const rules: MoveRules = { blocked: (_a, tx, ty) => solid(tx, ty), occupied }
  const walker = createWalkerState()
  const tick = (seconds: number) => {
    let talked = false
    for (let t = 0; t < seconds; t += 1 / 60) {
      driveWalker(player, nav.active ? nav.next : null, 1 / 60, rules, walker, () => nav.arrived(), true)
      talked = nav.update(player, 1 / 60) || talked
      for (const a of actors) advance(a, 1 / 60)
    }
    return talked
  }
  return { player, nav, tick, solid }
}

const bench = (tx: number, ty: number, id = 'bench') =>
  placedObject({ id, areaId: AREA, anchor: { tx, ty }, kind: 'alchemyTable' })

describe('a placed object blocks the way', () => {
  it('the player cannot walk onto its tile', () => {
    const placed = new PlacedObjects()
    placed.register(bench(0, 3))
    const { player, tick } = setup(placed)
    // Walk straight south, into the bench.
    const walker = createWalkerState()
    const solid = (tx: number, ty: number) => placed.isSolid(AREA, tx, ty)
    const rules: MoveRules = { blocked: (_a, tx, ty) => solid(tx, ty), occupied: () => false }
    for (let t = 0; t < 4; t += 1 / 60) driveWalker(player, () => 'down', 1 / 60, rules, walker, () => {}, true)
    expect(player.ty, 'the bench stops the walk one tile short').toBe(2)
    expect(tick(0)).toBe(false)
  })

  it('and the same tile is walkable again once the object is gone', () => {
    const placed = new PlacedObjects()
    placed.register(bench(0, 3))
    expect(setup(placed).solid(0, 3)).toBe(true)
    placed.unregister('bench')
    expect(setup(placed).solid(0, 3)).toBe(false)
  })
})

describe('navigation', () => {
  it('stops beside a tapped bench and faces it', () => {
    const placed = new PlacedObjects()
    placed.register(bench(4, 0))
    const { player, nav, tick } = setup(placed)
    expect(nav.goTo(player, { tile: { tx: 4, ty: 0 }, actor: null })).toBe(true)
    tick(4)
    expect([player.tx, player.ty]).toEqual([3, 0])
    expect(player.dir).toBe('right')
  })

  it('routes around it instead of through it', () => {
    const placed = new PlacedObjects()
    for (let ty = -2; ty <= 2; ty++) placed.register(bench(1, ty, `wall-${ty}`))
    const { solid } = setup(placed)
    const start = { tx: 0, ty: 0 }
    const path = findPath({ start, target: { tx: 2, ty: 0 }, isGoal: (x, y) => x === 2 && y === 0, blocked: solid })!
    expect(path).not.toBeNull()
    expect(pathTiles(start, path).some(tile => solid(tile.tx, tile.ty))).toBe(false)
  })

  it('an interactive object that does not block is still approached from beside', () => {
    const placed = new PlacedObjects()
    placed.register(placedObject({
      id: 'mark', areaId: AREA, anchor: { tx: 0, ty: 3 }, kind: 'campfire', solid: false,
    }))
    const { player, nav, tick } = setup(placed)
    nav.goTo(player, { tile: { tx: 0, ty: 3 }, actor: null })
    tick(4)
    expect([player.tx, player.ty]).toEqual([0, 2])
    expect(player.dir).toBe('down')
  })

  it('two objects both block, and a gap between them is still walkable', () => {
    const placed = new PlacedObjects()
    placed.register(bench(1, 0, 'a'))
    placed.register(bench(1, 2, 'b'))
    const { solid } = setup(placed)
    expect(solid(1, 0)).toBe(true)
    expect(solid(1, 2)).toBe(true)
    expect(solid(1, 1)).toBe(false)
  })
})

describe('nothing placed', () => {
  it('leaves solidity exactly as the area answers it', () => {
    const placed = new PlacedObjects()
    const rock = (tx: number, ty: number) => tx === 4 && ty === 0
    const { solid, player, nav, tick } = setup(placed, rock)
    expect(solid(4, 0)).toBe(true)
    expect(solid(5, 0)).toBe(false)
    nav.goTo(player, { tile: { tx: 3, ty: -2 }, actor: null })
    tick(4)
    expect([player.tx, player.ty]).toEqual([3, -2])
  })

  it('and the area keeps its own props solid even with objects placed elsewhere', () => {
    const placed = new PlacedObjects()
    placed.register(bench(9, 9))
    const rock = (tx: number, ty: number) => tx === 4 && ty === 0
    const { solid } = setup(placed, rock)
    expect(solid(4, 0)).toBe(true)
    expect(solid(9, 9)).toBe(true)
    expect(solid(0, 0)).toBe(false)
  })
})

describe('leaving the area', () => {
  it('drops what was placed there, so nothing blocks on the way back', () => {
    const placed = new PlacedObjects()
    placed.register(bench(2, 2))
    expect(setup(placed).solid(2, 2)).toBe(true)
    // What `enterArea` does when the player leaves.
    placed.clearArea(AREA)
    expect(setup(placed).solid(2, 2)).toBe(false)
    expect(placed.size).toBe(0)
  })

  it('never blocks a tile because of another area', () => {
    const placed = new PlacedObjects()
    placed.register(placedObject({
      id: 'town-bench', areaId: 'ciudad-corazon', anchor: { tx: 2, ty: 2 }, kind: 'alchemyTable',
    }))
    expect(setup(placed).solid(2, 2)).toBe(false)
  })
})
