// The encounter population engine (ECO-2A): nests, groups, limits, respawn.
//
// Pure functions over plain data. Every call takes the time and a random
// source explicitly and returns a NEW state; the input state is never mutated.
// No Date.now, Math.random, timers or I/O.
//
// Guarantees (tested in engine.test.ts):
//   - A tick makes at most ONE spawn attempt per nest, whatever the clock jump:
//     no catch-up loop. A failed attempt reschedules itself `retryMs` later, so
//     evaluating again at the same instant changes nothing.
//     Delay zero remains valid: at most one attempt per nest per instant,
//     and immediate respawn after retirement waits until time advances.
//   - Limits per nest and per area always hold; the engine only places
//     encounters on the nest's own candidate tiles that the geometry calls open
//     and that none of its encounters already occupies. No tile → no spawn.
//   - Encounter ids embed the nest generation, which only grows: an id is never
//     reused within a namespace.
//   - Retiring an encounter that is not alive (twice, unknown, cleared) is a
//     no-op: no second respawn, no reset of a scheduled delay.

import { pickEncounter } from '../encounters/queries'
import { validatePopulationConfig, type PopulationConfigIssue } from './config'
import { encounterIdParts, groupIdOf, nestKey } from './ids'
import type {
  AreaConfig, AreaState, NestConfig, PopulationConfig, PopulationDeps, PopulationEncounter, PopulationEvent,
  PopulationState, PopulationTickInput, RandomSource, RetireInput, RetireResult, SpawnFailure, TickResult, Tile,
} from './types'

interface DraftNest { generation: number; alive: PopulationEncounter[]; dueAt: number | null; spawnBlockedAt?: number }
interface Draft { namespace: string; lastTickAt: number | null; areas: Record<string, AreaState>; nests: Record<string, DraftNest> }

export type CreateResult =
  | { readonly ok: true; readonly state: PopulationState }
  | { readonly ok: false; readonly issues: readonly PopulationConfigIssue[] }

/** A population that has never run: every area dormant, every nest empty at generation 0. */
export function createPopulation(config: PopulationConfig, deps: PopulationDeps): CreateResult {
  const issues = validatePopulationConfig(config, deps.catalog)
  if (issues.length > 0) return { ok: false, issues }
  const areas: Record<string, AreaState> = {}
  const nests: Record<string, DraftNest> = {}
  for (const area of config.areas) {
    areas[area.areaId] = { status: 'dormant', since: null }
    for (const nest of area.nests) nests[nestKey(area.areaId, nest.id)] = { generation: 0, alive: [], dueAt: null }
  }
  return { ok: true, state: { namespace: config.namespace, lastTickAt: null, areas, nests } }
}

function draftOf(state: PopulationState): Draft {
  const nests: Record<string, DraftNest> = {}
  for (const [key, nest] of Object.entries(state.nests)) nests[key] = {
    generation: nest.generation, alive: [...nest.alive], dueAt: nest.dueAt,
    ...(nest.spawnBlockedAt === undefined ? {} : { spawnBlockedAt: nest.spawnBlockedAt }),
  }
  return { namespace: state.namespace, lastTickAt: state.lastTickAt, areas: { ...state.areas }, nests }
}

function roll(random: RandomSource): number {
  const value = random()
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError(`random source must return a finite number in [0, 1), got ${String(value)}`)
  }
  return value
}

function assertTime(now: number): void {
  if (typeof now !== 'number' || !Number.isFinite(now)) throw new RangeError(`time must be a finite number, got ${String(now)}`)
}

const delayFor = (nest: NestConfig, random: RandomSource): number =>
  Math.round(nest.respawn.delayMs * (1 + nest.respawn.jitter * (2 * roll(random) - 1)))

// The existing rounding can also produce zero from a fractional delay. Guard
// that case without changing the authored delay, jitter or RNG consumption.
const canDelayZero = (nest: NestConfig): boolean => Math.round(nest.respawn.delayMs * (1 - nest.respawn.jitter)) === 0

const staggerFor = (area: AreaConfig, random: RandomSource): number =>
  Math.round(area.idle.staggerMinMs + roll(random) * (area.idle.staggerMaxMs - area.idle.staggerMinMs))

export function tickPopulation(state: PopulationState, config: PopulationConfig, deps: PopulationDeps, input: PopulationTickInput): TickResult {
  assertTime(input.now)
  if (state.namespace !== config.namespace) return { ok: false, reason: 'namespace-mismatch', state }
  if (state.lastTickAt !== null && input.now < state.lastTickAt) return { ok: false, reason: 'clock-regressed', state }

  const draft = draftOf(state)
  const events: PopulationEvent[] = []
  const { now } = input
  for (const area of config.areas) {
    const current = draft.areas[area.areaId]
    const nests = area.nests.map(nest => ({ nest, state: draft.nests[nestKey(area.areaId, nest.id)] }))

    if (!input.activeAreas.has(area.areaId)) {
      if (current.status === 'active') {
        draft.areas[area.areaId] = { status: 'idle', since: now }
        events.push({ type: 'area-status', areaId: area.areaId, from: 'active', to: 'idle', cleared: [] })
      } else if (current.status === 'idle' && now - (current.since ?? now) >= area.idle.dormantAfterMs) {
        // Not simulated any more: clear what is alive and forget pending respawns. Generations stay.
        const cleared = nests.flatMap(({ state: nest }) => nest.alive.map(encounter => encounter.id))
        for (const { state: nest } of nests) { nest.alive = []; nest.dueAt = null }
        draft.areas[area.areaId] = { status: 'dormant', since: now }
        events.push({ type: 'area-status', areaId: area.areaId, from: 'idle', to: 'dormant', cleared })
      }
      continue
    }

    if (current.status !== 'active') {
      // (Re)activation: a dormant area refills, an idle one resumes; overdue nests are spread out, never caught up.
      for (const { state: nestState } of nests) {
        const needsFill = current.status === 'dormant' && nestState.alive.length === 0 && nestState.dueAt === null
        const overdue = nestState.dueAt !== null && nestState.dueAt <= now
        if (needsFill || overdue) nestState.dueAt = now + staggerFor(area, input.random)
      }
      draft.areas[area.areaId] = { status: 'active', since: now }
      events.push({ type: 'area-status', areaId: area.areaId, from: current.status, to: 'active', cleared: [] })
    }

    for (const { nest, state: nestState } of nests) {
      if (nestState.dueAt !== null && nestState.dueAt <= now && nestState.spawnBlockedAt !== now) attemptSpawn(draft, area, nest, nestState, deps, input, events)
    }
  }
  draft.lastTickAt = now
  return { ok: true, state: draft, events }
}

function attemptSpawn(
  draft: Draft, area: AreaConfig, nest: NestConfig, nestState: DraftNest, deps: PopulationDeps,
  input: PopulationTickInput, events: PopulationEvent[],
): void {
  const { now, random } = input
  if (canDelayZero(nest)) nestState.spawnBlockedAt = now
  const fail = (reason: SpawnFailure, limitedBy?: 'nest' | 'zone' | 'area' | 'tiles' | 'groupCap') => {
    nestState.dueAt = now + nest.respawn.retryMs
    events.push({ type: 'spawn-failed', areaId: area.areaId, nestId: nest.id, reason, retryAt: nestState.dueAt, ...(limitedBy ? { limitedBy } : {}) })
  }
  const areaAlive = area.nests.flatMap(n => draft.nests[nestKey(area.areaId, n.id)].alive)
  const nestRoom = nest.maxAlive - nestState.alive.length
  // ECO-CAPACITY-1: the nest's population zone, when it has one with a maximum. No zone → no zone limit.
  const zone = nest.populationZoneId === undefined ? undefined : (area.zones ?? []).find(z => z.id === nest.populationZoneId)
  const zoneRoom = zone?.maxAlive === undefined
    ? Number.POSITIVE_INFINITY
    : zone.maxAlive - area.nests.filter(n => n.populationZoneId === zone.id).reduce((sum, n) => sum + draft.nests[nestKey(area.areaId, n.id)].alive.length, 0)
  const areaRoom = area.maxAlive - areaAlive.length
  if (nestRoom <= 0) return fail('nest-full')
  if (zoneRoom <= 0) return fail('zone-full')
  if (areaRoom <= 0) return fail('area-full')
  const geometry = input.geometry(area.areaId)
  if (!geometry) return fail('no-geometry')
  const occupied = new Set(areaAlive.map(encounter => `${encounter.tile.tx},${encounter.tile.ty}`))
  const open = nest.tiles.filter(tile => geometry.isOpenTile(tile.tx, tile.ty) && !occupied.has(`${tile.tx},${tile.ty}`))
  if (open.length === 0) return fail('no-open-tile')

  // Every limit at once. A group is never shrunk below its entry's minimum: entries that need more than
  // `room` are not candidates (documented ECO-2A policy); the size is drawn in [min, min(max, room)].
  const room = Math.min(nestRoom, zoneRoom, areaRoom, open.length, nest.groupCap)
  const ticket = { tierRoll: roll(random), entryRoll: roll(random) }
  const pick = pickEncounter(deps.catalog, nest.zoneId, ticket, entry => nest.habitats.includes(entry.habitat) && entry.group.min <= room)
  if (!pick.ok) {
    // An empty tier caused only by the room left is a capacity block, not a pool gap: replay the SAME
    // ticket without the room filter (no extra random draw) and report which limit was the smallest.
    if (pick.reason === 'empty-tier' && pickEncounter(deps.catalog, nest.zoneId, ticket, entry => nest.habitats.includes(entry.habitat)).ok) {
      const limits: ['nest' | 'zone' | 'area' | 'tiles' | 'groupCap', number][] = [['nest', nestRoom], ['zone', zoneRoom], ['area', areaRoom], ['tiles', open.length], ['groupCap', nest.groupCap]]
      return fail('no-room-for-group', limits.reduce((a, b) => (b[1] < a[1] ? b : a))[0])
    }
    return fail(pick.reason)
  }

  const { entry } = pick
  const maxSize = Math.min(entry.group.max, room)
  const size = entry.group.min + Math.floor(roll(random) * (maxSize - entry.group.min + 1))
  const tiles: Tile[] = []
  const pool = [...open]
  for (let i = 0; i < size; i++) tiles.push(pool.splice(Math.floor(roll(random) * pool.length), 1)[0])

  const generation = nestState.generation + 1
  const groupId = groupIdOf(draft.namespace, area.areaId, nest.id, generation)
  const born = tiles.map((tile, member): PopulationEncounter => ({
    id: `${groupId}:${member}`, groupId, areaId: area.areaId, nestId: nest.id, generation, member, groupSize: size,
    entryId: entry.id, speciesId: entry.speciesId, familyId: entry.familyId, rarity: entry.rarity, tile, spawnedAt: now,
  }))
  nestState.generation = generation
  nestState.alive = [...nestState.alive, ...born]
  nestState.dueAt = nest.respawn.policy === 'per-member' && nestState.alive.length < nest.maxAlive ? now + delayFor(nest, random) : null
  events.push({ type: 'spawned', areaId: area.areaId, nestId: nest.id, encounters: born })
}

/**
 * Removes a living encounter for a (simulated) cause and schedules its nest's
 * respawn according to the nest's policy. Not alive → no-op.
 */
export function retireEncounter(state: PopulationState, config: PopulationConfig, input: RetireInput): RetireResult {
  assertTime(input.now)
  if (state.namespace !== config.namespace) return { ok: false, reason: 'namespace-mismatch', state }
  const parts = encounterIdParts(input.encounterId)
  if (!parts || parts.namespace !== state.namespace) return { ok: false, reason: 'not-alive', state }
  const area = config.areas.find(a => a.areaId === parts.areaId)
  const nest = area?.nests.find(n => n.id === parts.nestId)
  const current = state.nests[nestKey(parts.areaId, parts.nestId)]
  const retired = current?.alive.find(encounter => encounter.id === input.encounterId)
  if (!nest || !current || !retired) return { ok: false, reason: 'not-alive', state }
  // A duplicate/unknown id is a no-op, even with a stale finite time. A living
  // encounter changes state, so it must respect the time of EVERY accepted mutation.
  if (state.lastTickAt !== null && input.now < state.lastTickAt) return { ok: false, reason: 'clock-regressed', state }

  const draft = draftOf(state)
  draft.lastTickAt = input.now
  const nestState = draft.nests[nestKey(parts.areaId, parts.nestId)]
  nestState.alive = nestState.alive.filter(encounter => encounter.id !== input.encounterId)
  if (nest.respawn.policy === 'per-group') {
    if (nestState.alive.length === 0 && nestState.dueAt === null) nestState.dueAt = input.now + delayFor(nest, input.random)
  } else if (nestState.dueAt === null) {
    nestState.dueAt = input.now + delayFor(nest, input.random)
  }
  if (canDelayZero(nest) && nestState.dueAt !== null && nestState.dueAt <= input.now) nestState.spawnBlockedAt = input.now
  return { ok: true, state: draft, retired, cause: input.cause, dueAt: nestState.dueAt }
}
