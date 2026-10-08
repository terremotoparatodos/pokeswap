// ECO-OVERWORLD-BATTLE-1: a busy ECO encounter (someone's test battle) stands still on the tile the
// server lists for it — the same tile on every client — and rejoins its shared patrol when free.

import { describe, expect, it, vi } from 'vitest'
import type { EcoArea } from '../../../../services/realtime/src/world/worldProtocol.js'
import type { Actor } from './actors'
import type { SharedPopulace } from './area'

vi.mock('./characters', async importOriginal => ({
  ...(await importOriginal<typeof import('./characters')>()),
  loadOverworldFrames: vi.fn(async () => ({ stand: 1 }) as never),
}))

const { EcoActors } = await import('./ecoPopulace')
const { followPatrol } = await import('./patrolMotion')

const ID = 'eco-n:pradera:nest:1:0'
const area = (busy: boolean, tx = 4, ty = 2): EcoArea => ({ protocol: 1, areaId: 'pradera', status: 'active', encounters: [{ id: ID, groupId: 'g', speciesId: 13, tx, ty, busy }] })
const shared = { walkable: () => true, serverNow: () => 0 } as unknown as SharedPopulace

async function spawned(busy: boolean) {
  const actors: Actor[] = []
  const eco = new EcoActors([], actors)
  eco.sync(area(busy), shared)
  await vi.waitFor(() => expect(actors).toHaveLength(1))
  return { eco, actors, actor: actors[0] }
}

describe('EcoActors · busy encounters stand still on the server tile', () => {
  it('free: it follows its shared patrol; busy: it stands on the listed tile with no patrol; free again: back on the patrol', async () => {
    const { eco, actor } = await spawned(false)
    const patrol = actor.patrol
    expect(patrol).toBeDefined()
    followPatrol(actor, 123_456) // somewhere along its loop
    eco.sync(area(true), shared)
    expect(actor.patrol).toBeUndefined()
    expect([actor.tx, actor.ty, actor.fromTx, actor.fromTy, actor.progress]).toEqual([4, 2, 4, 2, 1])
    followPatrol(actor, 999_999) // no patrol: nothing moves it
    expect([actor.tx, actor.ty]).toEqual([4, 2])
    eco.sync(area(false), shared)
    expect(actor.patrol).toBe(patrol)
  })

  it('already busy when it loads: it stands still from the start', async () => {
    const { actor } = await spawned(true)
    expect(actor.patrol).toBeUndefined()
    expect([actor.tx, actor.ty]).toEqual([4, 2])
  })

  it('two clients with the same list place it on the same tile, whatever their local patrol pose was', async () => {
    const a = await spawned(false)
    const b = await spawned(false)
    followPatrol(a.actor, 10_000)
    followPatrol(b.actor, 77_000)
    a.eco.sync(area(true), shared)
    b.eco.sync(area(true), shared)
    expect([a.actor.tx, a.actor.ty]).toEqual([b.actor.tx, b.actor.ty])
  })
})
