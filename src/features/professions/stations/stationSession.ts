// The station process against the prototype's bag (R33).
//
// `stationProcess.ts` speaks in `Inventory` — counts by item id — because that
// is what `resolveProcessing` has always taken and what a server table would
// hold. The prototype's player carries a slot bag instead, with stack limits
// and overflow. This module is the adapter between the two, and nothing more:
// every decision is still made by the pure process functions, and this only
// moves the items and the XP.
//
// It is the same shape `craftDemo` already has, split in two, because a
// station spends its inputs at one moment and pays out at another.
//
// Like the rest of the demo session: local memory only. No persistence, no
// server, no authority — the boundary is written down in
// `docs/economy/R33_STATIONS_PRODUCT.md` §9.

import { demoCounts, demoLevel, demoRules, type DemoState } from '../demo/demoSession'
import { addStacks, removeStacks } from '../inventory/slotInventory'
import { levelForXp } from '../domain/progression'
import { RECIPE_BY_ID } from '../domain/catalog/recipes'
import type { ItemStack } from '../domain/types'
import {
  cancelProcess, collectProcess, prepareProcess, startProcess,
  type StationProcessError, type StationProcessState,
} from './stationProcess'
import { advanceStation, definitionOf, withProcess, type PlacedStation } from './stationInstance'

export interface StationActionFailure {
  readonly ok: false
  readonly state: DemoState
  readonly station: PlacedStation
  readonly error: StationProcessError | { readonly code: 'inventory_full' | 'unknown_station' }
}

export interface PrepareOutcome {
  readonly ok: true
  readonly state: DemoState
  readonly station: PlacedStation
  readonly committed: readonly ItemStack[]
}

export interface StartOutcome {
  readonly ok: true
  readonly state: DemoState
  readonly station: PlacedStation
  readonly process: StationProcessState
}

export interface CollectOutcome {
  readonly ok: true
  readonly state: DemoState
  readonly station: PlacedStation
  readonly credited: readonly ItemStack[]
  readonly xp: number
  readonly leveledUp: boolean
}

export interface CancelOutcome {
  readonly ok: true
  readonly state: DemoState
  readonly station: PlacedStation
  readonly refunded: readonly ItemStack[]
}

const fail = (
  state: DemoState, station: PlacedStation, error: StationActionFailure['error'],
): StationActionFailure => ({ ok: false, state, station, error })

/**
 * IDLE → READY. The inputs leave the bag here, once, and the process owns them
 * from this point on.
 *
 * `processId` is the caller's, never generated here (§35): the prototype uses
 * the station id and a counter, and a server would use its own.
 */
export function prepareStation(
  state: DemoState, station: PlacedStation, recipeId: string, quantity: number, processId: string,
): PrepareOutcome | StationActionFailure {
  const definition = definitionOf(station)
  if (!definition) return fail(state, station, { code: 'unknown_station' })

  const result = prepareProcess({
    process: station.process, definition, recipeId, quantity,
    inventory: demoCounts(state),
    professionLevel: demoLevel(state, RECIPE_BY_ID.get(recipeId)?.profession ?? 'mining'),
    processId,
  })
  if (!result.ok) return fail(state, station, result.error)

  // The pure call already proved the counts are there; the bag has to agree.
  const bag = removeStacks(state.bag, result.committed)
  if (!bag) return fail(state, station, { code: 'missing_inputs' })

  return {
    ok: true,
    state: { ...state, bag },
    station: withProcess(station, result.process),
    committed: result.committed,
  }
}

/** READY → WORKING, at the reading the caller gives. Nothing else changes. */
export function startStation(state: DemoState, station: PlacedStation, nowMs: number): StartOutcome | StationActionFailure {
  const result = startProcess(station.process, nowMs)
  if (!result.ok) return fail(state, station, result.error)
  return { ok: true, state, station: withProcess(station, result.process), process: result.process }
}

/** Moves a working station to DONE when its time is up. Idempotent. */
export const tickStation = (station: PlacedStation, nowMs: number): PlacedStation => advanceStation(station, nowMs)

/**
 * DONE → IDLE. The output is credited once and the XP with it.
 *
 * A full bag refuses the collect and leaves the station DONE, so the output is
 * never lost — the same posture as the gathering pending list.
 */
export function collectStation(state: DemoState, station: PlacedStation): CollectOutcome | StationActionFailure {
  const result = collectProcess(station.process, demoCounts(state))
  if (!result.ok) return fail(state, station, result.error)

  const added = addStacks(state.bag, result.credited, demoRules(state))
  if (added.overflow.length) return fail(state, station, { code: 'inventory_full' })

  const xp = state.xp[result.profession] + result.xp
  const next: DemoState = { ...state, bag: added.container, xp: { ...state.xp, [result.profession]: xp } }
  return {
    ok: true,
    state: next,
    station: withProcess(station, null),
    credited: result.credited,
    xp: result.xp,
    leveledUp: levelForXp(xp) > levelForXp(state.xp[result.profession]),
  }
}

/** READY → IDLE, putting the committed inputs back in the bag. */
export function cancelStation(state: DemoState, station: PlacedStation): CancelOutcome | StationActionFailure {
  const result = cancelProcess(station.process, demoCounts(state))
  if (!result.ok) return fail(state, station, result.error)

  const added = addStacks(state.bag, result.refunded, demoRules(state))
  if (added.overflow.length) return fail(state, station, { code: 'inventory_full' })

  return { ok: true, state: { ...state, bag: added.container }, station: withProcess(station, null), refunded: result.refunded }
}
