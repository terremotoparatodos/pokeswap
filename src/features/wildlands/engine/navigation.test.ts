import { describe, expect, it } from 'vitest'
import { advance, createActor, createWalkerState, driveWalker, isMoving, WALK_SPEED, type Actor, type MoveRules } from './actors'
import { TapNavigator } from './navigator'
import { findPath, pathTiles } from './pathfinding'
import { createProjector, LENSES } from './projection'

describe('findPath', () => {
  it('walks around a wall', () => {
    // Vertical wall at x = 1 from y = -2..2; the only gap is at y = 3.
    const wall = (tx: number, ty: number) => tx === 1 && ty >= -2 && ty <= 2
    const start = { tx: 0, ty: 0 }
    const target = { tx: 2, ty: 0 }
    const path = findPath({ start, target, isGoal: (x, y) => x === 2 && y === 0, blocked: wall })!
    expect(path).not.toBeNull()
    const tiles = pathTiles(start, path)
    expect(tiles[tiles.length - 1]).toEqual(target)
    expect(tiles.some(t => wall(t.tx, t.ty))).toBe(false)
    expect(path.length).toBe(2 + 3 * 2) // around the wall's end and back
  })

  it('returns [] at the goal and null when enclosed', () => {
    const start = { tx: 5, ty: 5 }
    expect(findPath({ start, target: start, isGoal: () => true, blocked: () => false })).toEqual([])
    const box = (tx: number, ty: number) => Math.abs(tx - 5) + Math.abs(ty - 5) === 1
    expect(findPath({ start, target: { tx: 9, ty: 5 }, isGoal: (x, y) => x === 9 && y === 5, blocked: box })).toBeNull()
  })

  it('gives up fast beyond its search radius', () => {
    const t0 = performance.now()
    const far = findPath({
      start: { tx: 0, ty: 0 }, target: { tx: 500, ty: 0 },
      isGoal: x => x === 500, blocked: () => false, radius: 40,
    })
    expect(far).toBeNull()
    expect(performance.now() - t0).toBeLessThan(200)
  })
})

describe('TapNavigator', () => {
  function setup(solid: (tx: number, ty: number) => boolean = () => false, actors: Actor[] = []) {
    const player = createActor({ id: 'p', kind: 'player', habitat: 'any', tx: 0, ty: 0, speed: WALK_SPEED })
    const occupied = (tx: number, ty: number) => actors.some(a => a.tx === tx && a.ty === ty)
    const nav = new TapNavigator({ isSolid: solid, occupied })
    const rules: MoveRules = { blocked: (_a, tx, ty) => solid(tx, ty), occupied: (tx, ty) => occupied(tx, ty) }
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
    return { player, nav, tick }
  }

  it('walks to a tapped tile and stops there', () => {
    const { player, nav, tick } = setup()
    expect(nav.goTo(player, { tile: { tx: 3, ty: -2 }, actor: null })).toBe(true)
    expect(tick(3)).toBe(false)
    expect([player.tx, player.ty]).toEqual([3, -2])
    expect(nav.active).toBe(false)
    expect(isMoving(player)).toBe(false)
  })

  it('stops beside a tapped obstacle, facing it', () => {
    const rock = (tx: number, ty: number) => tx === 4 && ty === 0
    const { player, nav, tick } = setup(rock)
    nav.goTo(player, { tile: { tx: 4, ty: 0 }, actor: null })
    expect(tick(3)).toBe(true)
    expect([player.tx, player.ty]).toEqual([3, 0])
    expect(player.dir).toBe('right')
  })

  it('walks up to a tapped actor and reports it for interaction', () => {
    const npc = createActor({ id: 'n', kind: 'npc', habitat: 'land', tx: 0, ty: 4 })
    const { player, nav, tick } = setup(undefined, [npc])
    nav.goTo(player, { tile: { tx: 0, ty: 4 }, actor: npc })
    expect(tick(3)).toBe(true)
    expect([player.tx, player.ty]).toEqual([0, 3])
    expect(player.dir).toBe('down')
  })

  it('rejects unreachable taps', () => {
    const island = (tx: number, ty: number) => Math.abs(tx - 10) + Math.abs(ty) === 1
    const { player, nav } = setup(island)
    expect(nav.goTo(player, { tile: { tx: 10, ty: 0 }, actor: null })).toBe(false)
    expect(nav.route(player).rejected).toMatchObject({ tx: 10, ty: 0 })
  })
})

describe('unproject', () => {
  it('inverts project on the ground plane', () => {
    const proj = createProjector(LENSES.dramatic, { width: 1000, height: 700, focusY: 390 })
    const p = proj.project(-37, 58)!
    const back = proj.unproject(p.x, p.y)!
    expect(back.wx).toBeCloseTo(-37, 6)
    expect(back.wy).toBeCloseTo(58, 6)
  })
})
