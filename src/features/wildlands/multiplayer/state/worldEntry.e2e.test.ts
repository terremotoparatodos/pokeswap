import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Atlas } from '../../areas/atlas'
import type { WildlandsGame as Game } from '../../engine/game'
import type { RemotePresenceActor } from '../domain/presence'
import type { WorldEntryState } from '../domain/worldEntry'
import type { WorldEntryController as Controller } from './worldEntryController'
// @ts-expect-error -- the server's wire module ships no declaration file; this test reads one constant from it.
import { AREA as WIRE_AREA } from '../../../../../services/realtime/src/protocol/messages.js'

const AREA = WIRE_AREA as { readonly TOWN: string }

// PRESENCE UX-1 end to end through the REAL client pieces: the WildlandsGame
// engine (its frame loop, renderer call and input guards), the ColyseusPresence
// adapter and the entry controller, wired as WildlandsView wires them. Only the
// Colyseus SDK (a fake room the test speaks for) and Supabase are replaced.
// "Visible" means what the engine handed its renderer, frame by frame.

const sdk = vi.hoisted(() => ({ clients: 0, joins: 0, down: false, refuse: null as number | null, rooms: [] as unknown[], options: [] as Record<string, unknown>[] }))

vi.mock('../../../../shared/api/supabase', () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: null } })) } },
}))

vi.mock('@colyseus/sdk', () => {
  class FakeRoom {
    handlers = new Map<string, (payload: unknown) => void>()
    sent: string[] = []
    reconnection = { enabled: true }
    left = 0
    drop: (() => void) | null = null
    leaveHandler: ((code: number) => void) | null = null
    onMessage(type: string, handler: (payload: unknown) => void) { this.handlers.set(type, handler) }
    send(type: string) { this.sent.push(type) }
    onDrop(handler: () => void) { this.drop = handler }
    onError() {}
    onLeave(handler: (code: number) => void) { this.leaveHandler = handler }
    async leave() { this.left++ }
    emit(type: string, payload: unknown) { this.handlers.get(type)?.(payload) }
  }
  class Client {
    constructor() { sdk.clients++ }
    async joinOrCreate(_name: string, options: Record<string, unknown>) {
      sdk.joins++
      sdk.options.push(options)
      if (sdk.down) throw new Error('realtime down')
      // The SDK rejects a refused join with a ServerError carrying the server's code.
      if (sdk.refuse !== null) throw Object.assign(new Error('refused'), { code: sdk.refuse })
      const room = new FakeRoom()
      sdk.rooms.push(room)
      return room
    }
  }
  return { Client }
})

interface FakeRoom {
  sent: string[]
  left: number
  drop: (() => void) | null
  leaveHandler: ((code: number) => void) | null
  emit(type: string, payload: unknown): void
}

type Modules = {
  WildlandsGame: typeof import('../../engine/game').WildlandsGame
  ColyseusPresence: typeof import('../api/colyseusPresence').ColyseusPresence
  REALTIME_CONFIGURED: boolean
  WorldEntryController: typeof import('./worldEntryController').WorldEntryController
}
let m: Modules

beforeAll(async () => {
  vi.stubEnv('VITE_REALTIME_URL', 'ws://realtime.test')
  vi.resetModules()
  const [engine, adapter, controller] = await Promise.all([
    import('../../engine/game'), import('../api/colyseusPresence'), import('./worldEntryController'),
  ])
  m = { WildlandsGame: engine.WildlandsGame, ColyseusPresence: adapter.ColyseusPresence, REALTIME_CONFIGURED: adapter.REALTIME_CONFIGURED, WorldEntryController: controller.WorldEntryController }
})

// jsdom has no 2D canvas: a context that accepts every call is enough for the engine to run.
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

const frames = new Map<number, FrameRequestCallback>()
let frameId = 0
let clock = 0
function runFrames(count: number): void {
  for (let i = 0; i < count; i++) {
    const queued = [...frames.values()]
    frames.clear()
    clock += 16
    for (const callback of queued) callback(clock)
  }
}
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

beforeEach(() => {
  sdk.clients = 0; sdk.joins = 0; sdk.down = false; sdk.refuse = null; sdk.rooms = []; sdk.options = []
  frames.clear()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(stubContext() as never)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
  if (!('DOMMatrix' in globalThis)) {
    class Matrix { e = 0; f = 0; translateSelf() { return this } translate() { return new Matrix() } multiply() { return new Matrix() } }
    vi.stubGlobal('DOMMatrix', Matrix)
  }
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

const atlas = new Atlas()
function self(areaId: RemotePresenceActor['areaId'], moveSequence = 0): RemotePresenceActor {
  const at = atlas.get(areaId).arrival(null)
  return { id: 'me', areaId, tx: at.tx, ty: at.ty, username: 'Yo', characterId: 'lucas', companionId: null, dir: at.dir, speed: 3.75, moveSequence }
}

interface Internals {
  renderer: { render(scene: { area: { id: string } }, dt: number): void; pick(x: number, y: number): unknown }
  nav: { goTo(...args: unknown[]): void; active: boolean }
  keys: { attach(): void }
  spectator: boolean
  enterArea(...args: unknown[]): void
}

/** The view's online boot: engine on its default area, held; the controller opens the socket. */
function boot() {
  const canvas = document.createElement('canvas')
  Object.defineProperty(canvas, 'clientWidth', { value: 480 })
  Object.defineProperty(canvas, 'clientHeight', { value: 320 })
  const huds: string[] = []
  let presence: InstanceType<Modules['ColyseusPresence']> | null = null
  const game: Game = new m.WildlandsGame(canvas, {
    pokedex: [], onHud: hud => huds.push(hud.areaId),
    presence: {
      move: (direction, running, sequence) => presence?.move(direction, running, sequence),
      changeArea: areaId => presence?.changeArea(areaId),
      observe: (areaId, tx, ty) => presence?.observe(areaId, tx, ty),
    },
  })
  const internals = game as unknown as Internals
  const drawn: string[] = []
  internals.renderer.render = scene => { drawn.push(scene.area.id) }
  internals.renderer.pick = () => ({ tile: { tx: 1, ty: 1 }, actor: null })
  const enterArea = vi.spyOn(internals, 'enterArea')
  const goTo = vi.spyOn(internals.nav, 'goTo')
  const states: WorldEntryState[] = []
  const controller: Controller = new m.WorldEntryController({
    scene: game,
    openSocket: (status, { resume }) => {
      game.setPresenceAccess('pending')
      const socket = new m.ColyseusPresence(game, null, null, status)
      presence = socket
      return { connect: () => void socket.connect(undefined, { resume }), disconnect: () => socket.disconnect() }
    },
    onChange: state => states.push(state),
  })
  controller.start()
  game.start()
  const phase = () => controller.current.phase
  /** Area sequence actually drawn, consecutive repeats folded. */
  const visible = () => drawn.filter((id, i) => id !== drawn[i - 1])
  const room = (index = -1) => sdk.rooms[index < 0 ? sdk.rooms.length + index : index] as FakeRoom
  return { game, internals, controller, drawn, visible, huds, enterArea, goTo, states, phase, room }
}

async function enter(stage: ReturnType<typeof boot>, snapshot: object): Promise<void> {
  await settle()
  stage.room().emit('presence:snapshot', snapshot)
  await settle()
}

describe('first online entry (PRESENCE UX-1)', () => {
  it('runs the online path with a realtime URL', () => {
    expect(m.REALTIME_CONFIGURED).toBe(true)
  })

  it('a player placed in Pradera sees exactly [pradera], and nothing at all before the snapshot', async () => {
    const s = boot()
    await settle()
    runFrames(30)
    expect(s.drawn).toEqual([])
    expect(s.huds).toEqual([])
    expect(s.phase()).toBe('connecting')
    expect(s.room().sent).toContain('presence:ready')
    await enter(s, { access: 'player', self: self('pradera'), actors: [] })
    runFrames(10)
    expect(s.visible()).toEqual(['pradera'])
    expect(s.huds.every(area => area === 'pradera')).toBe(true)
    expect(s.phase()).toBe('ready')
    expect(s.enterArea).toHaveBeenCalledTimes(1)
  })

  it('a player placed in the cave sees exactly [cueva-inicial]', async () => {
    const s = boot()
    runFrames(5)
    await enter(s, { access: 'player', self: self('cueva-inicial'), actors: [] })
    runFrames(10)
    expect(s.visible()).toEqual(['cueva-inicial'])
  })

  it('Ciudad is never drawn before the snapshot, however long the wait', async () => {
    const s = boot()
    await settle()
    for (let i = 0; i < 10; i++) { runFrames(30); await vi.advanceTimersByTimeAsync(1000) }
    expect(s.drawn).not.toContain('ciudad-corazon')
    expect(s.drawn).toEqual([])
  })

  it('a guest sees Ciudad, and only once the server’s guest snapshot arrived', async () => {
    const s = boot()
    runFrames(10)
    expect(s.drawn).toEqual([])
    await enter(s, { access: 'guest', actors: [] })
    runFrames(10)
    // The server starts every observer in AREA.TOWN (guestAreaContract.test.ts).
    expect(s.visible()).toEqual([AREA.TOWN])
    expect(s.internals.spectator).toBe(true)
    expect(s.phase()).toBe('ready')
  })

  it('the scene stays hidden until its area is prepared', async () => {
    const s = boot()
    let finish!: () => void
    vi.spyOn(s.game, 'prepare').mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
    await enter(s, { access: 'player', self: self('pradera'), actors: [] })
    runFrames(20)
    expect(s.drawn).toEqual([])
    expect(s.controller.current).toMatchObject({ phase: 'connecting', authority: true, prepared: false, live: false })
    finish()
    await settle()
    runFrames(5)
    expect(s.visible()).toEqual(['pradera'])
  })

  it('URL and saved-town coordinates are not used online: the engine waits on its default and the server moves it', async () => {
    // A walkable Pradera tile away from its arrival, so only the server can have put the player there.
    const pradera = atlas.get('pradera')
    const start = pradera.arrival(null)
    const tile = [...Array(12).keys()].map(d => ({ tx: start.tx + d + 3, ty: start.ty }))
      .find(t => !pradera.isSolid(t.tx, t.ty) && (pradera.isReachable?.(t.tx, t.ty) ?? true))!
    const s = boot()
    await enter(s, { access: 'player', self: { ...self('pradera'), ...tile }, actors: [] })
    runFrames(3)
    expect(s.game.playerSnapshot()).toMatchObject({ areaId: 'pradera', ...tile })
  })

  it('a repeated snapshot of the same area does not mount it again', async () => {
    const s = boot()
    await enter(s, { access: 'player', self: self('pradera'), actors: [] })
    runFrames(3)
    s.room().emit('presence:snapshot', { access: 'player', self: self('pradera', 0), actors: [] })
    runFrames(3)
    expect(s.enterArea).toHaveBeenCalledTimes(1)
    expect(s.visible()).toEqual(['pradera'])
  })
})

describe('transient reconnection', () => {
  async function ready(area: RemotePresenceActor['areaId'] = 'pradera') {
    const s = boot()
    await enter(s, { access: 'player', self: self(area), actors: [] })
    runFrames(5)
    s.enterArea.mockClear()
    return s
  }

  it('keeps the last scene (no frame drawn) and blocks input while reconnecting', async () => {
    const s = await ready()
    const before = s.drawn.length
    s.room().drop!()
    expect(s.phase()).toBe('reconnecting')
    runFrames(20)
    expect(s.drawn.length).toBe(before)
    // Input: even with the access guard forced open, a held scene refuses taps and drags.
    s.internals.spectator = false
    s.game.tap(10, 10)
    s.game.drag(40, 40)
    expect(s.goTo).not.toHaveBeenCalled()
  })

  it('keyboard (arrows, Space, E) moves and triggers nothing while connecting or reconnecting', async () => {
    const press = (code: string, key = code) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code, key }))
      runFrames(10)
      window.dispatchEvent(new KeyboardEvent('keyup', { code, key }))
    }
    const s = boot()
    const interact = vi.spyOn(s.game, 'interact')
    const goingIn = s.game.playerSnapshot()
    press('ArrowRight'); press('KeyD'); press('Space', ' '); press('KeyE', 'e')
    expect(s.game.playerSnapshot()).toEqual(goingIn)
    expect(s.drawn).toEqual([])
    await enter(s, { access: 'player', self: self('pradera'), actors: [] })
    runFrames(5)
    s.room().drop!()
    expect(s.phase()).toBe('reconnecting')
    const frozen = s.game.playerSnapshot()
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft', key: 'ArrowLeft' }))
    runFrames(30)
    press('Space', ' '); press('KeyE', 'e')
    expect(s.game.playerSnapshot()).toEqual(frozen)
    expect(interact).not.toHaveBeenCalled()
    // A key held through the wait does not walk the player once the scene is back.
    await vi.advanceTimersByTimeAsync(600)
    await settle()
    s.room().emit('presence:snapshot', { access: 'player', self: self('pradera'), actors: [] })
    await settle()
    runFrames(30)
    expect(s.phase()).toBe('ready')
    expect({ tx: s.game.playerSnapshot().tx, ty: s.game.playerSnapshot().ty }).toEqual({ tx: frozen.tx, ty: frozen.ty })
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowLeft', key: 'ArrowLeft' }))
  })

  it('same area: zero enterArea, one reveal', async () => {
    const s = await ready()
    s.room().drop!()
    await vi.advanceTimersByTimeAsync(600)
    await settle()
    s.room().emit('presence:snapshot', { access: 'player', self: self('pradera'), actors: [] })
    await settle()
    runFrames(5)
    expect(s.enterArea).not.toHaveBeenCalled()
    expect(s.phase()).toBe('ready')
    expect(s.visible()).toEqual(['pradera'])
  })

  it('another area: exactly one enterArea under the overlay, then one reveal', async () => {
    const s = await ready()
    const shown = s.drawn.length
    s.room().drop!()
    await vi.advanceTimersByTimeAsync(600)
    await settle()
    let finish!: () => void
    vi.spyOn(s.game, 'prepare').mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
    s.room().emit('presence:snapshot', { access: 'player', self: self('cueva-inicial'), actors: [] })
    await settle()
    runFrames(10)
    expect(s.enterArea).toHaveBeenCalledTimes(1)
    expect(s.drawn.length).toBe(shown) // still the frozen Pradera frame
    finish()
    await settle()
    runFrames(5)
    expect(s.visible()).toEqual(['pradera', 'cueva-inicial'])
  })

  it('times out after 15 s of reconnecting, never entering Ciudad', async () => {
    const s = await ready()
    sdk.down = true
    s.room().drop!()
    await vi.advanceTimersByTimeAsync(14_999)
    expect(s.phase()).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(1)
    expect(s.controller.current).toMatchObject({ phase: 'connection-error', failed: 'reconnect' })
    runFrames(10)
    expect(s.visible()).toEqual(['pradera'])
  })
})

describe('errors, retry and replaced sessions', () => {
  it('times out the first entry at 12 s and stops trying until the player retries', async () => {
    sdk.down = true
    const s = boot()
    await vi.advanceTimersByTimeAsync(11_999)
    expect(s.phase()).toBe('connecting')
    await vi.advanceTimersByTimeAsync(1)
    expect(s.controller.current).toMatchObject({ phase: 'connection-error', failed: 'entry' })
    const joins = sdk.joins
    await vi.advanceTimersByTimeAsync(120_000)
    expect(sdk.joins).toBe(joins)
    expect(s.drawn).toEqual([])
  })

  it('Reintentar opens exactly one socket; the old one’s timers and room are dead', async () => {
    sdk.down = true
    const s = boot()
    await settle()
    await vi.advanceTimersByTimeAsync(12_000)
    expect(s.phase()).toBe('connection-error')
    const clients = sdk.clients
    const joins = sdk.joins
    sdk.down = false
    s.controller.retry()
    s.controller.retry() // a double click is still one attempt
    await settle()
    expect(sdk.clients).toBe(clients + 1)
    expect(sdk.joins).toBe(joins + 1)
    await vi.advanceTimersByTimeAsync(11_000)
    expect(sdk.joins).toBe(joins + 1)
    await enter(s, { access: 'player', self: self('pradera'), actors: [] })
    runFrames(3)
    expect(s.visible()).toEqual(['pradera'])
  })

  it('a late message from a room left by a retry neither places nor reveals', async () => {
    const s = boot()
    await settle()
    const old = s.room()
    await vi.advanceTimersByTimeAsync(12_000)
    expect(s.phase()).toBe('connection-error')
    s.controller.retry()
    await settle()
    old.emit('presence:snapshot', { access: 'player', self: self('cueva-inicial'), actors: [] })
    await settle()
    runFrames(5)
    expect(s.drawn).toEqual([])
    expect(s.enterArea).not.toHaveBeenCalled()
    expect(s.phase()).toBe('connecting')
  })

  it('a snapshot that arrives after the timeout, before any retry, is ignored: no place, no reveal, no input, no socket', async () => {
    const s = boot()
    await settle()
    const old = s.room()
    expect(old.sent).toContain('presence:ready')
    await vi.advanceTimersByTimeAsync(12_000)
    expect(s.phase()).toBe('connection-error')
    const clients = sdk.clients
    const joins = sdk.joins
    const reveal = vi.spyOn(s.game, 'revealScene')
    const attach = vi.spyOn(s.internals.keys, 'attach')
    const before = s.game.playerSnapshot()
    old.emit('presence:snapshot', { access: 'player', self: self('cueva-inicial'), actors: [] })
    await settle()
    runFrames(10)
    // Input: tap, drag and a held arrow key all go nowhere.
    s.internals.spectator = false
    s.game.tap(10, 10)
    s.game.drag(40, 40)
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight', key: 'ArrowRight' }))
    runFrames(10)
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowRight', key: 'ArrowRight' }))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(s.phase()).toBe('connection-error')
    expect(s.controller.current).toMatchObject({ authority: false, live: false })
    expect(s.drawn).toEqual([])
    expect(s.visible()).toEqual([])
    expect(s.enterArea).not.toHaveBeenCalled()
    expect(reveal).not.toHaveBeenCalled()
    expect(attach).not.toHaveBeenCalled()
    expect(s.goTo).not.toHaveBeenCalled()
    expect(s.game.playerSnapshot()).toEqual(before)
    expect(sdk.clients).toBe(clients)
    expect(sdk.joins).toBe(joins)
  })

  it('4001 from a server that did not echo protocol 3 (an older server): replaced, no automatic retry and no reconnect on a session change', async () => {
    const s = boot()
    await enter(s, { access: 'player', self: self('pradera'), actors: [] })
    runFrames(3)
    const joins = sdk.joins
    s.room().leaveHandler!(4001)
    expect(s.phase()).toBe('replaced')
    s.controller.renew()
    s.controller.retry()
    await vi.advanceTimersByTimeAsync(300_000)
    expect(sdk.joins).toBe(joins)
    runFrames(5)
    expect(s.visible()).toEqual(['pradera'])
  })

  it('the adapter alone stops for good on 4001 (no controller needed to end the loop)', async () => {
    const remote = { replaceRemoteActors: vi.fn(), upsertRemoteActor: vi.fn(), removeRemoteActor: vi.fn(), setAuthoritativeActor: vi.fn(), setPresenceAccess: vi.fn() }
    const replaced = vi.fn()
    const socket = new m.ColyseusPresence(remote, null, null, { snapshot: vi.fn(), lost: vi.fn(), replaced })
    void socket.connect()
    await settle()
    const joins = sdk.joins
    ;(sdk.rooms[sdk.rooms.length - 1] as FakeRoom).leaveHandler!(4001)
    expect(replaced).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(300_000)
    void socket.connect()
    await settle()
    expect(sdk.joins).toBe(joins)
  })

  it('a refused intent (presence:error) is not a connection problem', async () => {
    const s = boot()
    await enter(s, { access: 'player', self: self('pradera'), actors: [] })
    s.room().emit('presence:error', { code: 'invalid-intent', reason: 'client-outdated' })
    expect(s.phase()).toBe('ready')
  })
})

describe('WORLD LOCATION-4: close codes, resume and «Jugar acá»', () => {
  const placed = { access: 'player', self: self('pradera'), actors: [], presenceProtocol: 3 }

  it('declares protocol 3 and one tabId per page; the first join is fresh, every automatic one resumes', async () => {
    const s = boot()
    await enter(s, placed)
    expect(sdk.options[0]).toMatchObject({ presenceProtocol: 3 })
    expect(sdk.options[0].resume).toBeUndefined()
    expect(sdk.options[0].tabId).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
    s.room().drop!()
    await vi.advanceTimersByTimeAsync(600)
    expect(sdk.options[1]).toMatchObject({ resume: true, tabId: sdk.options[0].tabId })
  })

  it('4409: replaced, no automatic join; presence:closing replaced wins over any code', async () => {
    const s = boot()
    await enter(s, placed)
    const joins = sdk.joins
    s.room().leaveHandler!(4409)
    expect(s.phase()).toBe('replaced')
    await vi.advanceTimersByTimeAsync(300_000)
    expect(sdk.joins).toBe(joins)
    const t = boot()
    await enter(t, placed)
    t.room().emit('presence:closing', { reason: 'replaced' })
    t.room().leaveHandler!(4002)
    expect(t.phase()).toBe('replaced')
  })

  it('4503 (drain, deploy): reconnecting, then one resume join at once; 4001 from a protocol-3 server is a shutdown too', async () => {
    for (const code of [4503, 4001]) {
      sdk.options = []
      const s = boot()
      await enter(s, placed)
      s.room().leaveHandler!(code)
      expect(s.phase()).toBe('reconnecting')
      await vi.advanceTimersByTimeAsync(600)
      expect(sdk.options[sdk.options.length - 1]).toMatchObject({ resume: true })
      await enter(s, placed)
      runFrames(3)
      expect(s.phase()).toBe('ready')
    }
  })

  it('a resume refused with 4409 (another tab is live) stops as replaced; «Jugar acá» joins fresh and takes the session back', async () => {
    const s = boot()
    await enter(s, placed)
    s.room().drop!()
    sdk.refuse = 4409
    await vi.advanceTimersByTimeAsync(600)
    expect(sdk.options[sdk.options.length - 1]).toMatchObject({ resume: true })
    expect(s.phase()).toBe('replaced')
    const joins = sdk.joins
    await vi.advanceTimersByTimeAsync(300_000)
    expect(sdk.joins).toBe(joins)
    sdk.refuse = null
    s.controller.takeover()
    await settle()
    expect(sdk.joins).toBe(joins + 1)
    expect(sdk.options[sdk.options.length - 1].resume).toBeUndefined()
    await enter(s, placed)
    runFrames(3)
    expect(s.phase()).toBe('ready')
  })

  it('a join refused with 4503 (a draining host) is retried with resume', async () => {
    sdk.refuse = 4503
    const s = boot()
    await settle()
    expect(s.phase()).toBe('connecting')
    sdk.refuse = null
    await vi.advanceTimersByTimeAsync(600)
    expect(sdk.options[sdk.options.length - 1]).toMatchObject({ resume: true })
    await enter(s, placed)
    runFrames(3)
    expect(s.phase()).toBe('ready')
  })
})

describe('WORLD LOCATION-4 compatibility: this client against an older realtime (no protocol echo)', () => {
  const oldServer = { access: 'player', self: self('pradera'), actors: [] }

  it('a 4001 on a socket that lived ≥ 30 s reconnects once with resume; another 4001 within a minute stops as replaced (no loop)', async () => {
    // The socket's lifetime is read from Date: fake it too (beforeEach faked only the timers).
    vi.useRealTimers()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const s = boot()
    await enter(s, oldServer)
    runFrames(3)
    await vi.advanceTimersByTimeAsync(31_000)
    s.room().leaveHandler!(4001) // an older server's shutdown (or replacement): ambiguous
    expect(s.phase()).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(600)
    expect(sdk.options[sdk.options.length - 1]).toMatchObject({ resume: true })
    await enter(s, oldServer)
    runFrames(3)
    expect(s.phase()).toBe('ready')
    await vi.advanceTimersByTimeAsync(31_000)
    const joins = sdk.joins
    s.room().leaveHandler!(4001) // a second one within a minute: a replacement, for good
    expect(s.phase()).toBe('replaced')
    await vi.advanceTimersByTimeAsync(300_000)
    expect(sdk.joins).toBe(joins)
  })

  it('an older server ignores tabId and resume (it never sends 4409/4503): a 1006 reconnects as before, a 4000 does nothing', async () => {
    const s = boot()
    await enter(s, oldServer)
    s.room().drop!()
    await vi.advanceTimersByTimeAsync(600)
    expect(s.phase()).toBe('reconnecting')
    await enter(s, oldServer)
    runFrames(3)
    expect(s.phase()).toBe('ready')
    const joins = sdk.joins
    s.room().leaveHandler!(4000)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sdk.joins).toBe(joins)
  })
})

describe('WORLD LOCATION-4, review F7: 4503 backoff', () => {
  it('repeated 4503 refusals during a drain back off (bounded, never back to 500 ms); resume kept; only a ready connection resets it', async () => {
    const remote = { replaceRemoteActors: vi.fn(), upsertRemoteActor: vi.fn(), removeRemoteActor: vi.fn(), setAuthoritativeActor: vi.fn(), setPresenceAccess: vi.fn() }
    const socket = new m.ColyseusPresence(remote, null, null, { snapshot: vi.fn(), lost: vi.fn(), replaced: vi.fn() })
    void socket.connect()
    await settle()
    ;(sdk.rooms[sdk.rooms.length - 1] as FakeRoom).emit('presence:snapshot', { access: 'player', self: self('pradera'), actors: [], presenceProtocol: 3 })
    sdk.refuse = 4503 // the whole drain: every join is refused
    ;(sdk.rooms[sdk.rooms.length - 1] as FakeRoom).leaveHandler!(4503)
    const attempts: number[] = []
    let joins = sdk.joins
    for (let t = 0; t <= 120_000; t += 100) {
      await vi.advanceTimersByTimeAsync(100)
      if (sdk.joins !== joins) { joins = sdk.joins; attempts.push(t + 100) }
    }
    const gaps = attempts.map((at, i) => at - (attempts[i - 1] ?? 0))
    expect(gaps[0]).toBeLessThanOrEqual(600) // the first retry is quick
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThanOrEqual(gaps[i - 1] - 100) // never reset by a refusal
    expect(Math.max(...gaps)).toBeLessThanOrEqual(10_100) // bounded
    expect(gaps.slice(-3).every(gap => gap >= 9_900)).toBe(true) // and it stays at the cap
    expect(attempts.length).toBeLessThanOrEqual(20) // no aggressive loop: about 15 tries in two minutes
    expect(sdk.options.slice(-attempts.length).every(options => options.resume === true)).toBe(true)

    sdk.refuse = null // the new host is up
    for (let i = 0; i < 120 && sdk.rooms.length === 0; i++) await vi.advanceTimersByTimeAsync(100)
    for (let i = 0; i < 120 && sdk.joins === joins; i++) await vi.advanceTimersByTimeAsync(100)
    await settle()
    const room = sdk.rooms[sdk.rooms.length - 1] as FakeRoom
    room.emit('presence:snapshot', { access: 'player', self: self('pradera'), actors: [], presenceProtocol: 3 }) // ready: stable
    joins = sdk.joins
    room.leaveHandler!(4503) // a later drain starts quick again
    await vi.advanceTimersByTimeAsync(600)
    expect(sdk.joins).toBe(joins + 1)
    socket.disconnect()
  })
})
