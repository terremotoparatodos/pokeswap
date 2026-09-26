import { describe, expect, it } from 'vitest'
import type { PokemonInfo } from '../../wildlands/engine/actors'
import type { NodeView } from '../domain/worldResources'
import { WorkerActors, workerSpot } from './workerActors'

describe('workerSpot (fallback without worker.stand)', () => {
  const open = () => false
  it('stands on the open side of the node nearest the trainer, never on the trainer', () => {
    const spot = workerSpot({ tx: 0, ty: 0 }, { tx: 0, ty: 1 }, open)
    expect(spot).not.toMatchObject({ tx: 0, ty: 1 })
    expect(Math.max(Math.abs(spot.tx), Math.abs(spot.ty - 1))).toBe(1)
  })
  it('faces the node', () => {
    expect(workerSpot({ tx: 0, ty: 0 }, null, open)).toEqual({ tx: 0, ty: 1, dir: 'up' })
    expect(workerSpot({ tx: 0, ty: 0 }, null, (tx, ty) => tx === 0 && ty === 1)).toEqual({ tx: 1, ty: 0, dir: 'left' })
  })
  it('is the same for every client given the same facts', () => {
    const a = workerSpot({ tx: 5, ty: 5 }, { tx: 4, ty: 5 }, (tx) => tx === 6)
    const b = workerSpot({ tx: 5, ty: 5 }, { tx: 4, ty: 5 }, (tx) => tx === 6)
    expect(a).toEqual(b)
  })
})

describe('WorkerActors', () => {
  const placeholder = (id: number) => ({ id, name: String(id), shiny: false, frames: {} }) as unknown as PokemonInfo
  const make = () => new WorkerActors(async () => null, placeholder)
  const STAND = { tx: 11, ty: 20, dir: 'left' as const }
  const working = (stand: typeof STAND | undefined = STAND): NodeView => ({
    id: 'pradera:10:20:tree', state: 'working', version: 3, actionId: 'act-1', workKind: 'chop', startedAt: 1_000, endsAt: 4_000,
    worker: { playerId: 'a', pokemonInstanceId: 123, speciesId: 123, ...(stand ? { stand } : {}) },
  })
  const tile = (workers: WorkerActors) => workers.actors().map(actor => ({ tx: actor.fromTx, ty: actor.fromTy, dir: actor.dir }))

  it('places the worker on the server stand, whatever the trainer does or wherever it is', () => {
    const workers = make()
    workers.sync([working()])
    for (const trainer of [{ tx: 10, ty: 21 }, { tx: 9, ty: 20 }, null]) {
      workers.update(2_000, () => trainer, () => false)
      expect(tile(workers)).toEqual([STAND])
    }
  })

  it('two clients with the same node and the same server time draw the same actor', () => {
    const [one, two] = [make(), make()]
    for (const workers of [one, two]) workers.sync([working()])
    one.update(2_345, () => ({ tx: 10, ty: 21 }), () => false)
    two.update(2_345, () => null, () => true)
    const pick = (w: WorkerActors) => { const { fromTx, fromTy, tx, ty, progress, dir, hop, walkClock } = w.actors()[0]; return { fromTx, fromTy, tx, ty, progress, dir, hop, walkClock } }
    expect(pick(one)).toEqual(pick(two))
  })

  it('an older server without worker.stand: the previous per-client placement', () => {
    const workers = make()
    workers.sync([working(undefined)])
    workers.update(2_000, () => ({ tx: 10, ty: 21 }), () => false)
    const expected = workerSpot({ tx: 10, ty: 20 }, { tx: 10, ty: 21 }, () => false)
    expect(tile(workers)).toEqual([expected])
  })

  it('one actor per action, and it goes away with the action', () => {
    const workers = make()
    workers.sync([working(), working()])
    expect(workers.actors()).toHaveLength(1)
    expect(workers.isWorking('a', 123)).toBe(true)
    // Complete, cancel and cancel-by-movement all reach the client the same way: the node stops working.
    workers.sync([{ id: 'pradera:10:20:tree', state: 'available', version: 4 }])
    expect(workers.actors()).toHaveLength(0)
    expect(workers.isWorking('a', 123)).toBe(false)
  })

  it('each worker animates to its own node’s task, the same for every client', () => {
    const kinds = ['chop', 'mine', 'farm'] as const
    const draw = () => {
      const workers = make()
      workers.sync(kinds.map((workKind, i) => ({ ...working(), id: `pradera:${10 + i * 5}:20:x`, actionId: `act-${workKind}`, workKind: workKind as NodeView['workKind'] })))
      workers.update(1_260, () => null, () => false)
      return workers.actors().map(actor => ({ progress: actor.progress, hop: actor.hop, walkClock: actor.walkClock }))
    }
    const [one, two] = [draw(), draw()]
    expect(one).toEqual(two)
    expect(new Set(one.map(pose => JSON.stringify(pose))).size).toBe(3)
  })
})
