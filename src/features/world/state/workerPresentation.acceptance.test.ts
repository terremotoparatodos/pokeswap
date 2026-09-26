// WORLD VISUAL-1 acceptance: two real clients (SharedWorld) against the real
// server core (WorldRoom). The owner and an observer draw the same single
// worker on the same server-chosen tile, for the whole life of the action.

import { describe, expect, it } from 'vitest'
import { WorldRoom } from '../../../../services/realtime/src/world/worldRoom.js'
import { createDemoSkillPolicy } from '../../../../services/realtime/src/world/demoSkillPolicy.js'
import { createStaticOwnership } from '../../../../services/realtime/src/world/pokemonOwnership.js'
import { praderaNodesNearSpawn } from '../../../../services/realtime/src/world/testing.js'
import { hiddenBehindCanopy, standableTile, workerStand } from '../../../../services/realtime/src/world/workerStand.js'
import type { PokemonInfo } from '../../wildlands/engine/actors'
import { SharedWorld } from './sharedWorld'

const [{ node: TREE, stands: [SPOT_A, SPOT_B, SPOT_C] }] = praderaNodesNearSpawn().filter(entry => entry.stands.length >= 3)

function stage() {
  let now = 5_000_000
  const actors = new Map<string, { id: string; areaId: string; tx: number; ty: number }>()
  const sockets = new Map<string, { send: (type: string, payload: unknown) => void }>()
  const skills = createDemoSkillPolicy({ durationMs: 3_000 })
  const server = new WorldRoom({
    skills, ownership: createStaticOwnership({ a: [123], b: [6] }), now: () => now,
    lookupActor: (id: string) => actors.get(id) ?? null, clientForPlayer: (id: string) => sockets.get(id) ?? null,
  })
  const placeholder = (id: number) => ({ id, name: String(id), shiny: false, frames: {} }) as unknown as PokemonInfo
  const connect = (id: string, spot: { tx: number; ty: number }) => {
    const world = new SharedWorld(async () => null, placeholder)
    world.playerState({ playerId: id, xp: {}, materials: {}, pokemon: [] })
    const socket = {
      send: (type: string, payload: unknown) => {
        const sink = world as unknown as Record<string, (value: unknown) => void>
        const handler = { 'world:snapshot': 'snapshot', 'world:batch': 'batch', 'world:work:result': 'workResult', 'world:work:done': 'workDone' }[type]
        if (handler) sink[handler](payload)
      },
    }
    const actor = { id, areaId: 'pradera', tx: spot.tx, ty: spot.ty }
    actors.set(id, actor); sockets.set(id, socket)
    server.join(socket, { worldProtocol: 1 }, { kind: 'player', userId: id, token: null })
    world.attach((type, payload) => {
      if (type === 'world:work') void server.work(actor, payload)
      if (type === 'world:cancel') server.cancel(actor, payload)
    })
    server.snapshot(socket, actor)
    return { world, actor, socket }
  }
  const settle = () => new Promise(resolve => setTimeout(resolve, 0))
  const advance = async (ms: number) => { now += ms; server.tick(); await settle(); server.flush() }
  // The trainer tile and terrain only matter to the no-stand fallback; they are hostile here on purpose.
  const context = () => ({ area: () => ({ id: 'pradera' }) as never, playerTile: (id: string) => actors.get(id) ?? null, isSolid: () => false })
  const workersOf = (world: SharedWorld) => {
    world.update(0, context())
    return world.actors().map(actor => ({ id: actor.id, pokemon: actor.pokemon?.id, tx: actor.fromTx, ty: actor.fromTy, dir: actor.dir }))
  }
  return { server, skills, actors, connect, advance, workersOf }
}

const expectedStand = (trainer: { tx: number; ty: number }) => workerStand(TREE, trainer, standableTile('pradera'), hiddenBehindCanopy('pradera'))

describe('WORLD VISUAL-1: one authoritative worker', () => {
  it('owner and observer draw exactly one worker, on the same server stand', async () => {
    const s = stage()
    const a = s.connect('a', SPOT_A)
    const b = s.connect('b', SPOT_B)
    await a.world.requestWork(TREE.id, 123)
    s.server.flush()
    const stand = expectedStand(SPOT_A)
    expect(a.world.resources.node(TREE.id)?.worker?.stand).toEqual(stand)
    expect(b.world.resources.node(TREE.id)?.worker?.stand).toEqual(stand)
    const drawn = { pokemon: 123, tx: stand.tx, ty: stand.ty, dir: stand.dir }
    // The owner's own worker is drawn by WORLD too (it used to be filtered out and drawn by SKILLS).
    expect(s.workersOf(a.world)).toMatchObject([drawn])
    expect(s.workersOf(b.world)).toMatchObject([drawn])
    // …and its follower is hidden while it works, on the owner's client as on everyone else's: never two.
    expect(a.world.hidesCompanion('a', 123)).toBe(true)
    expect(b.world.hidesCompanion('a', 123)).toBe(true)
  })

  it('the trainer moving around the node or disconnecting never moves the worker; it stays until paid', async () => {
    const s = stage()
    const a = s.connect('a', SPOT_A)
    const b = s.connect('b', SPOT_B)
    await a.world.requestWork(TREE.id, 123)
    s.server.flush()
    const before = s.workersOf(b.world)
    // Step to another side of the tree: still within reach, the action runs on.
    a.actor.tx = SPOT_C.tx; a.actor.ty = SPOT_C.ty
    s.server.viewerMoved(a.socket, a.actor)
    s.server.flush()
    expect(s.workersOf(b.world)).toEqual(before)
    // Disconnect: the presence actor is gone, so a trainer-relative placement would jump.
    a.world.detach()
    s.server.leave(a.socket)
    s.actors.delete('a')
    await s.advance(1_500)
    expect(s.workersOf(b.world)).toEqual(before)
    await s.advance(1_500)
    expect(b.world.resources.node(TREE.id)?.state).toBe('depleted')
    expect(s.workersOf(b.world)).toEqual([])
    expect(s.skills.grants).toBe(1)
  })

  it('complete, cancel and cancel-by-movement remove the worker for owner and observer', async () => {
    for (const end of ['complete', 'cancel', 'moved'] as const) {
      const s = stage()
      const a = s.connect('a', SPOT_A)
      const b = s.connect('b', SPOT_B)
      const started = await a.world.requestWork(TREE.id, 123)
      s.server.flush()
      expect(s.workersOf(a.world)).toHaveLength(1)
      if (end === 'complete') await s.advance(3_000)
      else if (end === 'cancel') { a.world.cancelWork(started.ok ? started.actionId : ''); s.server.flush() }
      else { a.actor.tx += 3; s.server.viewerMoved(a.socket, a.actor); s.server.flush() }
      expect(s.workersOf(a.world), end).toEqual([])
      expect(s.workersOf(b.world), end).toEqual([])
      expect(a.world.hidesCompanion('a', 123), end).toBe(false)
    }
  })
})
