import { describe, expect, it } from 'vitest'
import { createActor } from './actors'
import { followPatrol } from './patrolMotion'
import { buildPatrol } from '../../../../services/realtime/src/world/patrol.js'
import { World } from './world'

describe('shared wandering (WORLD-1D)', () => {
  const world = new World(208)
  const walkable = (tx: number, ty: number) => !world.isSolid(tx, ty) && !world.isWater(tx, ty)
  const home = { tx: -2, ty: -67 }

  it('two clients draw the same wanderer at the same tile at the same server time', () => {
    // Each client builds its own patrol from the same facts, as Population does.
    const a = createActor({ id: 'wild:pradera:1:25', kind: 'pokemon', habitat: 'land', ...home })
    const b = createActor({ id: 'wild:pradera:1:25', kind: 'pokemon', habitat: 'land', ...home })
    a.patrol = buildPatrol({ key: a.id, home, walkable, speed: 3 })
    b.patrol = buildPatrol({ key: b.id, home, walkable, speed: 3 })
    for (let t = 1_727_000_000_000; t < 1_727_000_060_000; t += 777) {
      followPatrol(a, t)
      followPatrol(b, t)
      expect([a.fromTx, a.fromTy, a.tx, a.ty, a.progress, a.dir]).toEqual([b.fromTx, b.fromTy, b.tx, b.ty, b.progress, b.dir])
    }
  })

  it('moves one tile at a time, like any walker', () => {
    const actor = createActor({ id: 'npc', kind: 'npc', habitat: 'land', ...home })
    actor.patrol = buildPatrol({ key: 'npc', home, walkable, speed: 3.2 })
    let moved = 0
    for (let t = 0; t < 120_000; t += 50) {
      followPatrol(actor, t)
      expect(Math.abs(actor.tx - actor.fromTx) + Math.abs(actor.ty - actor.fromTy)).toBeLessThanOrEqual(1)
      if (actor.progress < 1) moved++
    }
    expect(moved).toBeGreaterThan(0)
  })
})
