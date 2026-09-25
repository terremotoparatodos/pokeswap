// WORLD-1 acceptance: real clients (SharedWorld) against the real server core
// (WorldRoom), with the socket replaced by synchronous delivery.

import { describe, expect, it } from 'vitest'
import { WorldRoom } from '../../../../services/realtime/src/world/worldRoom.js'
import { createDemoSkillPolicy } from '../../../../services/realtime/src/world/demoSkillPolicy.js'
import { createStaticOwnership } from '../../../../services/realtime/src/world/pokemonOwnership.js'
import { RESPAWN_MS, resourceAt } from '../../../../services/realtime/src/world/resourceLayout.js'
import { praderaNodesNearSpawn } from '../../../../services/realtime/src/world/testing.js'
import { World } from '../../wildlands/engine/world'
import type { PokemonInfo } from '../../wildlands/engine/actors'
import { SharedWorld } from './sharedWorld'

const [{ node: TREE, stands: [SPOT_A, SPOT_B] }] = praderaNodesNearSpawn()

function stage() {
  let now = 5_000_000
  const actors = new Map<string, { id: string; areaId: string; tx: number; ty: number }>()
  const sockets = new Map<string, { send: (type: string, payload: unknown) => void }>()
  const skills = createDemoSkillPolicy({ durationMs: 3_000 })
  const server = new WorldRoom({
    skills, ownership: createStaticOwnership({ a: [123], b: [6], c: [7] }), now: () => now,
    lookupActor: (id: string) => actors.get(id) ?? null, clientForPlayer: (id: string) => sockets.get(id) ?? null,
  })
  const placeholder = (id: number) => ({ id, name: String(id), shiny: false, frames: {} }) as unknown as PokemonInfo
  const connect = (id: string, spot: { tx: number; ty: number }) => {
    const world = new SharedWorld(async () => null, placeholder)
    const socket = {
      send: (type: string, payload: unknown) => {
        const sink = world as unknown as Record<string, (value: unknown) => void>
        const handler = { 'world:snapshot': 'snapshot', 'world:batch': 'batch', 'world:work:result': 'workResult', 'world:work:done': 'workDone', 'world:wild': 'wild' }[type]
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
  const context = (area = 'pradera') => ({ area: () => ({ id: area }) as never, playerTile: (id: string) => actors.get(id) ?? null, isSolid: () => false })
  return { server, skills, connect, advance, context, get now() { return now } }
}

describe('WORLD-1 shared resources, two clients', () => {
  it('both clients derive the same node ids from the tiles they draw', () => {
    const world = new World(208)
    for (let ty = TREE.ty - 10; ty <= TREE.ty + 10; ty++) {
      for (let tx = TREE.tx - 10; tx <= TREE.tx + 10; tx++) {
        const node = resourceAt('pradera', tx, ty)
        // The browser draws exactly the prop the id names.
        if (node) expect(world.decorAt(tx, ty)).toBe(node.variantId)
      }
    }
  })

  it('A chops, B sees the tree working with A and the Pokémon, B is refused, then depleted for all', async () => {
    const s = stage()
    const a = s.connect('a', SPOT_A)
    const b = s.connect('b', SPOT_B)
    const started = await a.world.requestWork(TREE.id, 123)
    expect(started.ok).toBe(true)
    s.server.flush()

    const seen = b.world.resources.node(TREE.id)
    expect(seen).toMatchObject({ state: 'working', workKind: 'chop', worker: { playerId: 'a', pokemonInstanceId: 123 } })
    b.world.update(0, s.context())
    expect(b.world.actors().map(actor => actor.pokemon?.id)).toEqual([123])
    // A's own follower is the one working: every client hides it.
    expect(b.world.hidesCompanion('a', 123)).toBe(true)

    expect((await b.world.requestWork(TREE.id, 6)).ok).toBe(false)

    await s.advance(3_000)
    expect(a.world.resources.node(TREE.id)?.state).toBe('depleted')
    expect(b.world.resources.node(TREE.id)?.state).toBe('depleted')
    b.world.update(0, s.context())
    expect(b.world.actors()).toHaveLength(0)
    expect(s.skills.grants).toBe(1)

    // A newcomer sees DEPLETED, not a fresh tree.
    const c = s.connect('c', { tx: SPOT_A.tx + 3, ty: SPOT_A.ty })
    expect(c.world.resources.node(TREE.id)?.state).toBe('depleted')

    // Respawn: everyone at once.
    await s.advance(RESPAWN_MS.tree)
    for (const client of [a, b, c]) expect(client.world.resources.node(TREE.id)).toBeNull()
    for (const client of [a, b, c]) expect(client.world.resources.knows('pradera', TREE.tx, TREE.ty)).toBe(true)
  })

  it('a reconnecting client gets the same state and its own action back', async () => {
    const s = stage()
    const a = s.connect('a', SPOT_A)
    const started = await a.world.requestWork(TREE.id, 123)
    a.world.detach()
    expect(a.world.resources.node(TREE.id)).toBeNull()
    s.server.leave(a.socket)
    const again = s.connect('a', SPOT_A)
    expect(again.world.resources.node(TREE.id)?.state).toBe('working')
    expect(again.world.ownAction?.actionId).toBe(started.ok ? started.actionId : 'missing')
  })

  it('the server clock is shared: both clients agree on the progress of an action', async () => {
    const s = stage()
    const a = s.connect('a', SPOT_A)
    const b = s.connect('b', SPOT_B)
    await a.world.requestWork(TREE.id, 123)
    s.server.flush()
    const node = b.world.resources.node(TREE.id)!
    const skew = Math.abs((a.world.serverNow() ?? 0) - (b.world.serverNow() ?? 0))
    expect(skew).toBeLessThan(50)
    expect(node.endsAt! - node.startedAt!).toBe(3_000)
  })
})

describe('WORLD-1 wild population fails closed', () => {
  it('an unavailable status clears the roster and is kept as the reason', () => {
    const world = new SharedWorld(async () => null, id => ({ id, name: String(id), shiny: false, frames: {} }) as unknown as PokemonInfo)
    world.snapshot({ now: 1, areaId: 'pradera', chunks: [], nodes: [], wild: { areaId: 'pradera', epoch: 1, entities: [] }, wildStatus: 'ready' })
    expect(world.wildRoster('pradera')).not.toBeNull()
    world.wild({ now: 2, wild: null, status: 'unavailable' })
    expect(world.wildRoster('pradera')).toBeNull()
    expect(world.wildStatus).toBe('unavailable')
  })
})
