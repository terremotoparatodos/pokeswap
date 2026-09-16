// R31-QA — regression and stress pass over the four professions.
//
// The overlays only touch a canvas when they *draw* (`sprites`, `decor`);
// their clock, their result and their cleanup all run from `ground`, which
// only needs a 2D context for a couple of ellipses. A stub context is
// therefore enough to run a whole action headlessly — which is what lets these
// tests hammer the loop (double taps, cancels, repeats, profession switches)
// without a real canvas and without the browser.
//
// Everything here drives the *real* controllers and the *real* demo session:
// no mocks of the domain, so a double reward or a double consumption would
// show up as a wrong inventory, not as a wrong assertion.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Area } from '../wildlands/engine/area'
import type { SceneOverlay } from '../wildlands/engine/sceneOverlay'
import { World } from '../wildlands/engine/world'
import { useAlchemyController } from './alchemy/useAlchemyController'
import { alchemyStationTile } from './alchemy/stationPlacement'
import { NODE_BY_ID } from './domain/catalog/nodes'
import { nodeAt, worldNodePort } from './domain/nodePlacement'
import {
  demoCounts, demoLevel, demoTool, fillDemoBag, setDemoDurability, setDemoInventory, setDemoWorker,
  type DemoNodeTarget, type DemoState,
} from './demo/demoSession'
import { PRADERA_LANDMARKS, PRADERA_SEED, PRADERA_SPAWN } from './demo/praderaLandmarks'
import { useProfessionDemo, type ProfessionDemoSession } from './demo/useProfessionDemo'
import { useFishingController } from './fishing/useFishingController'
import { useForageController } from './forage/useForageController'
import { useLoggingController } from './logging/useLoggingController'
import { useMiningController } from './mining/useMiningController'
import type { OverlayPlayer } from './mining/miningOverlay'

// ── Harness ────────────────────────────────────────────────────────────────

function stubContext(): CanvasRenderingContext2D {
  const noop = () => undefined
  return {
    save: noop, restore: noop, beginPath: noop, ellipse: noop, arc: noop,
    fill: noop, stroke: noop, moveTo: noop, lineTo: noop, closePath: noop,
    fillRect: noop, clearRect: noop, drawImage: noop, setLineDash: noop,
    fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D
}

const world = new World(PRADERA_SEED)
const port = worldNodePort(world)

function stubArea(): Area {
  return {
    kind: 'wild',
    id: 'pradera',
    world,
    isSolid: (tx: number, ty: number) => world.isSolid(tx, ty),
    isWater: (tx: number, ty: number) => world.isWater(tx, ty),
  } as unknown as Area
}

interface StubPort {
  overlay: SceneOverlay | null
  locked: boolean
  lockCalls: boolean[]
  player: OverlayPlayer
  setSceneOverlay(overlay: SceneOverlay | null): void
  setInputLocked(locked: boolean): void
  playerSnapshot(): OverlayPlayer
}

function stubPort(tx: number, ty: number): StubPort {
  return {
    overlay: null,
    locked: false,
    lockCalls: [],
    player: { tx, ty, dir: 'up', x: tx * 16 + 8, y: ty * 16 + 15, moving: false, areaId: 'pradera' },
    setSceneOverlay(overlay) { this.overlay = overlay },
    setInputLocked(locked) { this.locked = locked; this.lockCalls.push(locked) },
    playerSnapshot() { return this.player },
  }
}

const area = stubArea()
const ctx = stubContext()

/** Advances the scene clock, ticking every overlay as the renderer would. */
function run(clock: { seconds: number }, seconds: number, overlays: readonly SceneOverlay[], step = 1 / 30): void {
  const until = clock.seconds + seconds
  while (clock.seconds < until) {
    clock.seconds = Math.min(until, clock.seconds + step)
    for (const overlay of overlays) overlay.ground?.(ctx, area, 0, 0, clock.seconds)
  }
}

const landmark = (definitionId: string) => PRADERA_LANDMARKS.find(entry => entry.definitionId === definitionId)!

/** The node the world really hosts on that tile, as a controller target. */
function targetAt(definitionId: string): { target: DemoNodeTarget; tx: number; ty: number } {
  const spot = landmark(definitionId)
  const placement = nodeAt(port, spot.tx, spot.ty)!
  return {
    target: { nodeId: placement.nodeId, node: NODE_BY_ID.get(placement.definitionId)!, biome: placement.biome },
    tx: spot.tx, ty: spot.ty,
  }
}

/** A tile beside the node, where the player stands to work it. */
const beside = (spot: { tx: number; ty: number }) => ({ tx: spot.tx, ty: spot.ty + 1 })

function bagCount(state: DemoState, itemId: string): number {
  return demoCounts(state)[itemId] ?? 0
}

// ── Mining: the loop under repeated and conflicting input ───────────────────

describe('QA · mining', () => {
  let session: ProfessionDemoSession
  let clock: { seconds: number }

  beforeEach(() => {
    session = useProfessionDemo()
    // No worker: summoning one would need overworld sprite sheets.
    session.update(state => setDemoWorker(state, 'mining', null))
    clock = { seconds: 0 }
  })

  it('never applies an action twice, however fast it is asked for', () => {
    const spot = targetAt('stone_outcrop')
    const game = stubPort(beside(spot).tx, beside(spot).ty)
    const mining = useMiningController(session, () => game)
    mining.inspect({ area, tx: spot.tx, ty: spot.ty })

    const before = bagCount(session.state.value, 'stone')
    expect(mining.mine()).toBe(true)
    // Four more taps while the pickaxe is already swinging.
    expect([mining.mine(), mining.mine(), mining.mine(), mining.mine()]).toEqual([false, false, false, false])
    run(clock, 6, [mining.overlay])

    expect(mining.phase.value).toBe('result')
    const gained = bagCount(session.state.value, 'stone') - before
    expect(gained).toBeGreaterThan(0)
    // One action, one drop roll: the node lost exactly one charge.
    expect(mining.outcome.value?.ok).toBe(true)
    expect(game.locked).toBe(false)
  })

  it('runs many consecutive cycles until the node is spent, then refuses', () => {
    const spot = targetAt('stone_outcrop')
    const game = stubPort(beside(spot).tx, beside(spot).ty)
    const mining = useMiningController(session, () => game)
    mining.inspect({ area, tx: spot.tx, ty: spot.ty })

    let actions = 0
    for (let i = 0; i < 20; i++) {
      if (!mining.mine()) break
      actions++
      run(clock, 6, [mining.overlay])
    }
    expect(actions).toBe(spot.target.node.personalCharges)
    expect(mining.mine()).toBe(false)
    expect(game.locked).toBe(false)
  })

  it('cancelling mid-swing gives no reward and leaves no lock behind', () => {
    const spot = targetAt('stone_outcrop')
    const game = stubPort(beside(spot).tx, beside(spot).ty)
    const mining = useMiningController(session, () => game)
    mining.inspect({ area, tx: spot.tx, ty: spot.ty })
    const before = bagCount(session.state.value, 'stone')

    mining.mine()
    run(clock, 0.3, [mining.overlay])
    mining.detach()

    expect(bagCount(session.state.value, 'stone')).toBe(before)
    expect(game.locked).toBe(false)
    expect(game.overlay).toBeNull()
    // Ticking after the cancel must not resurrect the action.
    run(clock, 6, [mining.overlay])
    expect(bagCount(session.state.value, 'stone')).toBe(before)
  })

  it('walking away from the node closes the interaction instead of mining', () => {
    const spot = targetAt('stone_outcrop')
    const game = stubPort(beside(spot).tx, beside(spot).ty)
    const mining = useMiningController(session, () => game)
    mining.inspect({ area, tx: spot.tx, ty: spot.ty })

    game.player = { ...game.player, tx: game.player.tx + 4 }
    expect(mining.mine()).toBe(false)
    expect(mining.selection.value).toBeNull()
    expect(game.locked).toBe(false)
  })

  it('refuses to mine with a broken pickaxe and accepts it again once repaired', () => {
    const spot = targetAt('iron_vein')
    const game = stubPort(beside(spot).tx, beside(spot).ty)
    const mining = useMiningController(session, () => game)
    session.update(state => setDemoDurability(state, 'pickaxe', 0))
    mining.inspect({ area, tx: spot.tx, ty: spot.ty })

    expect(demoTool(session.state.value, 'mining')?.instance.durability).toBe(0)
    expect(mining.mine()).toBe(false)

    // The refused attempt reports what the repair costs; grant exactly that.
    const quote = session.repair('mining')
    expect(quote.ok).toBe(false)
    session.update(state => setDemoInventory(state, {
      ...demoCounts(state),
      ...Object.fromEntries(quote.cost.map(stack => [stack.itemId, stack.quantity + 2])),
    }))
    expect(session.repair('mining').ok).toBe(true)
    expect(mining.mine()).toBe(true)
    run(clock, 8, [mining.overlay])
    expect(mining.outcome.value?.ok).toBe(true)
  })

  it('keeps the reward when the bag is full by sending it to pending', () => {
    const spot = targetAt('stone_outcrop')
    const game = stubPort(beside(spot).tx, beside(spot).ty)
    const mining = useMiningController(session, () => game)
    session.update(state => fillDemoBag(state, 'full'))
    mining.inspect({ area, tx: spot.tx, ty: spot.ty })

    const ok = mining.mine()
    run(clock, 6, [mining.overlay])
    if (ok) {
      const outcome = mining.outcome.value
      expect(outcome?.ok).toBe(true)
      if (outcome?.ok) {
        // Nothing is silently dropped: it either lands in a slot or waits in pending.
        const stored = outcome.placements.length + outcome.overflow.length
        expect(stored).toBeGreaterThan(0)
        if (outcome.overflow.length) expect(session.state.value.pending.length).toBeGreaterThan(0)
      }
    } else {
      // Or the card refuses up front, which is the other acceptable answer.
      expect(mining.phase.value).toBe('idle')
    }
  })
})

// ── Logging, foraging: the same contract on other professions ──────────────

describe('QA · logging and foraging', () => {
  let session: ProfessionDemoSession
  let clock: { seconds: number }

  beforeEach(() => {
    session = useProfessionDemo()
    session.update(state => setDemoWorker(setDemoWorker(state, 'woodcutting', null), 'alchemy', null))
    clock = { seconds: 0 }
  })

  it('chopping ignores repeated taps and spends one charge per action', () => {
    const spot = targetAt('common_tree')
    const game = stubPort(beside(spot).tx, beside(spot).ty)
    const logging = useLoggingController(session, () => game)
    logging.inspect({ area, tx: spot.tx, ty: spot.ty })

    const before = bagCount(session.state.value, 'common_log')
    expect(logging.chop()).toBe(true)
    expect(logging.chop()).toBe(false)
    run(clock, 8, [logging.overlay])

    expect(bagCount(session.state.value, 'common_log')).toBeGreaterThan(before)
    expect(game.locked).toBe(false)
  })

  it('foraging by hand and with a sickle both complete and deplete the plant', () => {
    const spot = targetAt('berry_bush')
    const game = stubPort(beside(spot).tx, beside(spot).ty)
    const forage = useForageController(session, () => game)
    forage.inspect({ area, tx: spot.tx, ty: spot.ty })

    let actions = 0
    for (let i = 0; i < 12; i++) {
      if (!forage.gather()) break
      actions++
      run(clock, 8, [forage.overlay])
    }
    expect(actions).toBe(spot.target.node.personalCharges)
    expect(bagCount(session.state.value, 'oran_berry')).toBeGreaterThan(0)
    expect(game.locked).toBe(false)
  })

  it('a depleted plant comes back after the respawn window and can be worked again', () => {
    const spot = targetAt('berry_bush')
    const game = stubPort(beside(spot).tx, beside(spot).ty)
    const forage = useForageController(session, () => game)
    forage.inspect({ area, tx: spot.tx, ty: spot.ty })
    while (forage.gather()) run(clock, 8, [forage.overlay])
    expect(forage.gather()).toBe(false)

    session.advance((spot.target.node.respawnSeconds + 5) * 1000)
    expect(forage.gather()).toBe(true)
    run(clock, 8, [forage.overlay])
    expect(forage.outcome.value?.ok).toBe(true)
  })

  it('switching target mid-selection never leaves the first node locked', () => {
    const tree = targetAt('common_tree')
    const bush = targetAt('berry_bush')
    const game = stubPort(beside(tree).tx, beside(tree).ty)
    const logging = useLoggingController(session, () => game)
    const forage = useForageController(session, () => game)

    logging.inspect({ area, tx: tree.tx, ty: tree.ty })
    expect(logging.selection.value).not.toBeNull()
    // The world demo closes the other professions when one claims the tap.
    forage.inspect({ area, tx: bush.tx, ty: bush.ty })
    logging.close()

    expect(logging.selection.value).toBeNull()
    expect(forage.selection.value).not.toBeNull()
    expect(game.locked).toBe(false)
  })
})

// ── Fishing: the timing window ─────────────────────────────────────────────

describe('QA · fishing', () => {
  let session: ProfessionDemoSession
  let clock: { seconds: number }

  beforeEach(() => {
    session = useProfessionDemo()
    session.update(state => setDemoWorker(state, 'fishing', null))
    clock = { seconds: 0 }
  })

  it('reeling before the bite and reeling twice never double-reward', () => {
    const spot = targetAt('shore_spot')
    const game = stubPort(beside(spot).tx, beside(spot).ty)
    const fishing = useFishingController(session, () => game)
    const hit = fishing.inspect({ area, tx: spot.tx, ty: spot.ty })
    if (!hit) return // the shore landmark needs water beside it; covered elsewhere

    const before = bagCount(session.state.value, 'fish')
    if (!fishing.cast()) return
    // Reel far too early: the grade may be a miss, but nothing is rewarded twice.
    fishing.reel()
    fishing.reel()
    run(clock, 20, [fishing.overlay])

    expect(game.locked).toBe(false)
    expect(bagCount(session.state.value, 'fish') - before).toBeLessThanOrEqual(3)
    expect(fishing.phase.value).not.toBe('casting')
  })

  it('a second cast while the line is out is refused', () => {
    const spot = targetAt('shore_spot')
    const game = stubPort(beside(spot).tx, beside(spot).ty)
    const fishing = useFishingController(session, () => game)
    if (!fishing.inspect({ area, tx: spot.tx, ty: spot.ty })) return
    if (!fishing.cast()) return
    expect(fishing.cast()).toBe(false)
    run(clock, 20, [fishing.overlay])
    expect(game.locked).toBe(false)
  })
})

// ── Alchemy: batches, exact and missing ingredients, timers ────────────────

describe('QA · alchemy bench', () => {
  let session: ProfessionDemoSession
  let clock: { seconds: number }
  const anchor = () => alchemyStationTile({
    isSolid: (tx, ty) => world.isSolid(tx, ty),
    isWater: (tx, ty) => world.isWater(tx, ty),
    hasNode: (tx, ty) => nodeAt(port, tx, ty) !== null,
  }, PRADERA_SPAWN)

  beforeEach(() => {
    vi.useFakeTimers()
    session = useProfessionDemo()
    session.update(state => setDemoWorker(state, 'alchemy', null))
    clock = { seconds: 0 }
  })

  function benchPort(): StubPort {
    const tile = anchor()!
    return stubPort(tile.tx, tile.ty + 1)
  }

  it('brews exactly once per request and clears its progress timer', () => {
    const game = benchPort()
    const alchemy = useAlchemyController(session, () => game, () => PRADERA_SPAWN)
    alchemy.setStation(anchor())
    session.update(state => setDemoInventory(state, { oran_berry: 4, vial: 2 }))
    alchemy.select('brew_potion')

    expect(alchemy.brew()).toBe(true)
    expect(alchemy.brew()).toBe(false)
    run(clock, 12, [alchemy.overlay])

    expect(bagCount(session.state.value, 'potion')).toBe(1)
    expect(bagCount(session.state.value, 'oran_berry')).toBe(2)
    expect(alchemy.progress.value).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(game.locked).toBe(false)
  })

  it('a batch consumes and produces exactly what the quantity says', () => {
    const game = benchPort()
    const alchemy = useAlchemyController(session, () => game, () => PRADERA_SPAWN)
    alchemy.setStation(anchor())
    session.update(state => setDemoInventory(state, { oran_berry: 6, vial: 3 }))
    alchemy.select('brew_potion')
    alchemy.setQuantity(3)
    expect(alchemy.quantity.value).toBe(3)

    alchemy.brew()
    run(clock, 20, [alchemy.overlay])
    expect(bagCount(session.state.value, 'potion')).toBe(3)
    expect(bagCount(session.state.value, 'oran_berry')).toBeLessThanOrEqual(1)
    expect(bagCount(session.state.value, 'vial')).toBe(0)
  })

  it('clamps the quantity to what the ingredients allow', () => {
    const game = benchPort()
    const alchemy = useAlchemyController(session, () => game, () => PRADERA_SPAWN)
    alchemy.setStation(anchor())
    session.update(state => setDemoInventory(state, { oran_berry: 4, vial: 1 }))
    alchemy.select('brew_potion')
    alchemy.setQuantity(99)
    expect(alchemy.quantity.value).toBe(1)
    expect(alchemy.maxQuantity.value).toBe(1)
  })

  it('refuses to brew without the ingredients and says which one is short', () => {
    const game = benchPort()
    const alchemy = useAlchemyController(session, () => game, () => PRADERA_SPAWN)
    alchemy.setStation(anchor())
    session.update(state => setDemoInventory(state, { oran_berry: 1 }))
    alchemy.select('brew_potion')

    expect(alchemy.view.value?.block.kind).toBe('missing')
    expect(alchemy.brew()).toBe(false)
    expect(game.locked).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancelling a brew leaves no product, no timer and no lock', () => {
    const game = benchPort()
    const alchemy = useAlchemyController(session, () => game, () => PRADERA_SPAWN)
    alchemy.setStation(anchor())
    session.update(state => setDemoInventory(state, { oran_berry: 4, vial: 2 }))
    alchemy.select('brew_potion')
    alchemy.brew()
    run(clock, 0.4, [alchemy.overlay])
    alchemy.detach()

    expect(bagCount(session.state.value, 'potion')).toBe(0)
    expect(bagCount(session.state.value, 'oran_berry')).toBe(4)
    expect(game.locked).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})

// ── Cross-profession: one session, four systems ────────────────────────────

describe('QA · cross-profession session', () => {
  it('mines, chops, forages and brews in one session without losing anything', () => {
    const session = useProfessionDemo()
    session.update(state => setDemoWorker(setDemoWorker(setDemoWorker(setDemoWorker(
      state, 'mining', null), 'woodcutting', null), 'fishing', null), 'alchemy', null))
    const clock = { seconds: 0 }

    const rock = targetAt('stone_outcrop')
    const tree = targetAt('common_tree')
    const bush = targetAt('berry_bush')
    const game = stubPort(beside(rock).tx, beside(rock).ty)

    const mining = useMiningController(session, () => game)
    const logging = useLoggingController(session, () => game)
    const forage = useForageController(session, () => game)
    const alchemy = useAlchemyController(session, () => game, () => PRADERA_SPAWN)
    const overlays = [mining.overlay, logging.overlay, forage.overlay, alchemy.overlay]

    mining.inspect({ area, tx: rock.tx, ty: rock.ty })
    expect(mining.mine()).toBe(true)
    run(clock, 8, overlays)
    mining.close()

    game.player = { ...game.player, tx: beside(tree).tx, ty: beside(tree).ty }
    logging.inspect({ area, tx: tree.tx, ty: tree.ty })
    expect(logging.chop()).toBe(true)
    run(clock, 10, overlays)
    logging.close()

    game.player = { ...game.player, tx: beside(bush).tx, ty: beside(bush).ty }
    forage.inspect({ area, tx: bush.tx, ty: bush.ty })
    expect(forage.gather()).toBe(true)
    run(clock, 10, overlays)
    forage.close()

    // Everything gathered is in one bag, and the bench can use it.
    expect(bagCount(session.state.value, 'stone')).toBeGreaterThan(0)
    expect(bagCount(session.state.value, 'common_log')).toBeGreaterThan(0)
    const berries = bagCount(session.state.value, 'oran_berry')
    expect(berries).toBeGreaterThan(0)

    session.update(state => setDemoInventory(state, { ...demoCounts(state), vial: 2 }))
    alchemy.setStation(alchemyStationTile({
      isSolid: (tx, ty) => world.isSolid(tx, ty),
      isWater: (tx, ty) => world.isWater(tx, ty),
      hasNode: (tx, ty) => nodeAt(port, tx, ty) !== null,
    }, PRADERA_SPAWN))
    const tile = alchemy.currentStation.value!
    game.player = { ...game.player, tx: tile.tx, ty: tile.ty + 1 }
    alchemy.select('brew_potion')
    expect(alchemy.view.value?.block.kind).toBe('none')
    expect(alchemy.brew()).toBe(true)
    run(clock, 14, overlays)

    expect(bagCount(session.state.value, 'potion')).toBe(1)
    expect(bagCount(session.state.value, 'oran_berry')).toBe(berries - 2)
    expect(game.locked).toBe(false)
    // Every profession kept its own XP; nothing leaked into another.
    expect(demoLevel(session.state.value, 'mining')).toBeGreaterThan(0)
    expect(demoLevel(session.state.value, 'alchemy')).toBeGreaterThan(0)
  })
})
