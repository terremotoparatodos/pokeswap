// The ADMITTED encounter population, as the realtime service consumes it (ECO-GAMEPLAY-1).
//
// This file is the ONLY entry of `scripts/integration/bundle-admission.mjs`:
// everything exported here — and nothing else — is in
// `services/realtime/src/world/ecosystem/admission.generated.js`.
//
// The realtime gets an admitted population or nothing. The R1/R2 gate
// (`createValidatedPopulation`) runs here, against what this build carries: the
// independently verified geometry, the ECO-MAP-1 nests, the ECO-CAPACITY-1
// limits, the ECO-1 catalog, the battle catalog's species and the PROVISIONAL
// respawn/idle values. The caller supplies only what an authority must supply:
// a namespace, the CURRENT layout versions of the world, and — on every call —
// the time and a random source. The bare engine (`createPopulation`,
// `tickPopulation`, `retireEncounter`) is not exported: there is no way to run
// it without passing the gate first.
//
// No Node/server import, clock, randomness or I/O of its own.

import { species as battleSpecies } from '../../battle/catalog/generated/core.json'
import { ECO_1_ENCOUNTER_CATALOG } from '../encounters/initialCatalog'
import type { EncounterSpeciesLookup } from '../encounters/types'
import { createValidatedPopulation, proposedAreaConfig } from '../map/capacityProposal'
import { areaView } from '../map/geometry'
import { SNAPSHOT } from '../map/nestData'
import { NEST_PROPOSALS } from '../map/nestProposals'
import { FORBIDDEN_FLAGS } from '../map/nestValidation'
import { PROVISIONAL_IDLE, PROVISIONAL_RESPAWN } from '../population/config'
import { retireEncounter, tickPopulation } from '../population/engine'
import { encounterIdParts } from '../population/ids'
import { publicArea, type PublicArea } from '../population/projection'
import type { AreaGeometry, PopulationConfig, PopulationState, RandomSource } from '../population/types'
import type { ReadinessIssue } from '../map/readiness'

/** Bundle contract version: bump when the exported surface changes shape. */
export const ECO_ADMISSION_API = 1

/** A namespace the server chose; it becomes the first part of every encounter id. */
const NAMESPACE = /^[a-z0-9][a-z0-9-]{0,63}$/

export interface AdmitInput {
  readonly namespace: string
  /** Layout version of every area, read from the authoritative world, never from the snapshot. */
  readonly currentLayouts: Readonly<Record<string, string>>
}

export interface TickInput {
  readonly now: number
  readonly random: RandomSource
  /** Areas with at least one viewer right now, decided by the server. */
  readonly activeAreas: ReadonlySet<string>
}

export type TickOutcome =
  | { readonly ok: true; readonly changedAreas: readonly string[] }
  | { readonly ok: false; readonly reason: 'clock-regressed' | 'namespace-mismatch' }

export type RetireOutcome =
  | { readonly ok: true; readonly areaId: string }
  | { readonly ok: false; readonly reason: 'not-alive' | 'clock-regressed' | 'namespace-mismatch' }

/** An admitted population: only intentions, never the state or the configuration. */
export interface AdmittedPopulation {
  readonly areaIds: readonly string[]
  tick(input: TickInput): TickOutcome
  /** A test retirement: always the simulated cause `fled` — no capture, no reward, nothing persistent. */
  retire(input: { readonly encounterId: string; readonly now: number; readonly random: RandomSource }): RetireOutcome
  /** What a viewer of the area may be shown (the engine's `publicArea`). */
  view(areaId: string): PublicArea
  /** The area an encounter id names, or null when it is not an encounter id of this population. */
  areaOf(encounterId: string): string | null
}

export type AdmitResult =
  | { readonly ok: true; readonly population: AdmittedPopulation }
  | { readonly ok: false; readonly issues: readonly ReadinessIssue[] }

const speciesById = new Map(battleSpecies.map(entry => [entry.id, entry]))
const lookupSpecies: EncounterSpeciesLookup = id => speciesById.get(id) ?? null

/** Static geometry of the admitted snapshot: a tile is open when it carries no forbidden flag. */
function geometryOf(areaId: string): AreaGeometry | null {
  const view = areaView(SNAPSHOT, areaId)
  if (!view) return null
  return { isOpenTile: (tx, ty) => { const flags = view.flags(tx, ty); return FORBIDDEN_FLAGS.every(flag => !flags.has(flag)) } }
}

export function admitEcoPopulation(input: AdmitInput): AdmitResult {
  if (typeof input?.namespace !== 'string' || !NAMESPACE.test(input.namespace)) {
    return { ok: false, issues: [{ boundary: 'population', code: 'invalid-namespace', message: 'the namespace must be 1–64 lowercase letters, digits or dashes' }] }
  }
  const areaIds = Object.keys(SNAPSHOT.areas)
  const config: PopulationConfig = {
    namespace: input.namespace,
    areas: areaIds.map(areaId => proposedAreaConfig(areaId, PROVISIONAL_RESPAWN, PROVISIONAL_IDLE)),
  }
  const admitted = createValidatedPopulation({
    catalog: ECO_1_ENCOUNTER_CATALOG, lookupSpecies, config, snapshot: SNAPSHOT, proposals: NEST_PROPOSALS,
    currentLayouts: input.currentLayouts ?? {},
  })
  if (!admitted.ok) return { ok: false, issues: admitted.issues }

  const deps = { catalog: ECO_1_ENCOUNTER_CATALOG }
  const geometries = new Map(areaIds.map(areaId => [areaId, geometryOf(areaId)]))
  const geometry = (areaId: string) => geometries.get(areaId) ?? null
  let state: PopulationState = admitted.state

  const population: AdmittedPopulation = {
    areaIds: Object.freeze([...areaIds]),
    tick({ now, random, activeAreas }) {
      const result = tickPopulation(state, config, deps, { now, random, activeAreas, geometry })
      if (!result.ok) return { ok: false, reason: result.reason }
      const before = state
      state = result.state
      // An area's public view changes on a spawn or when it starts/stops being simulated.
      const changed = new Set<string>()
      for (const event of result.events) {
        if (event.type === 'spawned') changed.add(event.areaId)
        if (event.type === 'area-status' && (event.from === 'active' || event.to === 'active')) changed.add(event.areaId)
      }
      for (const areaId of areaIds) if (before.areas[areaId]?.status !== state.areas[areaId]?.status) changed.add(areaId)
      return { ok: true, changedAreas: [...changed] }
    },
    retire({ encounterId, now, random }) {
      const result = retireEncounter(state, config, { encounterId, now, random, cause: 'fled' })
      if (!result.ok) return { ok: false, reason: result.reason }
      state = result.state
      return { ok: true, areaId: result.retired.areaId }
    },
    view: areaId => publicArea(state, areaId),
    areaOf(encounterId) {
      const parts = encounterIdParts(encounterId)
      return parts && parts.namespace === state.namespace && areaIds.includes(parts.areaId) ? parts.areaId : null
    },
  }
  return { ok: true, population: Object.freeze(population) }
}
