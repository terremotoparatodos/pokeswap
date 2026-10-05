// The simulator's controller (ECO-PREVIEW-1): every action of the dev tool is
// a pure function from one SimState to the next, driving the REAL engine
// (`population/engine.ts`) over the REAL catalog. No parallel implementation.
//
// Reproducible by construction: the random source is a seeded generator whose
// state is part of SimState, and time only moves when an action says so.
// "Retire" is a simulated event: it calls no API and creates nothing — no
// Pokémon, XP, Essence or currency.

import { ECO_1_ENCOUNTER_CATALOG } from '../encounters/initialCatalog'
import { createPopulation, retireEncounter, tickPopulation } from '../population/engine'
import type { PopulationConfigIssue } from '../population/config'
import { publicArea } from '../population/projection'
import type { AreaGeometry, PopulationEvent, PopulationState, RandomSource, RetireCause } from '../population/types'
import { buildScenario, type NestLayout, type PreviewZoneId, type Scenario, type SimParams } from './scenarios'

export interface SimSetup {
  readonly zoneId: PreviewZoneId
  readonly layout: NestLayout
  readonly seed: number
  readonly params: SimParams
}

export interface SimState {
  readonly setup: SimSetup
  readonly scenario: Scenario
  readonly population: PopulationState
  readonly now: number
  /** State of the seeded generator: the next random number depends only on it. */
  readonly rngState: number
  /** Players in the area. 0 → the area is inactive at the next evaluation. */
  readonly players: number
  /** Forces the area inactive regardless of players (tests the empty-area policy). */
  readonly forcedInactive: boolean
  readonly evaluations: number
  /** Engine events of the last evaluation (empty after a retirement or an input change). */
  readonly lastEvents: readonly PopulationEvent[]
  readonly log: readonly string[]
}

export type CreateSimResult = { readonly ok: true; readonly sim: SimState } | { readonly ok: false; readonly issues: readonly PopulationConfigIssue[] }

const deps = { catalog: ECO_1_ENCOUNTER_CATALOG }
const LOG_LIMIT = 200

/** mulberry32 over an explicit state, so the generator can be stored and resumed. */
function generator(state: number): { random: RandomSource; state: () => number } {
  let s = state >>> 0
  return {
    random: () => {
      s = (s + 0x6d2b79f5) >>> 0
      let t = s
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    },
    state: () => s,
  }
}

export function geometryOf(scenario: Scenario): AreaGeometry {
  const blocked = new Set(scenario.blocked.map(t => `${t.tx},${t.ty}`))
  const b = scenario.bounds
  return { isOpenTile: (tx, ty) => tx >= b.minTx && ty >= b.minTy && tx <= b.maxTx && ty <= b.maxTy && !blocked.has(`${tx},${ty}`) }
}

const areaIdOf = (sim: SimState) => sim.scenario.config.areas[0].areaId
const isActive = (sim: SimState) => sim.players > 0 && !sim.forcedInactive

function describe(event: PopulationEvent): string {
  if (event.type === 'spawned') return `aparece ${event.nestId}: ${event.encounters.map(e => `#${e.speciesId}`).join(' ')} (grupo ${event.encounters[0].groupId.split(':').slice(-1)[0]})`
  if (event.type === 'spawn-failed') return `falla ${event.nestId}: ${event.reason}, reintento a t=${event.retryAt / 1000}s`
  return `área ${event.from} → ${event.to}${event.cleared.length ? ` (${event.cleared.length} retirados por inactividad)` : ''}`
}

const withLog = (log: readonly string[], lines: readonly string[]) => [...log, ...lines].slice(-LOG_LIMIT)

/** Runs one evaluation at `now` with the sim's inputs. */
function evaluate(sim: SimState, now: number, label: string): SimState {
  const gen = generator(sim.rngState)
  const result = tickPopulation(sim.population, sim.scenario.config, deps, {
    now, activeAreas: new Set(isActive(sim) ? [areaIdOf(sim)] : []), geometry: () => geometryOf(sim.scenario), random: gen.random,
  })
  if (!result.ok) return { ...sim, lastEvents: [], log: withLog(sim.log, [`t=${now / 1000}s ${label}: rechazado (${result.reason})`]) }
  const lines = result.events.length ? result.events.map(e => `t=${now / 1000}s ${describe(e)}`) : [`t=${now / 1000}s ${label}: sin cambios`]
  return { ...sim, population: result.state, now, rngState: gen.state(), evaluations: sim.evaluations + 1, lastEvents: result.events, log: withLog(sim.log, lines) }
}

/** A fresh simulation: one player present, first evaluation at t = 0 (the area wakes up staggered). */
export function createSim(setup: SimSetup): CreateSimResult {
  const scenario = buildScenario(setup.zoneId, setup.layout, setup.params, setup.seed)
  const created = createPopulation(scenario.config, deps)
  if (!created.ok) return { ok: false, issues: created.issues }
  const base: SimState = {
    setup, scenario, population: created.state, now: 0, rngState: setup.seed >>> 0, players: 1, forcedInactive: false, evaluations: 0, lastEvents: [],
    log: [`escenario ${setup.zoneId} · ${setup.layout} · semilla ${setup.seed} (${setup.layout === 'real-map' ? 'PROPUESTA, mapa real' : 'SIMULACIÓN, grilla sintética'})`],
  }
  return { ok: true, sim: evaluate(base, 0, 'inicio') }
}

export const advance = (sim: SimState, ms: number): SimState => {
  if (!Number.isFinite(ms) || ms <= 0) throw new RangeError('advance needs a positive number of milliseconds')
  return evaluate(sim, sim.now + ms, `+${ms / 1000}s`)
}

/** Evaluates again without moving the clock: the engine must change nothing. */
export const repeatEvaluation = (sim: SimState): SimState => evaluate(sim, sim.now, 'repetir evaluación')

/** Simulated retirement at the current time. No API, no reward, no Pokémon. */
export function retire(sim: SimState, encounterId: string, cause: RetireCause): SimState {
  const gen = generator(sim.rngState)
  const result = retireEncounter(sim.population, sim.scenario.config, { encounterId, cause, now: sim.now, random: gen.random })
  if (!result.ok) return { ...sim, lastEvents: [], log: withLog(sim.log, [`t=${sim.now / 1000}s retirar ${encounterId}: ${result.reason} (sin efecto)`]) }
  const due = result.dueAt === null ? 'sin reposición programada' : `reposición a t=${result.dueAt / 1000}s`
  return {
    ...sim, population: result.state, rngState: gen.state(), lastEvents: [],
    log: withLog(sim.log, [`t=${sim.now / 1000}s retirado (${cause}, simulado) ${result.retired.id} #${result.retired.speciesId} · ${due}`]),
  }
}

/** Presence inputs; they take effect at the next evaluation. */
export const setPlayers = (sim: SimState, players: number): SimState => ({ ...sim, players: Math.max(0, Math.floor(players)) })
export const setForcedInactive = (sim: SimState, forcedInactive: boolean): SimState => ({ ...sim, forcedInactive })

/** Same scenario, same seed: the run starts over and replays identically. */
export function resetSim(sim: SimState): SimState {
  const created = createSim(sim.setup)
  if (!created.ok) throw new Error('a setup that created a sim must create it again')
  return created.sim
}

// ── View model (pure) ─────────────────────────────────────────────────────

export interface NestView {
  readonly id: string
  readonly habitats: readonly string[]
  readonly alive: number
  readonly max: number
  readonly generation: number
  /** ECO-CAPACITY-1: the nest's population zone, or null. */
  readonly zone: string | null
  /** ms until the next spawn opportunity, or null when none is scheduled. */
  readonly dueIn: number | null
}

export interface CellView {
  readonly tx: number
  readonly ty: number
  readonly blocked: boolean
  /** Real map: the tile kind char (realMap.ts TILE_KIND); synthetic grid: '#' or '.'. */
  readonly kind: string
  readonly nestId: string | null
  readonly encounter: { readonly id: string; readonly groupId: string; readonly speciesId: number } | null
}

/** ECO-CAPACITY-1: population and limits of one population zone (or of the zone-less nests). */
export interface ZoneView {
  readonly id: string | null
  readonly alive: number
  readonly max: number | null
  readonly nests: number
}

export interface SimView {
  readonly zones: readonly ZoneView[]
  readonly now: number
  readonly status: string
  readonly simulated: boolean
  readonly alive: number
  readonly areaMax: number
  readonly nests: readonly NestView[]
  readonly cells: readonly CellView[]
}

export function viewOf(sim: SimState): SimView {
  const areaId = areaIdOf(sim)
  const area = sim.scenario.config.areas[0]
  const blocked = new Set(sim.scenario.blocked.map(t => `${t.tx},${t.ty}`))
  const nestAt = new Map<string, string>()
  for (const nest of area.nests) for (const t of nest.tiles) nestAt.set(`${t.tx},${t.ty}`, nest.id)
  const published = publicArea(sim.population, areaId)
  const encounterAt = new Map(published.encounters.map(e => [`${e.tile.tx},${e.tile.ty}`, { id: e.id, groupId: e.groupId, speciesId: e.speciesId }]))
  const cells: CellView[] = []
  const b = sim.scenario.bounds
  for (let ty = b.minTy; ty <= b.maxTy; ty++) for (let tx = b.minTx; tx <= b.maxTx; tx++) {
    const key = `${tx},${ty}`
    const kind = sim.scenario.kinds ? sim.scenario.kinds[ty - b.minTy][tx - b.minTx] : blocked.has(key) ? '#' : '.'
    cells.push({ tx, ty, blocked: blocked.has(key), kind, nestId: nestAt.get(key) ?? null, encounter: encounterAt.get(key) ?? null })
  }
  const nests = area.nests.map(nest => {
    const state = sim.population.nests[`${areaId}/${nest.id}`]
    return { id: nest.id, habitats: nest.habitats, zone: nest.populationZoneId ?? null, alive: state.alive.length, max: nest.maxAlive, generation: state.generation, dueIn: state.dueAt === null ? null : state.dueAt - sim.now }
  })
  const zoneIds: (string | null)[] = [...(area.zones ?? []).map(z => z.id), ...(nests.some(n => n.zone === null) && (area.zones ?? []).length ? [null] : [])]
  const zones: ZoneView[] = zoneIds.map(id => ({
    id, max: (area.zones ?? []).find(z => z.id === id)?.maxAlive ?? null,
    alive: nests.filter(n => n.zone === id).reduce((s, n) => s + n.alive, 0), nests: nests.filter(n => n.zone === id).length,
  }))
  return {
    now: sim.now, status: sim.population.areas[areaId].status, simulated: published.simulated,
    alive: nests.reduce((sum, nest) => sum + nest.alive, 0), areaMax: area.maxAlive, nests, cells, zones,
  }
}

/** Every encounter alive, with its private fields — for the simulator's own panels, never for a client. */
export const aliveEncounters = (sim: SimState) => Object.values(sim.population.nests).flatMap(nest => nest.alive)
