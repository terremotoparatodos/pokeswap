import { describe, expect, it } from 'vitest'
import { createActor, createWalkerState, driveWalker, WALK_SPEED, type MoveRules } from './actors'
import type { Dir } from './characters'
import { TapNavigator } from './navigator'

// R31-C1: resource nodes must be approachable from every side, whether the
// host prop is solid (rock, boulder) or walkable (crystal, shore, tall grass).
const NODE = { tx: 0, ty: 0 }
const STARTS: readonly { from: string; tx: number; ty: number; face: Dir }[] = [
  { from: 'north', tx: 0, ty: -4, face: 'down' },
  { from: 'south', tx: 0, ty: 4, face: 'up' },
  { from: 'west', tx: -4, ty: 0, face: 'right' },
  { from: 'east', tx: 4, ty: 0, face: 'left' },
  { from: 'diagonal', tx: 3, ty: 3, face: 'up' },
]

function approach(start: { tx: number; ty: number }, solidNode: boolean) {
  const player = createActor({ id: 'p', kind: 'player', habitat: 'any', tx: start.tx, ty: start.ty, speed: WALK_SPEED })
  const isNode = (tx: number, ty: number) => tx === NODE.tx && ty === NODE.ty
  const nav = new TapNavigator({
    isSolid: (tx, ty) => solidNode && isNode(tx, ty),
    occupied: () => false,
    isInteractive: (tx, ty) => !solidNode && isNode(tx, ty),
  })
  const rules: MoveRules = { blocked: (_actor, tx, ty) => solidNode && isNode(tx, ty), occupied: () => false }
  const walker = createWalkerState()
  expect(nav.goTo(player, { tile: NODE, actor: null })).toBe(true)
  let interact = false
  for (let t = 0; t < 6 && !interact; t += 1 / 60) {
    driveWalker(player, nav.active ? nav.next : null, 1 / 60, rules, walker, () => nav.arrived(), true)
    interact = nav.update(player, 1 / 60)
  }
  return { player, interact }
}

describe('approaching resource nodes', () => {
  for (const solid of [true, false]) {
    describe(solid ? 'solid host prop' : 'walkable interactive tile', () => {
      it.each(STARTS)('from the $from ends beside the node and faces it', ({ tx, ty, face }) => {
        const { player, interact } = approach({ tx, ty }, solid)
        expect(interact).toBe(true)
        expect(Math.abs(player.tx - NODE.tx) + Math.abs(player.ty - NODE.ty)).toBe(1)
        if (tx === 0 || ty === 0) expect(player.dir).toBe(face)
      })
    })
  }

  it('keeps walking onto plain walkable tiles', () => {
    const player = createActor({ id: 'p', kind: 'player', habitat: 'any', tx: 0, ty: 3, speed: WALK_SPEED })
    const nav = new TapNavigator({ isSolid: () => false, occupied: () => false, isInteractive: () => false })
    const walker = createWalkerState()
    const rules: MoveRules = { blocked: () => false, occupied: () => false }
    nav.goTo(player, { tile: NODE, actor: null })
    let interact = false
    for (let t = 0; t < 4; t += 1 / 60) {
      driveWalker(player, nav.active ? nav.next : null, 1 / 60, rules, walker, () => nav.arrived(), true)
      interact = nav.update(player, 1 / 60) || interact
    }
    expect({ tx: player.tx, ty: player.ty }).toEqual(NODE)
    expect(interact).toBe(false)
  })
})
