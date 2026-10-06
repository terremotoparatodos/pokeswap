// Offline F6 gate; authoritative layout helpers are read only by this dev tool.
// node node_modules/vite-node/vite-node.mjs scripts/ecosystem/validate-inputs.ts
import { buildSnapshot } from './map-geometry.mjs'
import { layoutVersion } from '../../services/realtime/src/world/layoutVersion.js'
import core from '../../src/features/battle/catalog/generated/core.json'
import { ECO_1_ENCOUNTER_CATALOG } from '../../src/features/ecosystem/encounters/initialCatalog'
import { lookupFromSpeciesList } from '../../src/features/ecosystem/encounters/testing'
import { PROVISIONAL_IDLE, PROVISIONAL_RESPAWN } from '../../src/features/ecosystem/population/config'
import { createValidatedPopulation, proposedAreaConfig } from '../../src/features/ecosystem/map/capacityProposal'
import { SNAPSHOT } from '../../src/features/ecosystem/map/nestData'
import { NEST_PROPOSALS } from '../../src/features/ecosystem/map/nestProposals'

if (JSON.stringify(SNAPSHOT) + '\n' !== buildSnapshot()) throw new Error('geometry snapshot differs from the authoritative world')
const areas = Object.keys(SNAPSHOT.areas)
const result = createValidatedPopulation({
  catalog: ECO_1_ENCOUNTER_CATALOG, lookupSpecies: lookupFromSpeciesList(core.species),
  config: { namespace: 'readiness-offline-check', areas: areas.map(id => proposedAreaConfig(id, PROVISIONAL_RESPAWN, PROVISIONAL_IDLE)) },
  snapshot: SNAPSHOT, proposals: NEST_PROPOSALS,
  currentLayouts: Object.fromEntries(areas.map(id => [id, layoutVersion(id)])),
})
if (!result.ok) throw new Error(JSON.stringify(result.issues))
console.log('ecosystem inputs valid against authoritative layouts; dormant state only, no gameplay activation')
