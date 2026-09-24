import { describe, expect, it } from 'vitest'
import { createActor } from '../engine/actors'
import { CollisionTrace } from './collisionTrace'

describe('collision trace', () => {
  it('names the townsperson in the way, once per bump', () => {
    let now = 1000
    const trace = new CollisionTrace(() => now)
    const player = createActor({ id: 'player', kind: 'player', habitat: 'any', tx: 5, ty: 5, dir: 'right' })
    const npc = createActor({ id: 'town:n1', kind: 'npc', habitat: 'land', tx: 6, ty: 5 })
    player.bumping = true
    trace.frame(player, [npc])
    now = 1016; trace.frame(player, [npc])
    player.bumping = false; trace.frame(player, [npc])
    now = 2000; player.bumping = true; player.dir = 'up'; trace.frame(player, [npc])
    const report = trace.report()
    expect(report.npcBlocks).toBe(1)
    expect(report.terrainBlocks).toBe(1)
    expect(report.events[0]).toEqual({ at: 1000, cause: 'npc', actorId: 'town:n1', tx: 6, ty: 5 })
    expect(report.events[1]).toMatchObject({ at: 2000, cause: 'terrain', actorId: null, tx: 5, ty: 4 })
  })
})
