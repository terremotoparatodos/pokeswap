// The structured nest data of ECO-MAP-1: proposals + what the real geometry
// derives for them (candidates, eligible species, warnings) + the versions of
// every input. Pure; written to docs/design/eco-map-1/nests.json by
// scripts/ecosystem/map-nests.ts and checked for freshness by map.test.ts.

import { ECO_1_ENCOUNTER_CATALOG } from '../encounters/initialCatalog'
import snapshot from './generated/geometrySnapshot.json'
import { areaView, type GeometrySnapshot } from './geometry'
import { PROVISIONAL_CAPACITY } from './capacityLimits'
import { NEST_PROPOSALS, NEST_PROPOSALS_VERSION } from './nestProposals'
import { FORBIDDEN_FLAGS, MIN_NEST_SPACING, PROTECTED_RADIUS, validateNests } from './nestValidation'

export const SNAPSHOT = snapshot as unknown as GeometrySnapshot

export function nestValidation() {
  return validateNests(NEST_PROPOSALS, areaId => areaView(SNAPSHOT, areaId), ECO_1_ENCOUNTER_CATALOG)
}

export function buildNestData() {
  const { issues, reports } = nestValidation()
  return {
    proposals: NEST_PROPOSALS_VERSION,
    catalog: ECO_1_ENCOUNTER_CATALOG.version,
    geometry: {
      generatedBy: SNAPSHOT.generatedBy,
      terrainGenerator: SNAPSHOT.terrainGenerator,
      layoutVersions: Object.fromEntries(Object.values(SNAPSHOT.areas).map(a => [a.areaId, a.layoutVersion])),
    },
    rules: { forbidden: FORBIDDEN_FLAGS, protectedRadius: PROTECTED_RADIUS, minNestSpacing: MIN_NEST_SPACING },
    capacity: PROVISIONAL_CAPACITY,
    issues,
    nests: NEST_PROPOSALS.map(nest => {
      const report = reports.find(r => r.id === nest.id)!
      return { ...nest, candidateCount: report.candidates.length, candidates: report.candidates, eligible: report.eligible, tiersCovered: report.tiersCovered, maxGroup: report.maxGroup, warnings: report.warnings }
    }),
  }
}
