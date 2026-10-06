// The encounter ecosystem as the realtime service will consume it (ECO-2B).
//
// This file is the ONLY entry of `scripts/integration/bundle-encounters.mjs`:
// everything exported here — and nothing else — is in
// `services/realtime/src/world/ecosystem/encounters.generated.js`. It re-exports
// the ECO-1 catalog and the ECO-2A engine unchanged: no logic lives here, so
// the bundle cannot drift in semantics from the modules under review.
//
// Not wired: no room, service or route imports the bundle yet.

/** Bundle contract version: bump when the exported surface changes shape. */
// v2: retirement namespace rejection and optional immediate-respawn state guard.
export const ENCOUNTER_RUNTIME_API = 2

// ECO-1 · catalog, policy, validation, queries
export { ECO_1_ENCOUNTER_CATALOG } from '../encounters/initialCatalog'
export { EVENT_ONLY_CATEGORIES, ordinaryEncounterExclusion } from '../encounters/policy'
export { validateEncounterCatalog } from '../encounters/validation'
export { entriesForSpecies, entriesInFamily, entriesInZone, entriesOfRarity, pickEncounter, ticketFrom, zoneById, zoneDistribution } from '../encounters/queries'
export { ENCOUNTER_RARITIES, SPECIES_CATEGORY_IDS } from '../encounters/types'

// ECO-2A · population engine
export { PROVISIONAL_IDLE, PROVISIONAL_RESPAWN, validatePopulationConfig } from '../population/config'
export { createPopulation, retireEncounter, tickPopulation } from '../population/engine'
export { encounterIdParts } from '../population/ids'
export { publicArea } from '../population/projection'
