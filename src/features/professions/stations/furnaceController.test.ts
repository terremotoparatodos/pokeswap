// R33 — the furnace controller's clock.
//
// The pure process takes `nowMs` as an argument, so a unit test can never
// catch the surface handing it a reading that does not move. That is exactly
// what happened in the live check: the furnace showed "9 s left" for ever and
// never finished, because the demo session's clock only advances when
// something asks it to and the poll never did.
//
// These tests drive the real controller with the real session, so the clock is
// the one the prototype actually uses.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useProfessionDemo } from '../demo/useProfessionDemo'
import { demoCounts, setDemoInventory } from '../demo/demoSession'
import { placeStation } from './stationInstance'
import { useFurnaceController } from './useFurnaceController'

/**
 * Wall-clock time, moved by hand.
 *
 * `session.advance()` would not do: it syncs the session on its way through,
 * which is precisely the step the bug was missing. Time has to pass the way it
 * does in a browser — silently — for the poll to be the thing that notices.
 */
let clock = 1_700_000_000_000
beforeEach(() => {
  clock = 1_700_000_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => clock)
})
afterEach(() => vi.restoreAllMocks())
const passes = (ms: number) => { clock += ms }

/** The controller only calls `setSceneOverlay`; nothing here needs a canvas. */
const gamePort = () => ({
  setSceneOverlay: vi.fn(),
  setInputLocked: vi.fn(),
  playerSnapshot: () => ({ tx: 0, ty: 0, x: 0, y: 0, dir: 'down' as const, moving: false, areaId: 'pradera' }),
})

function furnaceAt(inventory: Record<string, number> = { iron_ore: 4, coal: 3 }) {
  const session = useProfessionDemo()
  session.update(state => setDemoInventory(state, inventory))
  const port = gamePort()
  const furnace = useFurnaceController(session, () => port)
  furnace.station.value = placeStation('furnace:test', 'smelter', 'pradera', { tx: 0, ty: 0 })
  furnace.select('smelt_iron')
  return { session, furnace }
}

describe('the furnace on the session clock', () => {
  it('counts down as the clock moves, and finishes when it runs out', () => {
    const { furnace } = furnaceAt()
    expect(furnace.prepare()).toBe(true)
    expect(furnace.start()).toBe(true)
    expect(furnace.phase.value).toBe('working')

    const duration = furnace.process.value!.durationMs
    const before = furnace.remainingSeconds.value
    expect(before).toBeGreaterThan(0)

    // The surface polls; the clock has not moved yet.
    furnace.tick()
    expect(furnace.phase.value).toBe('working')

    passes(duration / 2)
    furnace.tick()
    expect(furnace.phase.value).toBe('working')
    // This is the assertion the bug failed: the countdown has to actually move.
    expect(furnace.remainingSeconds.value).toBeLessThan(before)

    passes(duration / 2)
    furnace.tick()
    expect(furnace.phase.value).toBe('done')
    expect(furnace.remainingSeconds.value).toBe(0)
  })

  it('stays done until it is collected, however often the poll runs', () => {
    const { session, furnace } = furnaceAt()
    furnace.prepare()
    furnace.start()
    passes(600_000)
    for (let i = 0; i < 100; i++) furnace.tick()
    expect(furnace.phase.value).toBe('done')
    expect(demoCounts(session.state.value).iron_ingot ?? 0).toBe(0)

    expect(furnace.collect()).toBe(true)
    expect(furnace.phase.value).toBe('idle')
    expect(demoCounts(session.state.value).iron_ingot).toBe(1)

    // And collecting again credits nothing.
    expect(furnace.collect()).toBe(false)
    expect(furnace.failure.value?.code).toBe('no_process')
    expect(demoCounts(session.state.value).iron_ingot).toBe(1)
  })

  it('reports a refusal instead of spending anything', () => {
    const { session, furnace } = furnaceAt({ iron_ore: 1, coal: 0 })
    expect(furnace.prepare()).toBe(false)
    expect(furnace.failure.value?.code).toBe('missing_inputs')
    expect(furnace.phase.value).toBe('idle')
    expect(demoCounts(session.state.value).iron_ore).toBe(1)
  })

  it('and a second start is refused without restarting the work', () => {
    const { furnace } = furnaceAt()
    furnace.prepare()
    furnace.start()
    const startedAt = furnace.process.value!.startedAtMs
    expect(furnace.start()).toBe(false)
    expect(furnace.failure.value?.code).toBe('already_started')
    expect(furnace.process.value!.startedAtMs).toBe(startedAt)
  })
})
