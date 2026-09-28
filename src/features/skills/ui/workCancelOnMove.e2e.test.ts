import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyMove } from '../../../../services/realtime/src/presence/movement.js'
import { PLOTS } from '../../../../services/realtime/src/world/plots.js'
import { createStaticOwnership } from '../../../../services/realtime/src/world/pokemonOwnership.js'
import { praderaNodesNearSpawn } from '../../../../services/realtime/src/world/testing.js'
import { standableTile } from '../../../../services/realtime/src/world/workPlacement.js'
import { WORK_TICK_MS, WORLD_PROTOCOL } from '../../../../services/realtime/src/world/worldProtocol.js'
import { WorldRoom } from '../../../../services/realtime/src/world/worldRoom.js'
import type { Dir } from '../../wildlands/engine/characters'
import { WildlandsGame } from '../../wildlands/engine/game'
import type { PokemonInfo } from '../../wildlands/engine/actors'
import { SharedWorld } from '../../world/state/sharedWorld'
import { useFarmPlots } from '../../worldSkills/client/useFarmPlots'
import { createWorldSkillsSession } from '../../worldSkills/client/worldSkillsSession'
import { skillsResourceFor } from '../../worldSkills/resourceMapping'
import { useSkillsLayer } from './useSkillsLayer'

// WORK CANCEL-1, end to end through the REAL client: the WildlandsGame engine
// (keyboard events, tap-to-move on its renderer, the mobile d-pad), the Skills
// layer and SharedWorld, against the real WorldRoom, the real SKILLS bundle
// and the presence movement rules. Nothing is injected past the client: a
// cancellation only happens if the engine really sends the move.

const BUNDLE = '../../../../services/realtime/src/world/skills/skills.generated.js'
const SCYTHER = 123
const DIGLETT = 50
const MILTANK = 241
const isOpen = standableTile('pradera')
const nearSpawn = praderaNodesNearSpawn(30)
const nodeFor = (resourceId: string) => nearSpawn.find(({ node, stands }) => skillsResourceFor(node)?.id === resourceId && stands.length >= 1)!
const TREE = nodeFor('common_tree')
const ROCK = nodeFor('stone_outcrop')
const PLOT = PLOTS[0]
const DELTA: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }

// jsdom has no 2D canvas: a context that accepts every call is enough for the engine to run and render.
function stubContext(): CanvasRenderingContext2D {
  const imageData = (a?: unknown, b?: number, c?: number, d?: number) => {
    const w = typeof a === 'number' ? (d ? c! : a) : 1
    const h = typeof a === 'number' ? (d ? d : b!) : 1
    return { width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) }
  }
  return new Proxy({}, {
    get: (_target, key) => {
      if (key === 'canvas') return { width: 320, height: 240 }
      if (key === 'measureText') return () => ({ width: 1 })
      if (key === 'getImageData' || key === 'createImageData') return imageData
      if (key === 'createLinearGradient' || key === 'createRadialGradient' || key === 'createPattern') return () => ({ addColorStop() {}, setTransform() {} })
      return () => undefined
    },
    set: () => true,
  }) as CanvasRenderingContext2D
}

interface Store {
  settlements: Map<string, { xpGained: number; rewards: unknown[] }>
  playerState(): Promise<unknown>
  commitWork(commit: { actionId: string; xpGained: number; rewards: unknown[] }): Promise<unknown>
}

function memoryStore(): Store {
  const settlements = new Map<string, { xpGained: number; rewards: unknown[] }>()
  return {
    settlements,
    async playerState() { return { xp: { woodcutting: 0, mining: 0, farming: 0 }, materials: {}, pokemon: [] } },
    async commitWork(commit) {
      if (settlements.has(commit.actionId)) return { applied: false, settlement: { xp_after: 0 } }
      settlements.set(commit.actionId, { xpGained: commit.xpGained, rewards: commit.rewards })
      return { applied: true, settlement: { xp_after: commit.xpGained } }
    },
  }
}

type ServerActor = { id: string; areaId: 'pradera'; tx: number; ty: number; dir: Dir; speed: number; moveSequence: number; username: string; characterId: string; companionId: null }
type Socket = { send(type: string, payload: unknown): void }

/** A drawable placeholder worker (the app uses a pokéball-style one the same way). */
function placeholderPokemon(pid: number): PokemonInfo {
  const canvas = document.createElement('canvas')
  const sprite = { canvas, shadow: canvas, w: 16, h: 16, ax: 8, ay: 15 }
  const frames = { up: [sprite], down: [sprite], left: [sprite], right: [sprite] }
  return { id: pid, name: String(pid), shiny: false, frames } as unknown as PokemonInfo
}

const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0))

async function stage({ random = () => 0.9999999 }: { random?: () => number } = {}) {
  let now = 50_000_000
  const { createSkillsWorldPolicy } = (await import(/* @vite-ignore */ BUNDLE)) as { createSkillsWorldPolicy: (options: unknown) => unknown }
  const store = memoryStore()
  const actors = new Map<string, ServerActor>()
  const sockets = new Map<string, Socket>()
  const games = new Map<string, WildlandsGame>()
  const remote = (actor: ServerActor) => ({ ...actor })
  const world: WorldRoom = new WorldRoom({
    skills: createSkillsWorldPolicy({ store, now: () => now, random }),
    ownership: createStaticOwnership({ owner: [SCYTHER, DIGLETT, MILTANK], viewer: [] }),
    now: () => now,
    lookupActor: (id: string) => actors.get(id) ?? null,
    clientForPlayer: (id: string) => sockets.get(id) ?? null,
    // What presence does: move the actor, reconcile the world, ack the owner.
    placeActor: (id: string, place: { tx: number; ty: number; dir: Dir }) => {
      const actor = actors.get(id)!
      Object.assign(actor, place)
      actor.moveSequence++
      world.viewerMoved(sockets.get(id)!, actor)
      games.get(id)?.setAuthoritativeActor(remote(actor), 'self')
    },
  } as ConstructorParameters<typeof WorldRoom>[0])

  const pendingMoves: { id: string; dir: Dir; running: boolean; sequence: number }[] = []
  const sent: Dir[] = []

  /** Server side of a move intent, as PresenceRoom.move does it. */
  const serveMoves = () => {
    for (const move of pendingMoves.splice(0)) {
      const actor = actors.get(move.id)!
      const rejection = applyMove(actor, move.dir, now, move.running, move.sequence)
      if (!rejection) world.viewerMoved(sockets.get(move.id)!, actor)
      games.get(move.id)?.setAuthoritativeActor(remote(actor), 'self')
    }
  }

  function connect(id: string, spot: { tx: number; ty: number }, withGame: boolean) {
    const shared = new SharedWorld(async () => null, placeholderPokemon)
    const socket: Socket = {
      send: (type, payload) => {
        const sink = shared as unknown as Record<string, (value: unknown) => void>
        const handler = ({ 'world:snapshot': 'snapshot', 'world:batch': 'batch', 'world:work:result': 'workResult', 'world:work:done': 'workDone', 'world:wild': 'wild' } as Record<string, string>)[type]
        if (handler) sink[handler](payload)
      },
    }
    const actor: ServerActor = { id, areaId: 'pradera', tx: spot.tx, ty: spot.ty, dir: 'down', speed: 3.75, moveSequence: 0, username: id, characterId: 'lucas', companionId: null }
    actors.set(id, actor); sockets.set(id, socket)
    world.join(socket, { worldProtocol: WORLD_PROTOCOL }, { kind: 'player', userId: id, token: null })
    shared.attach((type, payload) => {
      if (type === 'world:work') void world.work(actor, payload, socket)
      if (type === 'world:cancel') world.cancel(actor, payload, socket)
    })
    world.snapshot(socket, actor)
    if (!withGame) return { id, shared, actor }

    const canvas = document.createElement('canvas')
    Object.defineProperty(canvas, 'clientWidth', { value: 480 })
    Object.defineProperty(canvas, 'clientHeight', { value: 320 })
    canvas.width = 480
    canvas.height = 320
    const session = createWorldSkillsSession(shared)
    const game = new WildlandsGame(canvas, {
      pokedex: [], onHud() {}, startArea: 'pradera', spawn: { tx: spot.tx, ty: spot.ty, dir: 'down' },
      onWorldObject: hit => farm.inspect(hit) || layer.inspect(hit),
      isWorldObject: hit => farm.isWorldObject(hit) || layer.isWorldObject(hit),
      presence: {
        move: (dir: Dir, running: boolean, sequence: number) => { sent.push(dir); pendingMoves.push({ id, dir, running, sequence }) },
        changeArea() {}, observe() {},
      },
    })
    games.set(id, game)
    game.setPresenceAccess('player')
    game.setAuthoritativeActor(remote(actor), 'snapshot')
    game.setWorldLayer(shared)
    const layer = useSkillsLayer(() => game, session, () => shared.serverNow())
    const farm = useFarmPlots(() => game, session, shared)
    game.setSceneOverlay(layer.overlay)
    const internals = game as unknown as { keys: { attach(): void; detach(): void }; update(dt: number): void; renderer: { render(scene: unknown, dt: number): void; pick(x: number, y: number): { tile: { tx: number; ty: number } | null } }; scene(): unknown; area: { id: string; kind: string; tick(): void }; player: { tx: number; ty: number } }
    internals.keys.attach()
    return { id, shared, actor, game, layer, farm, internals }
  }

  type Client = NonNullable<ReturnType<typeof connect>>
  /** Server time only (nothing on screen to watch): the server ticks and flushes, one work tick at a time. */
  async function serverOnly(ms: number) {
    for (let left = ms; left > 0; left -= WORK_TICK_MS) {
      now += Math.min(WORK_TICK_MS, left)
      serveMoves()
      world.tick()
      await flushPromises()
      world.flush()
    }
  }

  /** Real time passes: the server ticks and flushes, the engine updates and renders, moves cross the wire. */
  async function run(ms: number, clients: readonly Client[]) {
    for (let left = ms; left > 0; left -= 16) {
      const dt = Math.min(16, left)
      now += dt
      for (const client of clients) {
        if (!client.internals) continue
        client.internals.update(dt / 1000)
        client.internals.renderer.render(client.internals.scene(), dt / 1000)
        client.internals.area.tick()
      }
      serveMoves()
      world.tick()
      await flushPromises()
      world.flush()
    }
  }

  /** The server's authority, as far as these tests look at it. */
  const authority = world.authority as unknown as {
    actions: Map<string, { endsAt: number }>
    metrics: { cancelled: number }
    store: { get(id: string): { state: string } | null }
  }
  return { world, authority, store, actors, connect, run, serverOnly, sent, get now() { return now } }
}

type Stage = Awaited<ReturnType<typeof stage>>
type Owner = ReturnType<Stage['connect']> & { game: WildlandsGame }

/** A direction from the trainer's (authoritative) tile onto open ground, away from the node and the worker. */
function freeDirection(from: { tx: number; ty: number }, avoid: readonly { tx: number; ty: number }[]): Dir {
  for (const dir of ['down', 'up', 'left', 'right'] as Dir[]) {
    const [dx, dy] = DELTA[dir]
    const tx = from.tx + dx
    const ty = from.ty + dy
    if (!isOpen(tx, ty) || avoid.some(t => t.tx === tx && t.ty === ty)) continue
    const [nx, ny] = [tx + dx, ty + dy]
    if (isOpen(nx, ny)) return dir
  }
  throw new Error('no open direction around the trainer')
}

const keyCode: Record<Dir, string> = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' }
const press = (dir: Dir) => window.dispatchEvent(new KeyboardEvent('keydown', { code: keyCode[dir] }))
const release = (dir: Dir) => window.dispatchEvent(new KeyboardEvent('keyup', { code: keyCode[dir] }))

/** Starts gathering on `node` with `pokemon` through the Skills layer, as the card's button does. */
async function startGathering(s: Stage, owner: Owner, node: { tx: number; ty: number }, pokemon: number) {
  const area = owner.internals.area as never
  expect(owner.layer.inspect({ area, tx: node.tx, ty: node.ty })).toBe(true)
  const started = owner.layer.work({ instanceId: String(pokemon), speciesId: pokemon }, 'Worker')
  await s.run(64, [owner])
  expect(await started).toBe(true)
  await s.run(WORK_TICK_MS * 2, [owner])
  expect(owner.layer.phase.value).toBe('working')
  expect(s.authority.actions.size).toBe(1)
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(stubContext() as never)
  // jsdom has no DOMMatrix either; the renderer only uses it for the water pattern's offset.
  if (!('DOMMatrix' in globalThis)) {
    class Matrix { e = 0; f = 0; translateSelf() { return this } translate() { return new Matrix() } multiply() { return new Matrix() } }
    vi.stubGlobal('DOMMatrix', Matrix)
  }
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); for (const dir of ['up', 'down', 'left', 'right'] as Dir[]) release(dir) })

/** Every consequence of a cancel-by-walking, for owner and observer. */
async function expectCancelled(s: Stage, owner: Owner, viewer: { shared: SharedWorld }, nodeId: string, sentBefore: number) {
  expect(s.sent.length).toBeGreaterThan(sentBefore)
  expect(s.authority.actions.size).toBe(0)
  expect(s.authority.metrics.cancelled).toBe(1)
  // The node/plot is as it was: nothing stored, nothing working.
  expect(s.authority.store.get(nodeId)).toBeNull()
  // Owner and observer both lose the worker.
  expect(owner.shared.resources.node(nodeId)).toBeNull()
  expect(viewer.shared.resources.node(nodeId)).toBeNull()
  expect(owner.shared.ownAction).toBeNull()
  // The owner's card and scene are cleared: no timeline, no result pending.
  expect(owner.layer.phase.value).toBe('idle')
  expect(owner.layer.run.value).toBeNull()
  // Nothing paid, and nothing is paid later (past any cap), and no late work:done reaches the owner.
  const doneBefore = owner.layer.result.value
  await s.serverOnly(40 * WORK_TICK_MS)
  await s.run(64, [owner])
  expect(owner.layer.result.value).toBe(doneBefore)
  expect(owner.layer.phase.value).toBe('idle')
  expect(s.store.settlements.size).toBe(0)
  expect(s.authority.store.get(nodeId)).toBeNull()
}

describe('WORK CANCEL-1: walking cancels the work, through the real client', { timeout: 30_000 }, () => {
  it('keyboard: an arrow key sends the move, the server cancels, owner and observer see it, nothing is paid', async () => {
    const s = await stage()
    const owner = s.connect('owner', TREE.stands[0], true) as Owner
    const viewer = s.connect('viewer', TREE.stands[1] ?? TREE.stands[0], false)
    await startGathering(s, owner, TREE.node, SCYTHER)
    expect(viewer.shared.resources.node(TREE.node.id)?.worker?.playerId).toBe('owner')
    const at = { tx: owner.internals.player.tx, ty: owner.internals.player.ty }
    const dir = freeDirection(at, [TREE.node, TREE.stands[0]])
    const before = s.sent.length
    press(dir)
    await s.run(400, [owner])
    release(dir)
    await s.run(400, [owner])
    await expectCancelled(s, owner, viewer, TREE.node.id, before)
    // And the trainer did walk, from its authoritative tile.
    const server = s.actors.get('owner')!
    expect(Math.abs(server.tx - at.tx) + Math.abs(server.ty - at.ty)).toBeGreaterThan(0)
    expect({ tx: owner.internals.player.tx, ty: owner.internals.player.ty }).toEqual({ tx: server.tx, ty: server.ty })
  })

  it('tap-to-move: a tap on open ground walks there, which cancels the work', async () => {
    const s = await stage()
    const owner = s.connect('owner', ROCK.stands[0], true) as Owner
    const viewer = s.connect('viewer', ROCK.stands[1] ?? ROCK.stands[0], false)
    await startGathering(s, owner, ROCK.node, DIGLETT)
    const at = { tx: owner.internals.player.tx, ty: owner.internals.player.ty }
    const dir = freeDirection(at, [ROCK.node, ROCK.stands[0]])
    const [dx, dy] = DELTA[dir]
    const goal = { tx: at.tx + 2 * dx, ty: at.ty + 2 * dy }
    // Find the screen point the renderer maps to that tile, and tap it.
    let point: { x: number; y: number } | null = null
    for (let y = 0; y < 320 && !point; y += 2) for (let x = 0; x < 480 && !point; x += 2) {
      const tile = owner.internals.renderer.pick(x, y).tile
      if (tile && tile.tx === goal.tx && tile.ty === goal.ty) point = { x, y }
    }
    expect(point, 'the goal tile is on screen').not.toBeNull()
    const before = s.sent.length
    owner.game.tap(point!.x, point!.y)
    await s.run(1_200, [owner])
    await expectCancelled(s, owner, viewer, ROCK.node.id, before)
    expect(s.actors.get('owner')).toMatchObject(goal)
  })

  it('mobile d-pad: holding an arrow walks and cancels', async () => {
    const s = await stage()
    const owner = s.connect('owner', TREE.stands[0], true) as Owner
    const viewer = s.connect('viewer', TREE.stands[1] ?? TREE.stands[0], false)
    await startGathering(s, owner, TREE.node, SCYTHER)
    const dir = freeDirection({ tx: owner.internals.player.tx, ty: owner.internals.player.ty }, [TREE.node, TREE.stands[0]])
    const before = s.sent.length
    owner.game.setVirtualDir(dir)
    await s.run(400, [owner])
    owner.game.setVirtualDir(null)
    await s.run(400, [owner])
    await expectCancelled(s, owner, viewer, TREE.node.id, before)
  })

  it('Agricultura: walking away while planting leaves the plot empty and pays nothing', async () => {
    const s = await stage()
    const owner = s.connect('owner', { tx: PLOT.tx - 1, ty: PLOT.ty }, true) as Owner
    const viewer = s.connect('viewer', { tx: PLOT.tx, ty: PLOT.ty - 1 }, false)
    const area = owner.internals.area as never
    expect(owner.farm.inspect({ area, tx: PLOT.tx, ty: PLOT.ty })).toBe(true)
    const planting = owner.farm.work({ instanceId: String(MILTANK), speciesId: MILTANK }, 'Miltank', 'oran')
    await s.run(64, [owner])
    await planting
    await s.run(WORK_TICK_MS * 2, [owner])
    expect(owner.farm.phase.value).toBe('working')
    expect(s.authority.store.get(PLOT.id)?.state).toBe('working')
    const dir = freeDirection({ tx: owner.internals.player.tx, ty: owner.internals.player.ty }, [PLOT, { tx: PLOT.tx - 1, ty: PLOT.ty }, ...PLOTS])
    const before = s.sent.length
    press(dir)
    await s.run(400, [owner])
    release(dir)
    await s.run(400, [owner])
    expect(s.sent.length).toBeGreaterThan(before)
    expect(s.authority.store.get(PLOT.id)).toBeNull()
    expect(viewer.shared.resources.node(PLOT.id)).toBeNull()
    expect(owner.farm.phase.value).toBe('idle')
    await s.serverOnly(40 * WORK_TICK_MS)
    expect(s.store.settlements.size).toBe(0)
    expect(s.authority.store.get(PLOT.id)).toBeNull()
  })

  it('several moves: holding the key walks tile after tile; one cancellation, no settlement', async () => {
    const s = await stage()
    const owner = s.connect('owner', TREE.stands[0], true) as Owner
    const viewer = s.connect('viewer', TREE.stands[1] ?? TREE.stands[0], false)
    await startGathering(s, owner, TREE.node, SCYTHER)
    const at = { tx: owner.internals.player.tx, ty: owner.internals.player.ty }
    const dir = freeDirection(at, [TREE.node, TREE.stands[0]])
    const before = s.sent.length
    press(dir)
    await s.run(700, [owner])
    release(dir)
    await s.run(400, [owner])
    expect(s.sent.length - before).toBeGreaterThanOrEqual(2)
    await expectCancelled(s, owner, viewer, TREE.node.id, before)
  })

  it('moving during the last tick still cancels: no reward', async () => {
    // Scyther at level 1 with the worst rolls: the cap, 16 ticks.
    const s = await stage()
    const owner = s.connect('owner', TREE.stands[0], true) as Owner
    const viewer = s.connect('viewer', TREE.stands[1] ?? TREE.stands[0], false)
    await startGathering(s, owner, TREE.node, SCYTHER)
    const action = [...s.authority.actions.values()][0] as { endsAt: number }
    // Inside the last tick (600 ms before the secret end). A short press only turns the
    // trainer (handheld style); holding it steps, and that step must beat the end.
    await s.run(action.endsAt - s.now - WORK_TICK_MS + 50, [owner])
    expect(s.authority.actions.size).toBe(1)
    const dir = freeDirection({ tx: owner.internals.player.tx, ty: owner.internals.player.ty }, [TREE.node, TREE.stands[0]])
    const before = s.sent.length
    press(dir)
    while (s.sent.length === before && s.now < action.endsAt) await s.run(16, [owner])
    expect(s.now, 'the step was sent before the secret end').toBeLessThan(action.endsAt)
    release(dir)
    await s.run(300, [owner])
    await expectCancelled(s, owner, viewer, TREE.node.id, before)
  })

  it('moving right after the success does not undo it: one settlement, the tree stays depleted, then the trainer walks', async () => {
    const s = await stage({ random: () => 0 })
    const owner = s.connect('owner', TREE.stands[0], true) as Owner
    const area = owner.internals.area as never
    owner.layer.inspect({ area, tx: TREE.node.tx, ty: TREE.node.ty })
    const started = owner.layer.work({ instanceId: String(SCYTHER), speciesId: SCYTHER }, 'Scyther')
    await s.run(64, [owner])
    await started
    // First-roll success: the action ends on the first tick and is settled.
    await s.run(WORK_TICK_MS + 100, [owner])
    expect(s.store.settlements.size).toBe(1)
    const dir = freeDirection({ tx: owner.internals.player.tx, ty: owner.internals.player.ty }, [TREE.node, TREE.stands[0]])
    const before = s.sent.length
    press(dir)
    await s.run(400, [owner])
    release(dir)
    await s.run(2_000, [owner])
    expect(s.sent.length).toBeGreaterThan(before)
    expect(s.authority.metrics.cancelled).toBe(0)
    expect(s.store.settlements.size).toBe(1)
    expect(s.authority.store.get(TREE.node.id)?.state).toBe('depleted')
  })

  it('reconnecting after the cancellation finds no action and the tree free', async () => {
    const s = await stage()
    const owner = s.connect('owner', TREE.stands[0], true) as Owner
    const viewer = s.connect('viewer', TREE.stands[1] ?? TREE.stands[0], false)
    await startGathering(s, owner, TREE.node, SCYTHER)
    const dir = freeDirection({ tx: owner.internals.player.tx, ty: owner.internals.player.ty }, [TREE.node, TREE.stands[0]])
    press(dir)
    await s.run(400, [owner])
    release(dir)
    await s.run(400, [owner])
    await expectCancelled(s, owner, viewer, TREE.node.id, 0)
    const again = s.connect('owner', s.actors.get('owner')!, false)
    expect(again.shared.ownAction).toBeNull()
    expect(again.shared.resources.node(TREE.node.id)).toBeNull()
  })
})
