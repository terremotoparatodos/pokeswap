// R33 — the contracts the microphase froze.
//
// These are the sentences R33 is asking to be approved on, each one as a test
// rather than as a paragraph: what the clock is allowed to decide, what a
// reload is allowed to need, what a full bag may not lose, that one station
// runs one process, that a station in the catalog is not thereby playable, and
// that the DEV way of finding a spot is not the way a station is placed.

import { describe, expect, it } from 'vitest'
import {
  createDemoState, demoCounts, demoRules, discardDemoSlot, setDemoBag, setDemoInventory, type DemoState,
} from '../demo/demoSession'
import type { Inventory } from '../domain/types'
import { STATION_BY_ID, STATION_DEFINITIONS, recipesForStation } from './stationDefinition'
import { devFindStationSpot } from './devStationPlacement'
import {
  stationFromPlacement, stationPlacement, validatePlacement, type StationWorldPort,
} from './stationPlacement'
import { placeStation, stationState, withProcess, type PlacedStation } from './stationInstance'
import {
  advanceProcess, advanceProcessChecked, cancelProcess, isTrustedReading,
  prepareProcess, remainingMs, startProcess, stationPhase, type StationProcessState,
} from './stationProcess'
import { parseStation } from './stationSerialization'
import { cancelStation, collectStation, prepareStation, startStation, tickStation } from './stationSession'

const FURNACE = STATION_BY_ID.get('smelter')!
const AREA = 'pradera'
const SMELT_IRON = 'smelt_iron'
const stock: Inventory = { iron_ore: 6, coal: 4 }

const furnace = () => placeStation('furnace-1', 'smelter', AREA, { tx: 4, ty: 6 })

function readyProcess(inventory: Inventory = stock): StationProcessState {
  const result = prepareProcess({
    process: null, definition: FURNACE, recipeId: SMELT_IRON, quantity: 1,
    inventory, professionLevel: 16, processId: 'p1',
  })
  if (!result.ok) throw new Error(result.error.code)
  return result.process
}

const working = (startedAt = 1_000): StationProcessState =>
  (startProcess(readyProcess(), startedAt) as { process: StationProcessState }).process

// ── 1. Whose clock decides ──────────────────────────────────────────────────

describe('a client cannot say a process is finished', () => {
  it('no exported function takes a completion flag: the only way to DONE is a reading', () => {
    // A guard against the shape, not the value. If someone ever adds
    // `completeProcess(process)` or a `done: true` option, this fails and the
    // trust boundary gets re-read before it ships.
    const sources = import.meta.glob<string>('./stationProcess.ts', { query: '?raw', import: 'default', eager: true })
    const source = Object.values(sources)[0]
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/export function complete|completed\s*[?:]|isDone\s*[?:]|forceComplete/)
    // Every exported transition that can reach DONE names a clock reading.
    expect(code).toMatch(/export function advanceProcess\(process: StationProcessState \| null, nowMs: number\)/)
  })

  it('refuses the two readings a caller would use to force a finish', () => {
    const process = working()
    expect(isTrustedReading(Infinity)).toBe(false)
    expect(isTrustedReading(Number.NaN)).toBe(false)
    expect(isTrustedReading(Date.now())).toBe(true)

    expect(advanceProcess(process, Infinity)!.phase).toBe('working')
    expect(advanceProcess(process, -Infinity)!.phase).toBe('working')
    expect(advanceProcess(process, Number.NaN)!.phase).toBe('working')
  })

  it('and says so, rather than quietly answering "not yet"', () => {
    const process = working()
    const refused = advanceProcessChecked(process, Infinity)
    expect(refused.ok).toBe(false)
    expect(!refused.ok && refused.error).toEqual({ code: 'untrusted_clock', phase: 'working' })

    const fine = advanceProcessChecked(process, 1_000 + process.durationMs)
    expect(fine.ok && fine.process!.phase).toBe('done')
  })

  it('a process cannot even be started on an unusable reading', () => {
    const refused = startProcess(readyProcess(), Number.NaN)
    expect(refused.ok).toBe(false)
    expect(!refused.ok && refused.error).toEqual({ code: 'untrusted_clock', phase: 'ready' })
  })

  it('and an unusable reading reports the whole duration left, never zero', () => {
    const process = working()
    expect(remainingMs(process, Infinity)).toBe(process.durationMs)
    expect(remainingMs(process, Number.NaN)).toBe(process.durationMs)
  })
})

// ── 2. Reload ───────────────────────────────────────────────────────────────

describe('a reload needs two numbers and a trusted reading, and nothing else', () => {
  const startedAtMs = 5_000

  /** What a store would hand back: JSON, cold, with no timer having existed. */
  const reloaded = (): PlacedStation =>
    parseStation(JSON.parse(JSON.stringify(withProcess(furnace(), working(startedAtMs)))))!

  it('a station that was WORKING comes back WORKING', () => {
    expect(stationState(reloaded())).toBe('working')
  })

  it('computes the remaining time from startedAtMs + durationMs', () => {
    const station = reloaded()
    const duration = station.process!.durationMs
    expect(station.process!.startedAtMs).toBe(startedAtMs)
    expect(remainingMs(station.process, startedAtMs)).toBe(duration)
    expect(remainingMs(station.process, startedAtMs + duration / 2)).toBe(duration / 2)
    expect(remainingMs(station.process, startedAtMs + duration)).toBe(0)
  })

  it('is not completed before its time, and is completed on it', () => {
    const station = reloaded()
    const duration = station.process!.durationMs
    expect(stationPhase(advanceProcess(station.process, startedAtMs + duration - 1))).toBe('working')
    expect(stationPhase(advanceProcess(station.process, startedAtMs + duration))).toBe('done')
  })

  it('and a reload after the deadline lands on DONE without replaying anything', () => {
    const station = reloaded()
    const done = tickStation(station, startedAtMs + 86_400_000)
    expect(stationState(done)).toBe('done')
    // Still one output, decided when it was prepared.
    expect(done.process!.output).toEqual([{ itemId: 'iron_ingot', quantity: 1 }])
  })
})

// ── 3. A full bag loses nothing ─────────────────────────────────────────────

describe('collecting into a full bag', () => {
  /** A furnace that has finished, and a player whose bag has no room. */
  function finishedWithFullBag() {
    let state = setDemoInventory(createDemoState(1_000_000), { iron_ore: 2, coal: 1 })
    let station = placeStation('furnace-1', 'smelter', AREA, { tx: 0, ty: 0 })

    const readied = prepareStation(state, station, SMELT_IRON, 1, 'run-1')
    if (!readied.ok) throw new Error(readied.error.code)
    ;({ state, station } = readied)
    const started = startStation(state, station, state.now)
    if (!started.ok) throw new Error(started.error.code)
    ;({ state, station } = started)
    station = tickStation(station, state.now + 600_000)

    return { state: noRoomLeft(state), station }
  }

  /**
   * Every slot taken, and none of them by an ingot — so "there is no ingot in
   * the bag" stays a real assertion. The catalog preset fills with ingots among
   * other things, which would hide exactly what this is measuring.
   */
  function noRoomLeft(state: DemoState): DemoState {
    const maxStack = demoRules(state).maxStack('stone')
    return setDemoBag(state, Array.from({ length: state.bag.capacity }, () => ({ itemId: 'stone', quantity: maxStack })))
  }

  it('is refused with a code the UI can explain', () => {
    const { state, station } = finishedWithFullBag()
    const refused = collectStation(state, station)
    expect(refused.ok).toBe(false)
    expect(!refused.ok && refused.error).toEqual({ code: 'output_capacity_exceeded', phase: 'done' })
  })

  it('leaves the station DONE with its output still waiting', () => {
    const { state, station } = finishedWithFullBag()
    const refused = collectStation(state, station)
    expect(stationState(refused.station)).toBe('done')
    expect(refused.station.process!.output).toEqual([{ itemId: 'iron_ingot', quantity: 1 }])
    expect(refused.station.process!.processId).toBe('run-1')
  })

  it('credits nothing and re-spends nothing', () => {
    const { state, station } = finishedWithFullBag()
    const refused = collectStation(state, station)
    expect(demoCounts(refused.state).iron_ingot ?? 0).toBe(0)
    // The session is handed back exactly as it went in.
    expect(refused.state).toBe(state)
    expect(refused.station).toBe(station)
  })

  it('and once a slot is free, the same collect works — once', () => {
    const scene = finishedWithFullBag()
    const station = scene.station
    let state = scene.state
    expect(collectStation(state, station).ok).toBe(false)

    state = discardDemoSlot(state, 0)
    const collected = collectStation(state, station)
    expect(collected.ok).toBe(true)
    if (!collected.ok) return
    expect(demoCounts(collected.state).iron_ingot).toBe(1)
    expect(stationState(collected.station)).toBe('idle')

    const again = collectStation(collected.state, collected.station)
    expect(again.ok).toBe(false)
    expect(!again.ok && again.error).toEqual({ code: 'no_process', phase: 'idle' })
    expect(demoCounts(again.state).iron_ingot).toBe(1)
  })

  it('and unloading a READY furnace into a full bag keeps the inputs with the process too', () => {
    let state = setDemoInventory(createDemoState(1_000_000), { iron_ore: 2, coal: 1 })
    let station = placeStation('furnace-1', 'smelter', AREA, { tx: 0, ty: 0 })
    const readied = prepareStation(state, station, SMELT_IRON, 1, 'run-1')
    if (!readied.ok) return
    ;({ state, station } = readied)
    state = noRoomLeft(state)

    const refused = cancelStation(state, station)
    expect(refused.ok).toBe(false)
    expect(!refused.ok && refused.error).toEqual({ code: 'output_capacity_exceeded', phase: 'ready' })
    expect(stationState(refused.station)).toBe('ready')
    expect(refused.station.process!.committed).toEqual([{ itemId: 'iron_ore', quantity: 2 }, { itemId: 'coal', quantity: 1 }])
  })
})

// ── 4. One process per station, v1 ──────────────────────────────────────────

describe('one active process per station', () => {
  it('a second prepare is refused while the first is anywhere but IDLE', () => {
    for (const phase of ['ready', 'working', 'done'] as const) {
      const process = phase === 'ready' ? readyProcess()
        : phase === 'working' ? working()
          : advanceProcess(working(), 1e9)!
      const second = prepareProcess({
        process, definition: FURNACE, recipeId: SMELT_IRON, quantity: 1,
        inventory: stock, professionLevel: 16, processId: 'p2',
      })
      expect(second.ok, phase).toBe(false)
      expect(!second.ok && second.error, phase).toEqual({ code: 'station_busy', phase })
    }
  })

  it('a station holds one process and not a list, so a queue is additive rather than a rewrite', () => {
    const station = withProcess(furnace(), readyProcess())
    expect(Array.isArray(station.process)).toBe(false)
    // Identity lives on the process, not on the station, which is what a queue
    // would need in order to hold more than one of them later.
    expect(typeof station.process!.processId).toBe('string')
    expect(station.process!.processId).not.toBe(station.stationId)
  })
})

// ── 5. Cancel is READY-only, v1 ─────────────────────────────────────────────

describe('cancel, v1', () => {
  it('a READY process can be cancelled and gives its inputs back', () => {
    const cancelled = cancelProcess(readyProcess(), {})
    expect(cancelled.ok).toBe(true)
    expect(cancelled.ok && cancelled.refunded).toEqual([{ itemId: 'iron_ore', quantity: 2 }, { itemId: 'coal', quantity: 1 }])
  })

  it('a WORKING process cannot be, and nothing about it changes', () => {
    const process = working()
    const refused = cancelProcess(process, {})
    expect(refused.ok).toBe(false)
    expect(!refused.ok && refused.error).toEqual({ code: 'not_ready', phase: 'working' })
    expect(process.phase).toBe('working')
    expect(process.committed).toHaveLength(2)
  })

  it('and neither can a DONE one: what is finished is collected, not cancelled', () => {
    const refused = cancelProcess(advanceProcess(working(), 1e9), {})
    expect(!refused.ok && refused.error).toEqual({ code: 'not_ready', phase: 'done' })
  })
})

// ── 6. Being in the catalog is not being playable ───────────────────────────

describe('a station R33 has not made productive', () => {
  const inert = STATION_DEFINITIONS.filter(definition => !definition.productive)

  it('is the campfire and the workbench, and only those', () => {
    expect(inert.map(definition => definition.id).sort()).toEqual(['campfire', 'workbench'])
  })

  it('is still fully described: art, four states, footprint', () => {
    for (const definition of inert) {
      expect(definition.visualStates, definition.id).toHaveLength(4)
      expect(definition.art.width, definition.id).toBeGreaterThan(0)
      expect(definition.footprint.cells.length, definition.id).toBeGreaterThan(0)
    }
  })

  it('refuses to start any work, even with a recipe it would otherwise support', () => {
    for (const definition of inert) {
      const recipe = recipesForStation(definition.id)[0]
      const result = prepareProcess({
        process: null, definition,
        // Whatever the catalog says this station is for; the refusal comes
        // before the recipe is even looked up.
        recipeId: recipe?.id ?? SMELT_IRON,
        quantity: 1, inventory: { ...stock, common_log: 20, fish: 20, oran_berry: 20, medicinal_herb: 20, plank: 20, stone: 20 },
        professionLevel: 99, processId: 'p1',
      })
      expect(result.ok, definition.id).toBe(false)
      expect(!result.ok && result.error.code, definition.id).toBe('station_not_productive')
    }
  })

  it('and the refusal comes before anything is spent', () => {
    const before: Inventory = { common_log: 6, stone: 4 }
    const result = prepareProcess({
      process: null, definition: STATION_BY_ID.get('campfire')!, recipeId: 'render_fish_oil',
      quantity: 1, inventory: before, professionLevel: 99, processId: 'p1',
    })
    expect(result.ok).toBe(false)
    expect(before).toEqual({ common_log: 6, stone: 4 })
  })
})

// ── 7. Placement is declared, not searched ──────────────────────────────────

describe('the placement contract', () => {
  const openWorld = (): StationWorldPort => ({ isSolid: () => false, isWater: () => false, hasNode: () => false })

  it('a placement record carries area, position, shape and station identity', () => {
    const placement = stationPlacement('furnace:pradera', 'smelter', AREA, { tx: 4, ty: 6 })
    expect(placement).toEqual({
      stationId: 'furnace:pradera',
      stationType: 'smelter',
      areaId: AREA,
      anchor: { tx: 4, ty: 6 },
      cells: [{ dx: 0, dy: 0 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 1, dy: 1 }],
      ownerId: null,
    })
  })

  it('and a station stood up from one needs nothing else', () => {
    const station = stationFromPlacement(stationPlacement('f', 'smelter', AREA, { tx: 1, ty: 1 }, 'someone'))
    expect(station.stationId).toBe('f')
    expect(station.areaId).toBe(AREA)
    expect(station.anchor).toEqual({ tx: 1, ty: 1 })
    expect(station.ownerId).toBe('someone')
    expect(station.process).toBeNull()
  })

  it('the record is JSON, so a store can hold it as it stands', () => {
    const placement = stationPlacement('f', 'smelter', AREA, { tx: 1, ty: 1 })
    expect(JSON.parse(JSON.stringify(placement))).toEqual(placement)
  })

  it('the search is a DEV helper: nothing in the productive contract imports it', () => {
    const sources = import.meta.glob<string>('./*.ts', { query: '?raw', import: 'default', eager: true })
    const productive = [
      './stationPlacement.ts', './stationDefinition.ts', './stationFootprint.ts',
      './stationInstance.ts', './stationProcess.ts', './stationSerialization.ts', './stationVisualState.ts',
    ]
    // Comments name the dev module on purpose, to say it is not imported.
    const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    for (const path of productive) {
      expect(sources[path], path).toBeDefined()
      expect(code(sources[path]), path).not.toMatch(/devStationPlacement/)
    }
    // The dev module itself is the only place the spiral lives.
    expect(sources['./devStationPlacement.ts']).toMatch(/devFindStationSpot/)
  })

  it('and validation does not depend on the search either: it answers about a tile it was given', () => {
    const anchor = devFindStationSpot(openWorld(), FURNACE.footprint, { tx: 0, ty: 0 })!
    const declared = stationPlacement('f', 'smelter', AREA, { tx: 40, ty: -12 })
    // A tile nobody searched for validates the same way.
    expect(validatePlacement(openWorld(), FURNACE.footprint, declared.anchor).ok).toBe(true)
    expect(validatePlacement(openWorld(), FURNACE.footprint, anchor).ok).toBe(true)
  })
})
