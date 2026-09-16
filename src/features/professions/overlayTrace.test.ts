// R31-Z / T-S1 · T-S1.1 — overlay trace baseline.
//
// Freezes what the five profession overlays hand the renderer, so the
// gathering/processing refactor can prove it changed nothing by accident.
// These tests judge nothing: they record. A snapshot diff is the finding.
//
// Determinism, in one place:
//  - system time frozen, so the demo clock (energy, respawn, RNG seed) is fixed;
//  - scene clock stepped at exactly 1/30 s; every hook runs on every step and
//    only every 50 ms is written down (T-S1.1);
//  - world from `World(PRADERA_SEED)` and tiles from `PRADERA_LANDMARKS`;
//  - `toSprite` wrapped, so art is hashed from its pixels and no canvas is used.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The wrapper has to exist before the overlays import `toSprite`, and a
// `vi.mock` factory is hoisted above the imports, so it pulls the registry in
// dynamically. Path checked against the tree: this file lives in
// `src/features/professions/`, the module in `src/features/professions/art/`.
vi.mock('./art/pixelArt', async importOriginal => {
  const actual = await importOriginal<typeof import('./art/pixelArt')>()
  const trace = await import('./testing/overlayTrace')
  return { ...actual, toSprite: trace.traceSprite }
})

import { useAlchemyController } from './alchemy/useAlchemyController'
import { alchemyStationTile } from './alchemy/stationPlacement'
import { NODE_BY_ID } from './domain/catalog/nodes'
import { nodeAt, worldNodePort } from './domain/nodePlacement'
import {
  demoCounts, equipDemoTool, setDemoInventory, setDemoWorker,
  type DemoNodeTarget, type DemoState,
} from './demo/demoSession'
import { PRADERA_LANDMARKS, PRADERA_SEED, PRADERA_SPAWN } from './demo/praderaLandmarks'
import { useProfessionDemo, type ProfessionDemoSession } from './demo/useProfessionDemo'
import { useFishingController } from './fishing/useFishingController'
import { useForageController } from './forage/useForageController'
import { useLoggingController } from './logging/useLoggingController'
import { useMiningController } from './mining/useMiningController'
import {
  finalState, recordingContext, resetSpriteInterceptions, SceneTrace,
  spriteInterceptions, STEP_SECONDS,
  type DecorProbe, type TraceEntry, type TraceFrame, type TraceHost, type TraceOverlay,
} from './testing/overlayTrace'
import { World } from '../wildlands/engine/world'

/** A fixed wall clock: the demo session stamps state with `Date.now()`. */
const FROZEN_NOW = new Date('2026-01-01T12:00:00.000Z')
const TILE = 16

const world = new World(PRADERA_SEED)
const nodePort = worldNodePort(world)

/** The smallest Area the overlays need: kind, id, world and the two probes. */
const area = {
  kind: 'wild',
  id: 'pradera',
  world,
  isSolid: (tx: number, ty: number) => world.isSolid(tx, ty),
  isWater: (tx: number, ty: number) => world.isWater(tx, ty),
}

interface StubPort {
  overlay: unknown
  locked: boolean
  player: { tx: number; ty: number; dir: 'up' | 'down' | 'left' | 'right'; x: number; y: number; moving: boolean; areaId: string }
  setSceneOverlay(overlay: unknown): void
  setInputLocked(locked: boolean): void
  playerSnapshot(): StubPort['player']
}

function stubPort(tx: number, ty: number): StubPort {
  return {
    overlay: null,
    locked: false,
    player: { tx, ty, dir: 'up', x: tx * TILE + 8, y: ty * TILE + 15, moving: false, areaId: 'pradera' },
    setSceneOverlay(overlay) { this.overlay = overlay },
    setInputLocked(locked) { this.locked = locked },
    playerSnapshot() { return this.player },
  }
}

const landmark = (definitionId: string) => PRADERA_LANDMARKS.find(entry => entry.definitionId === definitionId)!

/** The node the seeded world really hosts on that tile. */
function targetAt(definitionId: string): { target: DemoNodeTarget; tx: number; ty: number } {
  const spot = landmark(definitionId)
  const placement = nodeAt(nodePort, spot.tx, spot.ty)!
  expect(placement.definitionId, definitionId).toBe(definitionId)
  return {
    target: { nodeId: placement.nodeId, node: NODE_BY_ID.get(placement.definitionId)!, biome: placement.biome },
    tx: spot.tx, ty: spot.ty,
  }
}

/**
 * The decor prop of a node's tile, with the `kind` the world really places
 * there. The chunk jitters `x` by a couple of pixels per prop; the trace uses
 * the un-jittered centre so the baseline does not depend on that detail.
 *
 * Terrain-anchored nodes (the herb patch) have no prop: this returns nothing
 * for them, and they reach the scene through `sprites()` instead.
 */
function decorProbe(tx: number, ty: number): DecorProbe[] {
  const kind = world.decorAt(tx, ty)
  if (!kind) return []
  return [{ label: `${kind}@${tx},${ty}`, decor: { kind, tx, ty, x: tx * TILE + 8, y: ty * TILE + 13 } }]
}

const beside = (spot: { tx: number; ty: number }) => ({ tx: spot.tx, ty: spot.ty + 1 })

interface HostOptions {
  readonly probes?: DecorProbe[]
  /** Fishing's bite: the one window a player has to react to. */
  readonly window?: () => boolean
}

function host(label: string, overlay: unknown, game: StubPort, phase: () => string, options: HostOptions = {}): TraceHost {
  return {
    label,
    overlay: overlay as TraceOverlay,
    area,
    probes: options.probes ?? [],
    phase,
    window: options.window,
    locked: () => game.locked,
  }
}

let session: ProfessionDemoSession

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(FROZEN_NOW)
  resetSpriteInterceptions()
  session = useProfessionDemo()
  // Workers are off by default so each scenario says explicitly whether it
  // covers the worker path; two of them turn their profession's worker back on.
  session.update(state => (['mining', 'woodcutting', 'fishing', 'alchemy'] as const)
    .reduce((next: DemoState, id) => setDemoWorker(next, id, null), state))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Every scenario must prove the `toSprite` wrapper really ran. */
function expectIntercepted(): void {
  expect(spriteInterceptions(), 'toSprite wrapper never ran: the art hashes would be null').toBeGreaterThan(0)
}

const isFrame = (entry: TraceEntry): entry is TraceFrame => 'state' in entry

describe('overlay trace · mining', () => {
  it('stone_outcrop · one action and a second tap during it', () => {
    const spot = targetAt('stone_outcrop')
    const game = stubPort(beside(spot).tx, beside(spot).ty)
    const mining = useMiningController(session, () => game)
    mining.attach()
    mining.inspect({ area, tx: spot.tx, ty: spot.ty } as never)

    const trace = new SceneTrace(host('mining · stone_outcrop', mining.overlay, game, () => mining.phase.value,
      { probes: decorProbe(spot.tx, spot.ty) }))
    trace.mark('selected')
    trace.run(0.2)
    trace.mark(`mine() → ${mining.mine()}`)
    trace.run(0.4)
    // The second tap lands while the pickaxe is already swinging.
    trace.mark(`mine() during the action → ${mining.mine()}`)
    trace.runUntil(() => mining.phase.value !== 'mining', 12)
    trace.mark('action over')
    trace.run(0.5)

    expectIntercepted()
    // T-S1.1: the hooks run on every frame, not only on the ones recorded.
    const recorded = trace.trace.filter(isFrame).length
    expect(trace.hookRuns.sprites).toBe(trace.hookRuns.frames)
    expect(trace.hookRuns.frames).toBeGreaterThan(recorded)

    expect({ trace: trace.trace, session: finalState(session.state.value, [spot.target]) }).toMatchSnapshot('mining · stone_outcrop · double tap')
  })
})

describe('overlay trace · logging', () => {
  it('common_tree · every charge, the fall and the stump', () => {
    const spot = targetAt('common_tree')
    const game = stubPort(beside(spot).tx, beside(spot).ty)
    const logging = useLoggingController(session, () => game)
    logging.attach()
    logging.inspect({ area, tx: spot.tx, ty: spot.ty } as never)

    const charges = spot.target.node.personalCharges
    const trace = new SceneTrace(host('logging · common_tree', logging.overlay, game, () => logging.phase.value,
      { probes: decorProbe(spot.tx, spot.ty) }))
    trace.mark('selected')
    let actions = 0
    for (let i = 0; i < charges + 2; i++) {
      const started = logging.chop()
      trace.mark(`chop() #${i + 1} → ${started}`)
      if (!started) break
      actions++
      // The first chop and the last one — the one that fells the tree — are
      // sampled in full. The middle ones repeat the first one's shape, so they
      // only run the hooks and advance the clock.
      const sample = i === 0 || i === charges - 1
      trace.runUntil(() => logging.phase.value !== 'chopping', 15, { sample, note: `chop #${i + 1} (middle charge)` })
      trace.run(0.4, { sample })
    }
    expect(actions).toBe(charges)
    trace.mark('depleted')
    trace.run(0.5)

    expectIntercepted()
    expect({ actions, trace: trace.trace, session: finalState(session.state.value, [spot.target]) })
      .toMatchSnapshot('logging · common_tree · felled and depleted')
  })
})

describe('overlay trace · forage', () => {
  it('berry_bush · by hand, with no sickle equipped', () => {
    const spot = targetAt('berry_bush')
    const game = stubPort(beside(spot).tx, beside(spot).ty)
    // The catalog asks for no tool here; unequipping proves the bare-hands path.
    session.update(state => equipDemoTool(state, 'sickle', null))
    const forage = useForageController(session, () => game)
    forage.attach()
    forage.inspect({ area, tx: spot.tx, ty: spot.ty } as never)

    const trace = new SceneTrace(host('forage · bare hands', forage.overlay, game, () => forage.phase.value,
      { probes: decorProbe(spot.tx, spot.ty) }))
    trace.mark('selected · no sickle')
    trace.mark(`gather() → ${forage.gather()}`)
    trace.runUntil(() => forage.phase.value !== 'gathering', 15)
    trace.mark('action over')
    trace.run(0.5)

    expectIntercepted()
    expect({ trace: trace.trace, session: finalState(session.state.value, [spot.target]) })
      .toMatchSnapshot('forage · berry_bush · bare hands')
  })

  it('berry_bush · with the demo sickle equipped', () => {
    const spot = targetAt('berry_bush')
    const game = stubPort(beside(spot).tx, beside(spot).ty)
    const forage = useForageController(session, () => game)
    forage.attach()
    forage.inspect({ area, tx: spot.tx, ty: spot.ty } as never)

    const trace = new SceneTrace(host('forage · sickle', forage.overlay, game, () => forage.phase.value,
      { probes: decorProbe(spot.tx, spot.ty) }))
    trace.mark('selected · sickle equipped')
    trace.mark(`gather() → ${forage.gather()}`)
    trace.runUntil(() => forage.phase.value !== 'gathering', 15)
    trace.mark('action over')
    trace.run(0.5)

    expectIntercepted()
    expect({ trace: trace.trace, session: finalState(session.state.value, [spot.target]) })
      .toMatchSnapshot('forage · berry_bush · sickle')
  })
})

describe('overlay trace · fishing', () => {
  beforeEach(() => {
    // Fishing is the one overlay that bakes sprites inside `ground()`; with the
    // wrapper in place nothing rasterises, but a stub context keeps any other
    // canvas path (silhouettes, image data) from throwing in jsdom.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      save: () => undefined, restore: () => undefined, beginPath: () => undefined,
      ellipse: () => undefined, arc: () => undefined, fill: () => undefined, stroke: () => undefined,
      drawImage: () => undefined, clearRect: () => undefined, fillRect: () => undefined,
      createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: () => undefined,
      getImageData: (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    }) as unknown as CanvasRenderingContext2D)
  })

  /** The shore spot is dry land touching water: standing on it is a valid cast. */
  function onTheBank() {
    const spot = targetAt('shore_spot')
    const game = stubPort(spot.tx, spot.ty)
    const fishing = useFishingController(session, () => game)
    fishing.attach()
    expect(fishing.inspect({ area, tx: spot.tx, ty: spot.ty } as never), 'the bank must accept the tap').toBe(true)
    return { spot, game, fishing }
  }

  /** The bite is the one profession state worth telling apart from "busy". */
  const biteWindow = (fishing: ReturnType<typeof useFishingController>) => () => {
    fishing.syncBite()
    return fishing.biting.value
  }

  it('shore_spot · cast, wait, reel inside the window', () => {
    const { spot, game, fishing } = onTheBank()
    const trace = new SceneTrace(host('fishing · in the window', fishing.overlay, game, () => fishing.phase.value,
      { probes: decorProbe(spot.tx, spot.ty), window: biteWindow(fishing) }))

    trace.mark('selected')
    const cast = fishing.cast()
    trace.mark(`cast() → ${cast}`)
    expect(cast, 'the scenario must really fish').toBe(true)
    expect(fishing.phase.value, 'the phase must have advanced past idle').toBe('casting')

    // The first second of the cast is sampled; the wait for the bite is not
    // (the bobber just sits there), and sampling resumes on the bite itself.
    trace.run(1)
    const waited = trace.runUntil(() => {
      fishing.syncBite()
      return fishing.biting.value
    }, 60, { sample: false, note: 'waiting for the bite' })
    expect(fishing.biting.value, 'the bite never arrived').toBe(true)
    trace.run(0.2)
    const grade = fishing.reel()
    trace.mark(`bite after ${waited} ms · reel() → ${grade}`)
    trace.runUntil(() => fishing.phase.value === 'result', 15)
    trace.mark('result')
    trace.run(1)

    expectIntercepted()
    // The bite is an observable state of its own, and the trace must show it.
    expect(trace.trace.filter(isFrame).some(frame => frame.state === 'window'),
      'the bite window never reached the trace').toBe(true)

    expect({ grade, trace: trace.trace, session: finalState(session.state.value, [spot.target]) })
      .toMatchSnapshot('fishing · shore_spot · reel in the window')
  })

  it('shore_spot · cast and reel far too early', () => {
    const { spot, game, fishing } = onTheBank()
    const trace = new SceneTrace(host('fishing · too early', fishing.overlay, game, () => fishing.phase.value,
      { probes: decorProbe(spot.tx, spot.ty), window: biteWindow(fishing) }))

    trace.mark('selected')
    const cast = fishing.cast()
    trace.mark(`cast() → ${cast}`)
    expect(cast).toBe(true)
    expect(fishing.phase.value).toBe('casting')

    trace.run(0.3)
    expect(fishing.biting.value, 'reeling this early must be before the bite').toBe(false)
    const grade = fishing.reel()
    trace.mark(`early reel() → ${grade}`)
    trace.runUntil(() => fishing.phase.value === 'result', 15)
    trace.mark('result')
    trace.run(1)

    expectIntercepted()
    expect(trace.trace.filter(isFrame).every(frame => frame.state !== 'window'),
      'no bite window should ever open in this scenario').toBe(true)

    expect({ grade, trace: trace.trace, session: finalState(session.state.value, [spot.target]) })
      .toMatchSnapshot('fishing · shore_spot · reel too early')
  })
})

describe('overlay trace · alchemy (processing)', () => {
  const benchTile = () => alchemyStationTile({
    isSolid: (tx, ty) => world.isSolid(tx, ty),
    isWater: (tx, ty) => world.isWater(tx, ty),
    hasNode: (tx, ty) => nodeAt(nodePort, tx, ty) !== null,
  }, PRADERA_SPAWN)!

  function bench(quantity: number) {
    const tile = benchTile()
    const game = stubPort(tile.tx, tile.ty + 1)
    const alchemy = useAlchemyController(session, () => game, () => PRADERA_SPAWN)
    alchemy.setStation(tile)
    alchemy.attach()
    session.update(state => setDemoInventory(state, { ...demoCounts(state), oran_berry: 12, vial: 6 }))
    alchemy.select('brew_potion')
    alchemy.setQuantity(quantity)
    return { tile, game, alchemy }
  }

  it('brew_potion · batch of 1', () => {
    const { game, alchemy } = bench(1)
    const trace = new SceneTrace(host('alchemy · batch 1', alchemy.overlay, game, () => alchemy.phase.value))
    trace.mark('bench open · quantity 1')
    trace.mark(`brew() → ${alchemy.brew()}`)
    trace.runUntil(() => alchemy.phase.value !== 'brewing', 20)
    trace.mark('brew over')
    trace.run(0.5)

    expectIntercepted()
    expect({ trace: trace.trace, session: finalState(session.state.value) }).toMatchSnapshot('alchemy · brew_potion · batch 1')
  })

  it('brew_potion · batch of 3', () => {
    const { game, alchemy } = bench(3)
    expect(alchemy.quantity.value).toBe(3)
    const trace = new SceneTrace(host('alchemy · batch 3', alchemy.overlay, game, () => alchemy.phase.value))
    trace.mark('bench open · quantity 3')
    trace.mark(`brew() → ${alchemy.brew()}`)
    trace.runUntil(() => alchemy.phase.value !== 'brewing', 25)
    trace.mark('brew over')
    trace.run(0.5)

    expectIntercepted()
    expect({ trace: trace.trace, session: finalState(session.state.value) }).toMatchSnapshot('alchemy · brew_potion · batch 3')
  })
})

// ── The harness itself (T-S1.1) ────────────────────────────────────────────

describe('overlay trace · harness', () => {
  /** A hook that only runs when a frame is recorded is the defect T-S1.1 fixes. */
  it('runs every hook on frames that are never written down', () => {
    const groundAt: number[] = []
    const decorAt: number[] = []
    const labelsAt: number[] = []
    const overlay: TraceOverlay = {
      ground: (_g, _a, _x, _y, seconds) => { groundAt.push(Math.round(seconds * 1000)) },
      decor: (_d, _a, seconds) => { decorAt.push(Math.round(seconds * 1000)); return null },
      sprites: () => [],
      // A label that changes every frame, so nothing collapses into `repeat`
      // and the recorded timestamps can be read straight off the trace.
      labels: (_a, seconds) => {
        labelsAt.push(Math.round(seconds * 1000))
        return [{ wx: 0, wy: 0, lift: 0, text: `${Math.round(seconds * 1000)}`, color: '#fff' }]
      },
    }
    const probe: DecorProbe = { label: 'probe@0,0', decor: { kind: 'rock', tx: 0, ty: 0, x: 8, y: 13 } }
    const trace = new SceneTrace({
      overlay, area, probes: [probe], phase: () => 'idle', locked: () => false,
    })
    trace.run(0.5)

    // 0.5 s at 1/30 s is 15 frames; at one sample per 50 ms only 10 are kept.
    expect(trace.hookRuns).toEqual({ frames: 15, ground: 15, decor: 15, sprites: 15, labels: 15 })
    const recordedAt = trace.trace.filter(isFrame).map(frame => frame.atMs)
    expect(recordedAt.length).toBeLessThan(15)
    expect(recordedAt.length).toBeGreaterThan(1)

    // Where two kept samples are more than one frame apart, a frame ran in
    // between — and every hook must have run on it.
    const gaps = recordedAt.slice(1)
      .map((at, i) => [recordedAt[i], at] as const)
      .filter(([from, to]) => to - from > Math.ceil(STEP_SECONDS * 1000))
    expect(gaps.length, 'the sampling never skipped a frame: the test proves nothing').toBeGreaterThan(0)

    for (const [name, list] of Object.entries({
      ground: groundAt, decor: decorAt, labels: labelsAt, sprites: [...trace.spriteRunTimes],
    })) {
      for (const [from, to] of gaps) {
        expect(list.some(at => at > from && at < to), `${name}() never ran between ${from} ms and ${to} ms`).toBe(true)
      }
    }
  })

  it('keeps running the hooks through a stretch that is not sampled', () => {
    let calls = 0
    const trace = new SceneTrace({
      overlay: { sprites: () => { calls++; return [] } },
      area, probes: [], phase: () => 'idle', locked: () => false,
    })
    trace.run(1, { sample: false, note: 'quiet stretch' })
    expect(calls).toBe(30)
    expect(trace.trace).toEqual([{ skippedMs: 1000, note: 'quiet stretch' }])
  })

  /** Reordering assignments that do not change the picture must not diff. */
  it('records the drawing, not the style assignments that led to it', () => {
    const build = (script: (ctx: CanvasRenderingContext2D) => void): string[] => {
      const recorder = recordingContext()
      script(recorder.ctx as CanvasRenderingContext2D)
      return [...recorder.calls]
    }

    const noisy = build(ctx => {
      ctx.fillStyle = '#111111'
      ctx.lineWidth = 9
      ctx.strokeStyle = '#999999'
      ctx.fillStyle = '#222222'
      ctx.beginPath()
      ctx.ellipse(10, 6, 4, 2, 0, 0, Math.PI * 2)
      ctx.fill()
    })
    const lean = build(ctx => {
      ctx.beginPath()
      ctx.ellipse(10, 6, 4, 2, 0, 0, Math.PI * 2)
      ctx.fillStyle = '#222222'
      ctx.fill()
    })
    expect(noisy).toEqual(lean)
    expect(noisy).toEqual(['fill [ellipse(10 6 4 2 0 0 6.28)] fill=#222222 alpha=1'])

    // A style that *does* reach a stroke is part of the picture and is kept.
    const stroked = build(ctx => {
      ctx.strokeStyle = '#a4e27c'
      ctx.lineWidth = 1.5
      ctx.globalAlpha = 0.5
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(4, 3)
      ctx.stroke()
    })
    expect(stroked).toEqual(['stroke [move(0 0) line(4 3)] stroke=#a4e27c lw=1.5 alpha=0.5'])

    // `restore()` puts the earlier style back, and the next draw shows it.
    const scoped = build(ctx => {
      ctx.fillStyle = '#000000'
      ctx.save()
      ctx.fillStyle = '#ffffff'
      ctx.restore()
      ctx.fillRect(0, 0, 2, 2)
    })
    expect(scoped).toEqual(['fillRect [0 0 2 2] fill=#000000 alpha=1'])
  })

  /** The refactor may rename any phase; the snapshot must not notice. */
  it('never serialises a controller phase name', () => {
    const internal = ['mining', 'chopping', 'gathering', 'casting', 'brewing']
    const spot = targetAt('stone_outcrop')
    const game = stubPort(beside(spot).tx, beside(spot).ty)
    const mining = useMiningController(session, () => game)
    mining.attach()
    mining.inspect({ area, tx: spot.tx, ty: spot.ty } as never)

    const trace = new SceneTrace(host('harness · phases', mining.overlay, game, () => mining.phase.value,
      { probes: decorProbe(spot.tx, spot.ty) }))
    mining.mine()
    trace.run(0.4)
    expect(mining.phase.value, 'the controller really is in its internal phase').toBe('mining')

    const frames = trace.trace.filter(isFrame)
    expect(frames.length).toBeGreaterThan(0)
    for (const frame of frames) {
      expect(internal).not.toContain(frame.state)
      expect(['idle', 'active', 'window', 'resolved']).toContain(frame.state)
      expect(frame, 'the raw phase must not be serialised at all').not.toHaveProperty('phase')
    }
  })
})
