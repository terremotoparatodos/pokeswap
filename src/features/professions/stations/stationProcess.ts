// One station's work, as an explicit state machine (R33).
//
// R31 already had processing: `resolveProcessing` turns a recipe plus an
// inventory into "this was consumed, this was produced", in one call, with no
// time in it. The Alchemy bench then *animated* that instant result with a
// timeline (`brewTimeline.ts`), which is presentation — reload the page mid-brew
// and nothing was ever happening.
//
// A station is the opposite: the work exists in the world whether or not anyone
// is looking at it. So R33 adds the missing layer — a process record with an
// identity, committed inputs, a duration and a phase — and keeps using
// `resolveProcessing` underneath for what it already does well. There is no
// second processing system.
//
// ── The four states (§11 of the R33 brief) ──────────────────────────────────
//
//   IDLE     no process. `PlacedStation.process === null`.
//   READY    a recipe is prepared, its inputs are **already taken** from the
//            player and held by the process, and it can start.
//   WORKING  started, not finished.
//   DONE     finished; the output is waiting to be collected.
//
// They are world state, not hover state: nothing here reads the player's
// current inventory to decide what a station looks like.
//
// ── Time ────────────────────────────────────────────────────────────────────
//
// There is no `Date.now()` and no `setTimeout` in this module. A caller passes
// `nowMs`, and a process stores when it started and how long it takes, so the
// remaining time is *derived* — which is what makes a reload mid-process
// correct rather than lucky (§37). The clock is a parameter today and becomes
// the server's `AuthorityClock` later without changing this file (§16).
//
// ── Ownership of the inputs ─────────────────────────────────────────────────
//
// Inputs are committed **atomically when the process becomes READY**. The
// alternative — reserving a claim and consuming at start — needs a second
// record to keep the claim honest and a rule for what happens if the inventory
// changes in between. Taking them once, up front, means the process owns them
// outright: two jobs can never spend the same ore, and `cancel` before start
// gives them back. This is a decision, and it is written down in
// `docs/economy/R33_STATIONS_PRODUCT.md` §6.
//
// ── What is decided when ────────────────────────────────────────────────────
//
// The outcome (what is consumed, what is produced, how much XP) is resolved at
// **prepare** time and stored in the process. Collecting reads the record; it
// does not roll anything. So completing twice cannot produce twice, and a
// future server can compute the record once and hand the client a projection of
// it (§16, §39).

import { addItems, removeItems } from '../domain/inventory'
import { resolveProcessing } from '../domain/processing'
import { RECIPE_BY_ID } from '../domain/catalog/recipes'
import type { Inventory, ItemStack, ProfessionId } from '../domain/types'
import type { StationDefinition } from './stationDefinition'
import { stationSupportsRecipe } from './stationDefinition'

/** A process exists in one of three phases; the fourth state, IDLE, is its absence. */
export type StationProcessPhase = 'ready' | 'working' | 'done'

/** The four states a *station* can be in, which is what the art draws. */
export type StationPhase = 'idle' | StationProcessPhase

/** Bumped when the shape changes; a stored process from an older version is rejected, never guessed at. */
export const STATION_PROCESS_VERSION = 1

/**
 * The work one station is doing. JSON-safe on purpose: every field is a
 * string, a number, null or an array of `{ itemId, quantity }`. No class, no
 * `Date`, no function — so `JSON.parse(JSON.stringify(process))` is the same
 * process, and a server table can hold it as it stands.
 */
export interface StationProcessState {
  readonly version: number
  /** Stable identity of this run. Injected, never generated here (§35). */
  readonly processId: string
  readonly recipeId: string
  readonly profession: ProfessionId
  readonly quantity: number
  readonly phase: StationProcessPhase
  /** Inputs the process took from the player and now owns. */
  readonly committed: readonly ItemStack[]
  /** What collecting will credit. Decided at prepare, never re-rolled. */
  readonly output: readonly ItemStack[]
  readonly xpAward: number
  readonly durationMs: number
  /** Clock reading when `start` happened; null while READY. */
  readonly startedAtMs: number | null
  /**
   * The Pokémon doing the work, when professions can name one.
   *
   * A hook, deliberately inert in R33: R31's workers are a species id per
   * profession (`demoWorkers.ts`), not a `PokemonInstance`, and migrating them
   * is its own task (`O-1`). Nothing here reads it and no bonus depends on it,
   * so wiring a real instance id later is additive.
   */
  readonly workerInstanceId: string | null
}

export type StationProcessErrorCode =
  | 'unknown_recipe'
  | 'recipe_not_supported'
  | 'station_busy'
  | 'level_too_low'
  | 'missing_inputs'
  | 'invalid_quantity'
  | 'invalid_process_id'
  | 'no_process'
  | 'not_ready'
  | 'not_working'
  | 'not_done'
  | 'already_started'

export interface StationProcessError {
  readonly code: StationProcessErrorCode
  /** The phase the station was actually in, when that is what went wrong. */
  readonly phase?: StationPhase
}

const fail = (code: StationProcessErrorCode, phase?: StationPhase): { ok: false; error: StationProcessError } =>
  ({ ok: false, error: phase ? { code, phase } : { code } })

// ── Reading a process ───────────────────────────────────────────────────────

/** The station's state, with IDLE as the absence of a process. */
export const stationPhase = (process: StationProcessState | null): StationPhase => process?.phase ?? 'idle'

/**
 * Milliseconds left before a WORKING process is finished.
 *
 * Derived from `startedAtMs + durationMs`, so it survives a reload: the truth
 * is two numbers in a record, never a live timer. READY answers with the full
 * duration and DONE with zero.
 */
export function remainingMs(process: StationProcessState | null, nowMs: number): number {
  if (!process) return 0
  if (process.phase === 'done') return 0
  if (process.phase === 'ready' || process.startedAtMs === null) return process.durationMs
  if (!Number.isFinite(nowMs)) return process.durationMs
  return Math.max(0, process.startedAtMs + process.durationMs - nowMs)
}

/** 0..1 of the way through a WORKING process; 0 while READY, 1 once DONE. */
export function processProgress(process: StationProcessState | null, nowMs: number): number {
  if (!process) return 0
  if (process.phase === 'done') return 1
  if (process.durationMs <= 0) return 1
  return Math.max(0, Math.min(1, 1 - remainingMs(process, nowMs) / process.durationMs))
}

// ── Transitions ─────────────────────────────────────────────────────────────

export interface PrepareInput {
  /** The process already on the station, if any. */
  readonly process: StationProcessState | null
  readonly definition: StationDefinition
  readonly recipeId: string
  readonly quantity: number
  /** The player's counts. Returned reduced by what the process takes. */
  readonly inventory: Inventory
  readonly professionLevel: number
  /** Identity of the run, chosen by the caller so tests and a server can fix it (§35). */
  readonly processId: string
  /** Aggregated Pokémon `processing` trait, exactly as `resolveProcessing` takes it. */
  readonly processingBonus?: number
  /** Seeded; the domain never calls `Math.random`. */
  readonly random?: () => number
  readonly workerInstanceId?: string | null
}

export type PrepareResult =
  | {
      readonly ok: true
      readonly process: StationProcessState
      /** The player's inventory with the committed inputs already removed. */
      readonly inventory: Inventory
      readonly committed: readonly ItemStack[]
    }
  | { readonly ok: false; readonly error: StationProcessError }

/**
 * IDLE → READY. Takes the inputs and hands the station a process that owns them.
 *
 * Everything that can be refused is refused here, before anything is spent:
 * an unknown recipe, one this station cannot run, a busy station, a level that
 * is too low, a bad quantity, or inputs the player does not have.
 */
export function prepareProcess(input: PrepareInput): PrepareResult {
  if (input.process) return fail('station_busy', input.process.phase)
  if (typeof input.processId !== 'string' || input.processId.length === 0) return fail('invalid_process_id')

  const recipe = RECIPE_BY_ID.get(input.recipeId)
  if (!recipe) return fail('unknown_recipe')
  if (!stationSupportsRecipe(input.definition.id, recipe.id)) return fail('recipe_not_supported')

  const resolved = resolveProcessing({
    recipe,
    professionLevel: input.professionLevel,
    inventory: input.inventory,
    quantity: input.quantity,
    processingBonus: input.processingBonus ?? 0,
    // R33 has no ownership model yet, so every station is the public one; the
    // owned/public split is `O-10` and is not decided here.
    station: 'public',
    stationSpeedBonus: 0,
    random: input.random ?? (() => 1),
  })
  if (!resolved.ok) return fail(resolved.reason)

  // `resolveProcessing` already proved the inputs are there; `removeItems`
  // returning null would mean the two disagree, and then nothing is spent.
  const inventory = removeItems(input.inventory, resolved.consumed)
  if (!inventory) return fail('missing_inputs')

  return {
    ok: true,
    inventory,
    committed: resolved.consumed,
    process: {
      version: STATION_PROCESS_VERSION,
      processId: input.processId,
      recipeId: recipe.id,
      profession: recipe.profession,
      quantity: input.quantity,
      phase: 'ready',
      committed: resolved.consumed,
      output: resolved.produced,
      xpAward: resolved.xp,
      durationMs: Math.max(0, Math.round(resolved.seconds * 1000)),
      startedAtMs: null,
      workerInstanceId: input.workerInstanceId ?? null,
    },
  }
}

export type ProcessResult =
  | { readonly ok: true; readonly process: StationProcessState }
  | { readonly ok: false; readonly error: StationProcessError }

/** READY → WORKING. Records the clock reading the work started at. */
export function startProcess(process: StationProcessState | null, nowMs: number): ProcessResult {
  if (!process) return fail('no_process', 'idle')
  if (process.phase === 'working') return fail('already_started', 'working')
  if (process.phase !== 'ready') return fail('not_ready', process.phase)
  if (!Number.isFinite(nowMs)) return fail('not_ready', process.phase)
  return { ok: true, process: { ...process, phase: 'working', startedAtMs: nowMs } }
}

/**
 * WORKING → DONE, once the duration has elapsed — and nothing before that.
 *
 * Idempotent and safe to call on every frame, on a reload, or from a server
 * tick: a process that is not finished comes back unchanged, and one already
 * DONE stays DONE with the same output.
 */
export function advanceProcess(process: StationProcessState | null, nowMs: number): StationProcessState | null {
  if (!process || process.phase !== 'working') return process
  if (remainingMs(process, nowMs) > 0) return process
  return { ...process, phase: 'done' }
}

export type CollectResult =
  | {
      readonly ok: true
      /** Always null: collecting empties the station back to IDLE. */
      readonly process: null
      readonly inventory: Inventory
      readonly credited: readonly ItemStack[]
      readonly xp: number
      readonly profession: ProfessionId
    }
  | { readonly ok: false; readonly error: StationProcessError }

/**
 * DONE → IDLE. Credits the stored output once.
 *
 * DONE persists until this is called (§38): nothing hands the output over on
 * its own, which is what keeps the fourth state visible and keeps a finished
 * job from being lost. A second collect finds no process and is refused, so it
 * cannot credit twice.
 */
export function collectProcess(process: StationProcessState | null, inventory: Inventory): CollectResult {
  if (!process) return fail('no_process', 'idle')
  if (process.phase !== 'done') return fail('not_done', process.phase)
  return {
    ok: true,
    process: null,
    inventory: addItems(inventory, process.output),
    credited: process.output,
    xp: process.xpAward,
    profession: process.profession,
  }
}

export type CancelResult =
  | { readonly ok: true; readonly process: null; readonly inventory: Inventory; readonly refunded: readonly ItemStack[] }
  | { readonly ok: false; readonly error: StationProcessError }

/**
 * READY → IDLE, giving the committed inputs back.
 *
 * Only before the work starts. Cancelling a WORKING process is a product
 * question — partial refunds, wasted fuel, a penalty — and R33 answers none of
 * them (§14): it refuses, and says the station was working.
 */
export function cancelProcess(process: StationProcessState | null, inventory: Inventory): CancelResult {
  if (!process) return fail('no_process', 'idle')
  if (process.phase !== 'ready') return fail('not_ready', process.phase)
  return { ok: true, process: null, inventory: addItems(inventory, process.committed), refunded: process.committed }
}
