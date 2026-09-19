// Stations as stored data (R33).
//
// R33 persists nothing — no Supabase, no localStorage, no server. What it does
// owe R36 is a record that *can* be stored without being rewritten: primitives
// only, an explicit version, and a reader that refuses what it does not
// understand instead of guessing.
//
// So the test that matters is the round trip: a station serialised and read
// back is the same station, including a process that is halfway through. The
// clock is not part of it — `startedAtMs` is a reading, and the remaining time
// is derived from it whenever someone asks (`remainingMs`), which is exactly
// why a reload mid-process lands in the right place.
//
// Parsing is fail-closed, the same posture as `domain/hostileInputs.test.ts`:
// anything unrecognised returns null. A stored process from a future version
// is not "probably fine".

import { STATION_TYPE_IDS, type StationTypeId } from './stationDefinition'
import { placeStation, type PlacedStation } from './stationInstance'
import { STATION_PROCESS_VERSION, type StationProcessPhase, type StationProcessState } from './stationProcess'
import type { ItemStack } from '../domain/types'

/** The on-the-wire shape. Identical to the in-memory one: there is nothing to translate. */
export type SerializedStation = PlacedStation

export const serializeStation = (station: PlacedStation): SerializedStation => station

const PHASES: readonly StationProcessPhase[] = ['ready', 'working', 'done']

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0

const isWhole = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value)

function parseStacks(value: unknown): readonly ItemStack[] | null {
  if (!Array.isArray(value)) return null
  const out: ItemStack[] = []
  for (const entry of value) {
    if (!isRecord(entry) || !isId(entry.itemId) || !isWhole(entry.quantity) || entry.quantity <= 0) return null
    out.push({ itemId: entry.itemId, quantity: entry.quantity })
  }
  return out
}

function parseProcess(value: unknown): StationProcessState | null {
  if (!isRecord(value)) return null
  if (value.version !== STATION_PROCESS_VERSION) return null
  if (!isId(value.processId) || !isId(value.recipeId) || !isId(value.profession)) return null
  if (!isWhole(value.quantity) || value.quantity < 1) return null
  if (typeof value.phase !== 'string' || !PHASES.includes(value.phase as StationProcessPhase)) return null
  if (!isWhole(value.durationMs) || value.durationMs < 0) return null
  if (typeof value.xpAward !== 'number' || !Number.isFinite(value.xpAward) || value.xpAward < 0) return null

  const committed = parseStacks(value.committed)
  const output = parseStacks(value.output)
  if (!committed || !output) return null

  const phase = value.phase as StationProcessPhase
  const startedAtMs = value.startedAtMs
  // A started process must say when, and one that has not started must not.
  if (phase === 'ready' ? startedAtMs !== null : !(typeof startedAtMs === 'number' && Number.isFinite(startedAtMs))) return null

  const worker = value.workerInstanceId
  if (worker !== null && !isId(worker)) return null

  return {
    version: STATION_PROCESS_VERSION,
    processId: value.processId,
    recipeId: value.recipeId,
    profession: value.profession as StationProcessState['profession'],
    quantity: value.quantity,
    phase,
    committed,
    output,
    xpAward: value.xpAward,
    durationMs: value.durationMs,
    startedAtMs: phase === 'ready' ? null : (startedAtMs as number),
    workerInstanceId: worker,
  }
}

/** Reads a stored station, or null when anything about it is unrecognised. */
export function parseStation(value: unknown): PlacedStation | null {
  if (!isRecord(value)) return null
  if (!isId(value.stationId) || !isId(value.areaId)) return null
  if (typeof value.stationType !== 'string' || !STATION_TYPE_IDS.includes(value.stationType as StationTypeId)) return null
  if (!isRecord(value.anchor) || !isWhole(value.anchor.tx) || !isWhole(value.anchor.ty)) return null
  const ownerId = value.ownerId
  if (ownerId !== null && ownerId !== undefined && !isId(ownerId)) return null

  const station = placeStation(
    value.stationId, value.stationType as StationTypeId, value.areaId,
    { tx: value.anchor.tx, ty: value.anchor.ty }, isId(ownerId) ? ownerId : null,
  )
  if (value.process === null || value.process === undefined) return station

  const process = parseProcess(value.process)
  return process ? { ...station, process } : null
}

/** Convenience for the round trip the tests and a future store both do. */
export const stationRoundTrip = (station: PlacedStation): PlacedStation | null =>
  parseStation(JSON.parse(JSON.stringify(serializeStation(station))))
