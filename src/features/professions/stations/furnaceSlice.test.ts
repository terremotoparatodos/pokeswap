// R33 — the vertical slice, end to end: raw ore → furnace → ingot.
//
// This is the reproducible version of the human sample (§42). It drives the
// *real* demo session — the same bag, stack rules, levels and XP the dev world
// uses — through the whole loop, and then through the three ways a player will
// try to break it: with no materials, starting twice, collecting twice.
//
// Nothing here waits. Time is the session's clock, moved with `advance`, which
// is why a six-second smelt takes no time to assert.

import { describe, expect, it } from 'vitest'
import { createDemoState, demoCounts, setDemoInventory, syncDemoClock, type DemoState } from '../demo/demoSession'
import { placeStation, stationState, type PlacedStation } from './stationInstance'
import { cancelStation, collectStation, prepareStation, startStation, tickStation } from './stationSession'
import { stationVisualState } from './stationVisualState'

const AREA = 'pradera'
const START = 1_000_000
const SMELT_IRON = 'smelt_iron'

/** A player standing at a furnace with ore in the bag; the demo starts Mining at 16. */
function scene(inventory = { iron_ore: 4, coal: 3 }) {
  const state = setDemoInventory(createDemoState(START), inventory)
  return { state, station: placeStation('furnace:pradera', 'smelter', AREA, { tx: 10, ty: 10 }) }
}

/** What the surface's poll does: hand the domain a clock reading. */
const at = (state: DemoState, ms: number): DemoState => syncDemoClock(state, START + ms)

describe('the furnace, from ore to ingot', () => {
  it('runs the whole loop and leaves the station idle again', () => {
    let { state, station } = scene()

    // 1. The furnace is cold and the player has ore.
    expect(stationVisualState(station)).toBe('idle')
    expect(demoCounts(state).iron_ore).toBe(4)
    expect(demoCounts(state).iron_ingot ?? 0).toBe(0)

    // 2. Prepare: the ore and the coal leave the bag, once.
    const readied = prepareStation(state, station, SMELT_IRON, 1, 'run-1')
    expect(readied.ok).toBe(true)
    if (!readied.ok) return
    ;({ state, station } = readied)
    expect(stationVisualState(station)).toBe('ready')
    expect(demoCounts(state).iron_ore).toBe(2)
    expect(demoCounts(state).coal).toBe(2)
    expect(demoCounts(state).iron_ingot ?? 0).toBe(0)

    // 3. Start.
    const started = startStation(state, station, state.now)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    ;({ state, station } = started)
    expect(stationVisualState(station)).toBe('working')
    const duration = station.process!.durationMs

    // 4. It is still working one millisecond short of the time.
    station = tickStation(station, at(state, duration - 1).now)
    expect(stationVisualState(station)).toBe('working')

    // 5. Time passes, and it is done.
    state = at(state, duration)
    station = tickStation(station, state.now)
    expect(stationVisualState(station)).toBe('done')

    // 6. DONE persists: nothing hands the ingot over on its own.
    state = at(state, duration + 600_000)
    station = tickStation(station, state.now)
    expect(stationVisualState(station)).toBe('done')
    expect(demoCounts(state).iron_ingot ?? 0).toBe(0)

    // 7. Collect: the ingot is in the bag and the furnace is cold again.
    const collected = collectStation(state, station)
    expect(collected.ok).toBe(true)
    if (!collected.ok) return
    ;({ state, station } = collected)
    expect(demoCounts(state).iron_ingot).toBe(1)
    expect(collected.xp).toBeGreaterThan(0)
    expect(stationVisualState(station)).toBe('idle')
    expect(station.process).toBeNull()

    // And the ore that was not committed is untouched.
    expect(demoCounts(state).iron_ore).toBe(2)
  })

  it('a second run works too, so the loop is a loop', () => {
    let { state, station } = scene()
    // The clock only ever moves forward, so each run starts after the last one.
    let clock = 0
    for (const run of ['run-1', 'run-2']) {
      const readied = prepareStation(state, station, SMELT_IRON, 1, run)
      expect(readied.ok, run).toBe(true)
      if (!readied.ok) return
      ;({ state, station } = readied)
      const started = startStation(state, station, state.now)
      if (!started.ok) return
      ;({ state, station } = started)
      clock += 600_000
      state = at(state, clock)
      station = tickStation(station, state.now)
      const collected = collectStation(state, station)
      expect(collected.ok, run).toBe(true)
      if (!collected.ok) return
      ;({ state, station } = collected)
    }
    expect(demoCounts(state).iron_ingot).toBe(2)
    // An emptied stack leaves the bag entirely, so the count is absent, not zero.
    expect(demoCounts(state).iron_ore ?? 0).toBe(0)
  })
})

describe('what a player will try', () => {
  it('with no materials, nothing happens and nothing is spent', () => {
    const { state, station } = scene({ iron_ore: 1, coal: 0 })
    const result = prepareStation(state, station, SMELT_IRON, 1, 'run-1')
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error.code).toBe('missing_inputs')
    expect(demoCounts(result.state).iron_ore).toBe(1)
    expect(stationState(result.station)).toBe('idle')
  })

  it('starting twice does not restart the clock or double anything', () => {
    let { state, station } = scene()
    const readied = prepareStation(state, station, SMELT_IRON, 1, 'run-1')
    if (!readied.ok) return
    ;({ state, station } = readied)
    const first = startStation(state, station, state.now)
    if (!first.ok) return
    const startedAt = first.process.startedAtMs

    const second = startStation(first.state, first.station, first.state.now + 5_000)
    expect(second.ok).toBe(false)
    expect(!second.ok && second.error).toEqual({ code: 'already_started', phase: 'working' })
    expect(second.station.process!.startedAtMs).toBe(startedAt)
  })

  it('collecting twice credits one ingot, not two', () => {
    let { state, station } = scene()
    const readied = prepareStation(state, station, SMELT_IRON, 1, 'run-1')
    if (!readied.ok) return
    ;({ state, station } = readied)
    const started = startStation(state, station, state.now)
    if (!started.ok) return
    ;({ state, station } = started)
    state = at(state, 600_000)
    station = tickStation(station, state.now)

    const first = collectStation(state, station)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = collectStation(first.state, first.station)
    expect(second.ok).toBe(false)
    expect(!second.ok && second.error).toEqual({ code: 'no_process', phase: 'idle' })
    expect(demoCounts(second.state).iron_ingot).toBe(1)
  })

  it('collecting early is refused and the work keeps running', () => {
    let { state, station } = scene()
    const readied = prepareStation(state, station, SMELT_IRON, 1, 'run-1')
    if (!readied.ok) return
    ;({ state, station } = readied)
    const started = startStation(state, station, state.now)
    if (!started.ok) return
    const early = collectStation(started.state, started.station)
    expect(early.ok).toBe(false)
    expect(!early.ok && early.error).toEqual({ code: 'not_done', phase: 'working' })
    expect(stationVisualState(early.station)).toBe('working')
    expect(demoCounts(early.state).iron_ingot ?? 0).toBe(0)
  })

  it('unloading a charged furnace puts exactly what it took back in the bag', () => {
    const { state, station } = scene()
    const before = demoCounts(state)
    const readied = prepareStation(state, station, SMELT_IRON, 1, 'run-1')
    if (!readied.ok) return
    const cancelled = cancelStation(readied.state, readied.station)
    expect(cancelled.ok).toBe(true)
    if (!cancelled.ok) return
    expect(demoCounts(cancelled.state).iron_ore).toBe(before.iron_ore)
    expect(demoCounts(cancelled.state).coal).toBe(before.coal)
    expect(stationVisualState(cancelled.station)).toBe('idle')
  })

  it('and a second furnace cannot be charged with ore the first one is holding', () => {
    const { state, station } = scene({ iron_ore: 2, coal: 1 })
    const other: PlacedStation = placeStation('furnace:otra', 'smelter', AREA, { tx: 30, ty: 30 })
    const first = prepareStation(state, station, SMELT_IRON, 1, 'run-1')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = prepareStation(first.state, other, SMELT_IRON, 1, 'run-2')
    expect(second.ok).toBe(false)
    expect(!second.ok && second.error.code).toBe('missing_inputs')
  })
})
