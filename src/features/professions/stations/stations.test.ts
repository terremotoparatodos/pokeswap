// R33 — station definitions, footprints, the process state machine, the
// inventory transaction, time, serialization and the visual mapping.
//
// Everything here is pure: no engine, no Vue, no canvas, no clock. Time is a
// number the test passes in, which is the whole point of §15 — a six-second
// smelt is asserted in microseconds and a reload mid-process is a value, not a
// race.

import { describe, expect, it } from 'vitest'
import { RECIPE_BY_ID } from '../domain/catalog/recipes'
import { ITEM_BY_ID } from '../domain/catalog/items'
import { PUBLIC_STATION_TIME_MULTIPLIER } from '../domain/catalog/tools'
import type { Inventory } from '../domain/types'
import { STATION_STATES } from '../art/stationVisuals'
import {
  recipesForStation, STATION_BY_ID, STATION_DEFINITIONS, STATION_TYPE_IDS, stationSupportsRecipe,
} from './stationDefinition'
import {
  footprintCovers, footprintFeet, footprintRing, footprintTiles, maskFootprint, rectFootprint,
} from './stationFootprint'
import {
  advanceStation, canInteractFrom, placeStation, stationApproaches, stationCovers, stationState, stationTiles, withProcess,
} from './stationInstance'
import {
  advanceProcess, cancelProcess, collectProcess, prepareProcess, processProgress, remainingMs, startProcess,
  type StationProcessState,
} from './stationProcess'
import { parseStation, stationRoundTrip } from './stationSerialization'
import { stationVisualState } from './stationVisualState'
import { findStationSpot, stationPlacedObject, validatePlacement, type StationWorldPort } from './stationPlacement'

const FURNACE = STATION_BY_ID.get('smelter')!
const AREA = 'pradera'

/** The first vertical slice: 2 iron ore + 1 coal → 1 iron ingot, level 12. */
const SMELT_IRON = 'smelt_iron'

const furnace = () => placeStation('furnace-1', 'smelter', AREA, { tx: 4, ty: 6 })

const stock: Inventory = { iron_ore: 6, coal: 4, gold_ore: 4 }

function prepared(inventory: Inventory = stock, quantity = 1, recipeId = SMELT_IRON) {
  const result = prepareProcess({
    process: null, definition: FURNACE, recipeId, quantity, inventory,
    professionLevel: 16, processId: 'process-1',
  })
  if (!result.ok) throw new Error(`prepare failed: ${result.error.code}`)
  return result
}

// ── Definitions ─────────────────────────────────────────────────────────────

describe('station definitions', () => {
  it('have unique ids, and one per station kind the recipes already use', () => {
    const ids = STATION_DEFINITIONS.map(definition => definition.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids].sort()).toEqual([...STATION_TYPE_IDS].sort())
  })

  it('name a structure item that exists in the catalog', () => {
    for (const definition of STATION_DEFINITIONS) {
      expect(ITEM_BY_ID.get(definition.structureItemId)?.kind, definition.id).toBe('structure')
    }
  })

  it('declare all four visual states and an art box with a real size', () => {
    for (const definition of STATION_DEFINITIONS) {
      expect([...definition.visualStates].sort(), definition.id).toEqual([...STATION_STATES].sort())
      expect(definition.art.width, definition.id).toBeGreaterThan(0)
      expect(definition.art.height, definition.id).toBeGreaterThan(0)
      expect(definition.art.anchorX, definition.id).toBeLessThanOrEqual(definition.art.width)
      expect(definition.art.anchorY, definition.id).toBeLessThanOrEqual(definition.art.height)
    }
  })

  it('declare a footprint of at least one tile that includes its own anchor', () => {
    for (const definition of STATION_DEFINITIONS) {
      expect(definition.footprint.cells.length, definition.id).toBeGreaterThan(0)
      expect(definition.footprint.cells, definition.id).toContainEqual({ dx: 0, dy: 0 })
    }
  })

  it('the furnace is the only one R33 makes productive besides the existing bench', () => {
    expect(STATION_DEFINITIONS.filter(definition => definition.productive).map(definition => definition.id).sort())
      .toEqual(['alchemyTable', 'smelter'])
  })

  it('the furnace stands on 2×2 tiles', () => {
    expect(FURNACE.footprint.width).toBe(2)
    expect(FURNACE.footprint.depth).toBe(2)
  })

  it('read their recipes from the one recipe catalog, never a copy', () => {
    const ids = recipesForStation('smelter').map(recipe => recipe.id)
    expect(ids).toContain('smelt_iron')
    expect(ids).toContain('smelt_gold')
    for (const id of ids) expect(RECIPE_BY_ID.get(id)?.station).toBe('smelter')
    expect(stationSupportsRecipe('smelter', 'smelt_iron')).toBe(true)
    expect(stationSupportsRecipe('smelter', 'brew_potion')).toBe(false)
  })

  it('and the two furnace recipes are raw ore → ingot, with the ids the catalog already has', () => {
    const iron = RECIPE_BY_ID.get('smelt_iron')!
    const gold = RECIPE_BY_ID.get('smelt_gold')!
    expect(iron.inputs.map(stack => stack.itemId)).toContain('iron_ore')
    expect(iron.outputs).toEqual([{ itemId: 'iron_ingot', quantity: 1 }])
    expect(gold.outputs).toEqual([{ itemId: 'gold_ingot', quantity: 1 }])
  })
})

// ── Footprints ──────────────────────────────────────────────────────────────

describe('footprints', () => {
  it('a 1×1 footprint is one cell and four approach tiles: the legacy shape, unchanged', () => {
    const single = rectFootprint(1, 1)
    expect(footprintTiles(single, { tx: 3, ty: 3 })).toEqual([{ tx: 3, ty: 3 }])
    expect(footprintRing(single, { tx: 3, ty: 3 })).toHaveLength(4)
    expect(footprintFeet(single, { tx: 3, ty: 3 })).toEqual({ x: 3.5, y: 3 })
  })

  it('a 2×2 footprint covers four tiles, growing north from its anchor', () => {
    const tiles = footprintTiles(FURNACE.footprint, { tx: 4, ty: 6 }).map(tile => `${tile.tx},${tile.ty}`)
    expect([...tiles].sort()).toEqual(['4,5', '4,6', '5,5', '5,6'])
  })

  it('and its art stands between its two front tiles', () => {
    expect(footprintFeet(FURNACE.footprint, { tx: 4, ty: 6 })).toEqual({ x: 5, y: 6 })
  })

  it('a mask makes a shape no rectangle can, front row last', () => {
    const cross = maskFootprint([' # ', '###', ' # '])
    expect(cross.width).toBe(3)
    expect(cross.depth).toBe(3)
    // Anchored on its single front cell; the middle row reaches one tile west.
    expect(footprintCovers(cross, { tx: 0, ty: 0 }, 0, 0)).toBe(true)
    expect(footprintCovers(cross, { tx: 0, ty: 0 }, -1, -1)).toBe(true)
    expect(footprintCovers(cross, { tx: 0, ty: 0 }, 1, 0)).toBe(false)
  })

  it('refuses a shape that stands on nothing at the front, instead of silently moving it', () => {
    expect(() => maskFootprint(['##', '  '])).toThrow(/front row/)
    expect(() => maskFootprint([])).toThrow(/at least one cell/)
    expect(() => rectFootprint(0, 2)).toThrow(/above zero/)
  })

  it('the approach ring never includes a tile the station stands on', () => {
    const ring = footprintRing(FURNACE.footprint, { tx: 4, ty: 6 })
    const inside = footprintTiles(FURNACE.footprint, { tx: 4, ty: 6 }).map(tile => `${tile.tx},${tile.ty}`)
    expect(ring).toHaveLength(8)
    for (const tile of ring) expect(inside).not.toContain(`${tile.tx},${tile.ty}`)
  })

  it('a station is usable from every tile of its ring and from none of its own', () => {
    const station = furnace()
    for (const tile of stationApproaches(station)) expect(canInteractFrom(station, tile.tx, tile.ty)).toBe(true)
    for (const tile of stationTiles(station)) expect(canInteractFrom(station, tile.tx, tile.ty)).toBe(false)
    // Diagonal and two tiles out are not adjacent.
    expect(canInteractFrom(station, 6, 7)).toBe(false)
    expect(canInteractFrom(station, 7, 6)).toBe(false)
  })

  it('and it answers for every tile it covers, not only its anchor', () => {
    const station = furnace()
    for (const tile of stationTiles(station)) expect(stationCovers(station, AREA, tile.tx, tile.ty)).toBe(true)
    expect(stationCovers(station, 'otra-area', 4, 6)).toBe(false)
    expect(stationCovers(station, AREA, 6, 6)).toBe(false)
  })
})

// ── Placement validation ────────────────────────────────────────────────────

describe('placement', () => {
  const openWorld = (overrides: Partial<StationWorldPort> = {}): StationWorldPort => ({
    isSolid: () => false, isWater: () => false, hasNode: () => false, ...overrides,
  })

  it('accepts a clear 2×2 spot and reports the tiles it takes', () => {
    const check = validatePlacement(openWorld(), FURNACE.footprint, { tx: 0, ty: 0 })
    expect(check.ok).toBe(true)
    expect(check.ok && check.tiles).toHaveLength(4)
  })

  it('refuses when any tile of the footprint is bad, not only the anchor', () => {
    // The anchor is fine; the tile behind it is a rock.
    const port = openWorld({ isSolid: (_tx, ty) => ty === -1 })
    const check = validatePlacement(port, FURNACE.footprint, { tx: 0, ty: 0 })
    expect(check.ok).toBe(false)
    expect(!check.ok && check.failure).toEqual({ reason: 'solid_tile', tile: { tx: 0, ty: -1 } })
  })

  it('names the reason: water, a gathering node, something already placed, a door, or out of bounds', () => {
    const reasons = [
      ['water', openWorld({ isWater: () => true })],
      ['node_tile', openWorld({ hasNode: () => true })],
      ['occupied', openWorld({ isOccupied: () => true })],
      ['transition', openWorld({ isTransition: () => true })],
      ['out_of_bounds', openWorld({ outOfBounds: () => true })],
    ] as const
    for (const [reason, port] of reasons) {
      const check = validatePlacement(port, FURNACE.footprint, { tx: 0, ty: 0 })
      expect(!check.ok && check.failure.reason, reason).toBe(reason)
    }
  })

  it('finds a deterministic spot, the same one every time', () => {
    const port = openWorld()
    const a = findStationSpot(port, FURNACE.footprint, { tx: 0, ty: 0 })
    const b = findStationSpot(port, FURNACE.footprint, { tx: 0, ty: 0 })
    expect(a).not.toBeNull()
    expect(a).toEqual(b)
  })

  it('and returns null rather than forcing a station into a crowded area', () => {
    expect(findStationSpot(openWorld({ isSolid: () => true }), FURNACE.footprint, { tx: 0, ty: 0 })).toBeNull()
  })

  it('declares itself to F-1 with its own cells and its art size as the hitbox', () => {
    const spec = stationPlacedObject(furnace())
    expect(spec.kind).toBe('smelter')
    expect(spec.cells).toHaveLength(4)
    // The art is the tap reach; it is not the footprint, and may overhang it.
    expect(spec.hitbox).toEqual({ width: FURNACE.art.width, height: FURNACE.art.height })
  })
})

// ── The process state machine ───────────────────────────────────────────────

describe('the process state machine', () => {
  it('IDLE → READY commits the inputs and leaves the station holding them', () => {
    const result = prepared()
    expect(result.process.phase).toBe('ready')
    expect(result.committed).toEqual([{ itemId: 'iron_ore', quantity: 2 }, { itemId: 'coal', quantity: 1 }])
    expect(result.inventory).toEqual({ iron_ore: 4, coal: 3, gold_ore: 4 })
    expect(result.process.output).toEqual([{ itemId: 'iron_ingot', quantity: 1 }])
  })

  it('READY → WORKING records when it started', () => {
    const started = startProcess(prepared().process, 1_000)
    expect(started.ok && started.process.phase).toBe('working')
    expect(started.ok && started.process.startedAtMs).toBe(1_000)
  })

  it('WORKING does not finish one millisecond early, and does finish exactly on time', () => {
    const process = (startProcess(prepared().process, 1_000) as { process: StationProcessState }).process
    const endsAt = 1_000 + process.durationMs
    expect(advanceProcess(process, endsAt - 1)!.phase).toBe('working')
    expect(advanceProcess(process, endsAt)!.phase).toBe('done')
    expect(advanceProcess(process, endsAt + 60_000)!.phase).toBe('done')
  })

  it('DONE stays DONE, and advancing again never changes the output', () => {
    const process = (startProcess(prepared().process, 0) as { process: StationProcessState }).process
    const done = advanceProcess(process, process.durationMs)!
    const again = advanceProcess(advanceProcess(done, 1e9), 2e9)!
    expect(again.phase).toBe('done')
    expect(again.output).toEqual(done.output)
  })

  it('collect credits the output once and empties the station back to IDLE', () => {
    const start = prepared()
    const done = advanceProcess(
      (startProcess(start.process, 0) as { process: StationProcessState }).process, 10_000,
    )!
    const collected = collectProcess(done, start.inventory)
    expect(collected.ok).toBe(true)
    expect(collected.ok && collected.process).toBeNull()
    expect(collected.ok && collected.inventory.iron_ingot).toBe(1)
    expect(collected.ok && collected.xp).toBeGreaterThan(0)
  })

  describe('invalid transitions are refused, with a reason and the phase it was really in', () => {
    it('preparing a busy station', () => {
      const result = prepareProcess({
        process: prepared().process, definition: FURNACE, recipeId: SMELT_IRON, quantity: 1,
        inventory: stock, professionLevel: 16, processId: 'process-2',
      })
      expect(result.ok).toBe(false)
      expect(!result.ok && result.error).toEqual({ code: 'station_busy', phase: 'ready' })
    })

    it('a recipe this station cannot run, and one that does not exist', () => {
      const base = { process: null, definition: FURNACE, quantity: 1, inventory: stock, professionLevel: 99, processId: 'p' }
      expect(prepareProcess({ ...base, recipeId: 'brew_potion' })).toMatchObject({ error: { code: 'recipe_not_supported' } })
      expect(prepareProcess({ ...base, recipeId: 'no_such_recipe' })).toMatchObject({ error: { code: 'unknown_recipe' } })
    })

    it('a level too low, a bad quantity and missing inputs, before anything is spent', () => {
      const base = { process: null, definition: FURNACE, recipeId: SMELT_IRON, inventory: stock, processId: 'p' }
      expect(prepareProcess({ ...base, quantity: 1, professionLevel: 3 })).toMatchObject({ error: { code: 'level_too_low' } })
      expect(prepareProcess({ ...base, quantity: 0, professionLevel: 16 })).toMatchObject({ error: { code: 'invalid_quantity' } })
      expect(prepareProcess({ ...base, quantity: 1.5, professionLevel: 16 })).toMatchObject({ error: { code: 'invalid_quantity' } })
      expect(prepareProcess({ ...base, quantity: 99, professionLevel: 16 })).toMatchObject({ error: { code: 'missing_inputs' } })
      expect(prepareProcess({ ...base, quantity: 1, professionLevel: 16, inventory: {} })).toMatchObject({ error: { code: 'missing_inputs' } })
    })

    it('a process with no identity', () => {
      expect(prepareProcess({
        process: null, definition: FURNACE, recipeId: SMELT_IRON, quantity: 1, inventory: stock,
        professionLevel: 16, processId: '',
      })).toMatchObject({ error: { code: 'invalid_process_id' } })
    })

    it('starting nothing, starting twice, and starting something already done', () => {
      expect(startProcess(null, 0)).toMatchObject({ error: { code: 'no_process', phase: 'idle' } })
      const working = (startProcess(prepared().process, 0) as { process: StationProcessState }).process
      expect(startProcess(working, 5)).toMatchObject({ error: { code: 'already_started', phase: 'working' } })
      const done = advanceProcess(working, 1e9)!
      expect(startProcess(done, 5)).toMatchObject({ error: { code: 'not_ready', phase: 'done' } })
    })

    it('collecting before it is done, and collecting an empty station', () => {
      const ready = prepared().process
      expect(collectProcess(ready, {})).toMatchObject({ error: { code: 'not_done', phase: 'ready' } })
      const working = (startProcess(ready, 0) as { process: StationProcessState }).process
      expect(collectProcess(working, {})).toMatchObject({ error: { code: 'not_done', phase: 'working' } })
      expect(collectProcess(null, {})).toMatchObject({ error: { code: 'no_process', phase: 'idle' } })
    })
  })
})

// ── The inventory transaction ───────────────────────────────────────────────

describe('the inventory transaction', () => {
  it('the inputs are taken exactly once, when the process becomes READY', () => {
    const before: Inventory = { iron_ore: 2, coal: 1 }
    const result = prepared(before)
    expect(result.inventory).toEqual({ iron_ore: 0, coal: 0 })
    // And a second job cannot spend the same ore.
    const second = prepareProcess({
      process: null, definition: FURNACE, recipeId: SMELT_IRON, quantity: 1,
      inventory: result.inventory, professionLevel: 16, processId: 'process-2',
    })
    expect(second).toMatchObject({ error: { code: 'missing_inputs' } })
  })

  it('a refused prepare spends nothing at all', () => {
    const before: Inventory = { iron_ore: 1, coal: 1 }
    const result = prepareProcess({
      process: null, definition: FURNACE, recipeId: SMELT_IRON, quantity: 1,
      inventory: before, professionLevel: 16, processId: 'p',
    })
    expect(result.ok).toBe(false)
    expect(before).toEqual({ iron_ore: 1, coal: 1 })
  })

  it('completing many times never produces more than once', () => {
    const start = prepared({ iron_ore: 2, coal: 1 })
    let process = (startProcess(start.process, 0) as { process: StationProcessState }).process
    for (let i = 0; i < 50; i++) process = advanceProcess(process, 1e9)!
    const collected = collectProcess(process, start.inventory)
    expect(collected.ok && collected.inventory).toEqual({ iron_ore: 0, coal: 0, iron_ingot: 1 })
  })

  it('a second collect is refused, so the output cannot be credited twice', () => {
    const start = prepared({ iron_ore: 2, coal: 1 })
    const done = advanceProcess((startProcess(start.process, 0) as { process: StationProcessState }).process, 1e9)!
    const first = collectProcess(done, start.inventory)
    expect(first.ok).toBe(true)
    const second = collectProcess(first.ok ? first.process : null, first.ok ? first.inventory : {})
    expect(second).toMatchObject({ error: { code: 'no_process', phase: 'idle' } })
    expect(first.ok && first.inventory.iron_ingot).toBe(1)
  })

  it('cancelling a READY process gives the committed inputs back, exactly', () => {
    const before: Inventory = { iron_ore: 2, coal: 1 }
    const start = prepared(before)
    const cancelled = cancelProcess(start.process, start.inventory)
    expect(cancelled.ok).toBe(true)
    expect(cancelled.ok && cancelled.inventory).toEqual(before)
    expect(cancelled.ok && cancelled.process).toBeNull()
  })

  it('and a WORKING process cannot be cancelled: R33 decides nothing about refunds', () => {
    const working = (startProcess(prepared().process, 0) as { process: StationProcessState }).process
    expect(cancelProcess(working, {})).toMatchObject({ error: { code: 'not_ready', phase: 'working' } })
    const done = advanceProcess(working, 1e9)!
    expect(cancelProcess(done, {})).toMatchObject({ error: { code: 'not_ready', phase: 'done' } })
  })
})

// ── Time ────────────────────────────────────────────────────────────────────

describe('time is a parameter, never a clock this module reads', () => {
  it('a READY process reports its whole duration as remaining', () => {
    const process = prepared().process
    expect(remainingMs(process, 999_999)).toBe(process.durationMs)
    expect(processProgress(process, 999_999)).toBe(0)
  })

  it('remaining time counts down from the reading the process started at', () => {
    const process = (startProcess(prepared().process, 5_000) as { process: StationProcessState }).process
    expect(remainingMs(process, 5_000)).toBe(process.durationMs)
    expect(remainingMs(process, 5_000 + process.durationMs / 2)).toBe(process.durationMs / 2)
    expect(remainingMs(process, 5_000 + process.durationMs)).toBe(0)
    expect(remainingMs(process, 1e9)).toBe(0)
  })

  it('a reload mid-process lands in the right place: only two numbers are needed', () => {
    const process = (startProcess(prepared().process, 10_000) as { process: StationProcessState }).process
    const half = 10_000 + process.durationMs / 2
    // Nothing kept a timer alive; the record is serialised and read back cold.
    const reloaded = parseStation({ ...furnace(), process: JSON.parse(JSON.stringify(process)) })!
    expect(remainingMs(reloaded.process, half)).toBe(process.durationMs / 2)
    expect(stationState(reloaded)).toBe('working')
    // And it finishes on the same reading it would have finished on.
    expect(stationState(advanceStation(reloaded, 10_000 + process.durationMs))).toBe('done')
  })

  it('the duration comes from the catalog recipe, through the same resolver processing already used', () => {
    // 6 s in the catalog, × 1.5 because R33 has no ownership model yet and so
    // every station is the slower public one (`PUBLIC_STATION_TIME_MULTIPLIER`).
    // Both numbers are PLAYTEST / FOUNDATION values; R33 balances nothing.
    const recipe = RECIPE_BY_ID.get(SMELT_IRON)!
    expect(recipe.baseSeconds).toBe(6)
    expect(prepared().process.durationMs).toBe(recipe.baseSeconds * PUBLIC_STATION_TIME_MULTIPLIER * 1000)
  })

  it('a clock that answers nonsense never finishes a process early', () => {
    const process = (startProcess(prepared().process, 0) as { process: StationProcessState }).process
    expect(remainingMs(process, Number.NaN)).toBe(process.durationMs)
    expect(advanceProcess(process, Number.NaN)!.phase).toBe('working')
    expect(startProcess(prepared().process, Number.NaN).ok).toBe(false)
  })

  it('and no module in this folder reads a clock or rolls unseeded dice', async () => {
    const sources = import.meta.glob<string>('./*.ts', { query: '?raw', import: 'default', eager: true })
    // Comments name these on purpose, to say why they are absent; strip them.
    const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    for (const [path, source] of Object.entries(sources)) {
      if (path.endsWith('.test.ts')) continue
      expect(code(source), path).not.toMatch(/Date\.now|new Date|setTimeout|setInterval|Math\.random|performance\.now/)
    }
  })
})

// ── Serialization ───────────────────────────────────────────────────────────

describe('serialization', () => {
  it('an idle station survives a JSON round trip unchanged', () => {
    const station = furnace()
    expect(stationRoundTrip(station)).toEqual(station)
  })

  it('so does one halfway through a process', () => {
    const start = prepared()
    const working = withProcess(furnace(), (startProcess(start.process, 7_777) as { process: StationProcessState }).process)
    expect(stationRoundTrip(working)).toEqual(working)
  })

  it('and a finished one waiting to be collected', () => {
    const start = prepared()
    const done = withProcess(furnace(), advanceProcess((startProcess(start.process, 0) as { process: StationProcessState }).process, 1e9))
    expect(stationRoundTrip(done)).toEqual(done)
  })

  it('refuses what it does not understand instead of guessing', () => {
    const station = furnace()
    const process = (startProcess(prepared().process, 0) as { process: StationProcessState }).process
    expect(parseStation(null)).toBeNull()
    expect(parseStation({ ...station, stationType: 'teleporter' })).toBeNull()
    expect(parseStation({ ...station, anchor: { tx: 1.5, ty: 2 } })).toBeNull()
    expect(parseStation({ ...station, process: { ...process, version: 99 } })).toBeNull()
    expect(parseStation({ ...station, process: { ...process, phase: 'melting' } })).toBeNull()
    expect(parseStation({ ...station, process: { ...process, output: [{ itemId: 'iron_ingot', quantity: -1 }] } })).toBeNull()
    // A started process must say when, and a READY one must not.
    expect(parseStation({ ...station, process: { ...process, startedAtMs: null } })).toBeNull()
    expect(parseStation({ ...station, process: { ...prepared().process, startedAtMs: 5 } })).toBeNull()
  })

  it('every field of a process is a primitive, an array or null', () => {
    const process = (startProcess(prepared().process, 3) as { process: StationProcessState }).process
    for (const [field, value] of Object.entries(process)) {
      if (Array.isArray(value)) continue
      expect(['string', 'number', 'object'], field).toContain(typeof value)
      if (typeof value === 'object') expect(value, field).toBeNull()
    }
  })
})

// ── Visual state ────────────────────────────────────────────────────────────

describe('the visual mapping', () => {
  it('walks the furnace through all four approved states, in order', () => {
    let station = furnace()
    expect(stationVisualState(station)).toBe('idle')

    const start = prepared()
    station = withProcess(station, start.process)
    expect(stationVisualState(station)).toBe('ready')

    station = withProcess(station, (startProcess(station.process, 0) as { process: StationProcessState }).process)
    expect(stationVisualState(station)).toBe('working')

    station = advanceStation(station, 1e9)
    expect(stationVisualState(station)).toBe('done')

    const collected = collectProcess(station.process, start.inventory)
    station = withProcess(station, collected.ok ? collected.process : station.process)
    expect(stationVisualState(station)).toBe('idle')
  })

  it('is not hover state: a ready station stays ready with an empty inventory', () => {
    const station = withProcess(furnace(), prepared().process)
    // Nothing about the mapping reads an inventory at all — the process holds
    // its own inputs, so the picture is the world's, not the player's.
    expect(stationVisualState(station)).toBe('ready')
  })

  it('and every state it can reach is one the art draws', () => {
    for (const state of STATION_STATES) expect(FURNACE.visualStates).toContain(state)
  })
})
