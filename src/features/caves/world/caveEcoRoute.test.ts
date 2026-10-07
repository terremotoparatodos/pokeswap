// @vitest-environment node
// ECO-GAMEPLAY-1 smoke defect (cave drew nothing): the REAL cave route, end to end.
//
//   server WorldRoom (ECO experiment) → its messages → client SharedWorld (the engine's world layer)
//   → Atlas('cueva-inicial') = CaveArea → WildlandsGame.prototype.enterArea → populace.update
//
// Two clients must draw exactly the server's cave encounters (real species sprites requested by id,
// at the server's tiles), with no procedural trainer and no roster; a test retirement removes the
// actor in both; the nest respawns; leaving and coming back leaves no stray actor.
// `sharedPopulace` is a constructor field of the game (it needs a real canvas): the harness gives
// it the same shape as game.ts (`ecoArea: () => worldLayer.ecoArea(area.id)`).

import { describe, expect, it, vi } from 'vitest'
import type { Actor, PokemonInfo } from '../../wildlands/engine/actors'
import type { SharedPopulace } from '../../wildlands/engine/area'

vi.mock('../../world/domain/ecoExperiment', () => ({ ECO_EXPERIMENT: true }))
const requestedSheets: number[] = []
vi.mock('../../wildlands/engine/characters', async importOriginal => ({
  ...(await importOriginal<typeof import('../../wildlands/engine/characters')>()),
  // The real sprite path asks for the species' overworld sheet by id; record it, no image decoding.
  loadOverworldFrames: vi.fn(async (id: number) => { requestedSheets.push(id); return { stand: id } as never }),
}))

const { Atlas } = await import('../../wildlands/areas/atlas')
const { WildlandsGame } = await import('../../wildlands/engine/game')
const { SharedWorld } = await import('../../world/state/sharedWorld')
const { CaveArea } = await import('./caveArea')
const { WorldRoom } = await import('../../../../services/realtime/src/world/worldRoom.js')
const { createDemoSkillPolicy } = await import('../../../../services/realtime/src/world/demoSkillPolicy.js')
const { createStaticOwnership } = await import('../../../../services/realtime/src/world/pokemonOwnership.js')
const { seededRandom } = await import('../../../../services/realtime/src/world/wildPopulation.js')
const { ECO_PROTOCOL, WORLD_MESSAGE, WORLD_PROTOCOL } = await import('../../../../services/realtime/src/world/worldProtocol.js')
const { createActor, createWalkerState } = await import('../../wildlands/engine/actors')
const { AreaTravel } = await import('../../wildlands/engine/travel')

const CAVE = 'cueva-inicial'
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

function server() {
  let now = 1_000_000
  const actors = new Map<string, { id: string; areaId: string; tx: number; ty: number }>()
  const world = new WorldRoom({
    skills: createDemoSkillPolicy({ durationMs: 3_000 }), ownership: createStaticOwnership({}), now: () => now,
    lookupActor: (id: string) => actors.get(id) ?? null, clientForPlayer: () => null,
    ecoExperiment: true, ecoRandom: seededRandom(4242), log: () => {},
  })
  const run = (ms: number, until: () => boolean = () => false) => {
    for (let t = 0; t < ms; t += 1_000) { now += 1_000; world.tick(); world.flush(); if (until()) return true }
    return false
  }
  return { world, actors, run }
}

/** One browser: a socket that hands the server's messages to a real SharedWorld, and the game's area switch. */
function client(id: string, srv: ReturnType<typeof server>) {
  const shared = new SharedWorld(async () => null, n => ({ id: n, name: String(n), shiny: false, frames: {} }) as unknown as PokemonInfo)
  const socket = {
    sessionId: id, userData: undefined,
    send: (type: string, payload: never) => {
      if (type === WORLD_MESSAGE.SNAPSHOT) shared.snapshot(payload)
      if (type === WORLD_MESSAGE.ECO) shared.eco(payload)
    },
    leave() {},
  }
  const actor = { id, areaId: CAVE, tx: 10, ty: 11 }
  srv.actors.set(id, actor)
  srv.world.join(socket, { worldProtocol: WORLD_PROTOCOL, ecoProtocol: ECO_PROTOCOL }, { kind: 'player', userId: id, token: null })
  srv.world.snapshot(socket, actor)

  const g = Object.create(WildlandsGame.prototype) as Record<string, unknown> & { area: { id: string; isSolid(tx: number, ty: number): boolean; isWater(tx: number, ty: number): boolean }; populace: { actors: Actor[]; update(tx: number, ty: number): void } }
  const sharedPopulace: SharedPopulace = {
    serverNow: () => shared.serverNow(),
    wildRoster: () => shared.wildRoster(g.area.id),
    ecoArea: () => shared.ecoArea(g.area.id),
    walkable: (habitat, tx, ty) => !g.area.isSolid(tx, ty) && (habitat === 'any' || g.area.isWater(tx, ty) === (habitat === 'water')),
  }
  Object.assign(g, {
    atlas: new Atlas(), pokedex: [], renderer: { npcSprites: [] }, sharedPopulace, owned: [], wildPokemonIds: [],
    placedObjects: { clearArea() {}, register() {} }, player: createActor({ id: 'player', kind: 'player', habitat: 'any', tx: 0, ty: 0 }),
    camX: 0, camY: 0, nav: { cancel() {} }, companion: { reset() {} }, walker: createWalkerState(), travel: new AreaTravel(),
  })
  const enter = (areaId: string, from: string | null) => {
    actor.areaId = areaId
    srv.world.snapshot(socket, actor)
    ;(g as unknown as { enterArea(id: string, from: string | null, spawn: null): void }).enterArea(areaId, from, null)
  }
  const frame = async () => { g.populace.update(10, 11); await settle(); g.populace.update(10, 11) }
  const drawn = () => g.populace.actors.filter(a => a.wild)
  return { g, shared, socket, actor, enter, frame, drawn }
}

describe('the cave draws the server\'s ECO encounters (real route)', () => {
  it('two clients, retirement, respawn, and leaving/entering without stray actors', async () => {
    const srv = server()
    const a = client('eco-a', srv)
    const b = client('eco-b', srv)
    a.enter(CAVE, 'pradera')
    b.enter(CAVE, 'pradera')
    expect(a.g.area).toBeInstanceOf(CaveArea)
    expect(srv.run(30_000, () => (a.shared.ecoArea(CAVE)?.encounters.length ?? 0) >= 2)).toBe(true)

    const serverList = () => srv.world.eco!.view(CAVE).encounters
    await a.frame(); await b.frame()
    for (const c of [a, b]) {
      expect(c.drawn().map(x => x.id).sort()).toEqual(serverList().map(e => e.id).sort())
      expect(c.g.populace.actors.every(x => x.wild && x.kind === 'pokemon'), 'no trainer, nothing else').toBe(true)
      for (const e of serverList()) {
        const actor = c.drawn().find(x => x.id === e.id)!
        expect([actor.tx, actor.ty, actor.pokemon?.id]).toEqual([e.tx, e.ty, e.speciesId])
      }
    }
    expect(new Set(requestedSheets)).toEqual(new Set(serverList().map(e => e.speciesId)))

    // A test retirement of a whole group: gone in both clients; the others are the same actors.
    const target = serverList()[0]
    const group = serverList().filter(e => e.groupId === target.groupId)
    const keep = serverList().find(e => e.groupId !== target.groupId)
    const kept = keep ? a.drawn().find(x => x.id === keep.id) : undefined
    for (const [i, member] of group.entries()) expect(srv.world.ecoDevRetire(srv.actors.get('eco-a'), { requestId: i + 1, encounterId: member.id }, a.socket).ok).toBe(true)
    srv.world.flush()
    await a.frame(); await b.frame()
    for (const c of [a, b]) expect(c.drawn().some(x => group.some(m => m.id === x.id))).toBe(false)
    if (keep) expect(a.drawn().find(x => x.id === keep.id)).toBe(kept)

    // The nest respawns a new generation, drawn by both.
    const [ns, area, nest, generation] = target.groupId.split(':')
    const fresh = () => serverList().find(e => e.id.startsWith(`${ns}:${area}:${nest}:`) && Number(e.id.split(':')[3]) > Number(generation))
    expect(srv.run(200_000, () => Boolean(fresh()))).toBe(true)
    await a.frame(); await b.frame()
    for (const c of [a, b]) expect(c.drawn().map(x => x.id).sort()).toEqual(serverList().map(e => e.id).sort())

    // Leaving: Pradera's populace holds none of the cave's actors. Coming back: exactly the server's list again.
    a.enter('pradera', CAVE)
    await a.frame()
    const caveIds = new Set(serverList().map(e => e.id))
    expect(a.g.populace.actors.some(x => caveIds.has(x.id))).toBe(false)
    a.enter(CAVE, 'pradera')
    await a.frame()
    expect(a.drawn().map(x => x.id).sort()).toEqual(serverList().map(e => e.id).sort())
    expect(new Set(a.drawn().map(x => x.id)).size).toBe(a.drawn().length)
  }, 30_000)
})
