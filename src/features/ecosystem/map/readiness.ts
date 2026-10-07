// F6: explicit, pure admission gate for a future adapter. Not gameplay wiring.
// currentLayouts MUST come from the authoritative world, independently of the snapshot.
// Geometry content must also match the immutable, offline-verified build artifact.
import { validateEncounterCatalog } from '../encounters/validation'
import type { EncounterCatalog, EncounterSpeciesLookup } from '../encounters/types'
import { validatePopulationConfig } from '../population/config'
import { createPopulation } from '../population/engine'
import type { PopulationConfig, PopulationState } from '../population/types'
import { areaView, type GeometrySnapshot } from './geometry'
import { geometryMatchesBuild } from './geometryAdmission'
import { validateNests, type NestProposal } from './nestValidation'

export interface PopulationReadinessInput {
  readonly catalog: EncounterCatalog
  readonly config: PopulationConfig
  readonly lookupSpecies: EncounterSpeciesLookup
  readonly snapshot: GeometrySnapshot
  readonly proposals: readonly NestProposal[]
  readonly currentLayouts: Readonly<Record<string, string>>
}
export interface ReadinessIssue {
  readonly boundary: 'catalog' | 'population' | 'proposal' | 'layout' | 'config-proposal' | 'scope' | 'geometry-authority'
  readonly code: string
  readonly message: string
}
export type ReadinessResult =
  | { readonly ok: true; readonly state: PopulationState }
  | { readonly ok: false; readonly issues: readonly ReadinessIssue[] }

/** Unordered equality, including cardinality and uniqueness; no silent subsets or duplicates. */
function sameMembers(expected: readonly string[], actual: readonly string[]): boolean {
  const members = new Set(expected)
  return members.size === expected.length && new Set(actual).size === actual.length
    && actual.length === expected.length && actual.every(key => members.has(key))
}

const nestIdentity = (areaId: string, id: string): string => JSON.stringify([areaId, id])
const tileIdentity = (t: { readonly tx: number; readonly ty: number }): string => `${t.tx},${t.ty}`

export function createValidatedPopulation(input: PopulationReadinessInput): ReadinessResult {
  const { catalog, config, snapshot, proposals, currentLayouts } = input
  // Reject before deriving any candidate tiles or state from altered geometry.
  if (!geometryMatchesBuild(snapshot)) return { ok: false, issues: [{
    boundary: 'geometry-authority', code: 'geometry-content-mismatch',
    message: 'snapshot content differs from the independently verified geometry of this build',
  }] }
  const issues: ReadinessIssue[] = []
  const append = (boundary: ReadinessIssue['boundary'], rows: readonly { code: string; message: string }[]) => {
    issues.push(...rows.map(row => ({ boundary, code: row.code, message: row.message })))
  }
  append('catalog', validateEncounterCatalog(catalog, input.lookupSpecies).issues)
  append('population', validatePopulationConfig(config, catalog))
  // Current contract: every snapshot area, every supplied proposal nest, and
  // every derived tile. Partial area scopes and tile subsets are not admitted.
  const areaIds = Object.keys(snapshot.areas)
  const proposedAreas = [...new Set(proposals.map(p => p.areaId))]
  const configuredAreas = config.areas.map(a => a.areaId)
  if (areaIds.length === 0 || !sameMembers(areaIds, proposedAreas) || !sameMembers(areaIds, configuredAreas)) {
    issues.push({ boundary: 'scope', code: 'area-scope-mismatch', message: 'snapshot, proposals and configuration must cover exactly the same nonempty area scope' })
  }
  if (!sameMembers(areaIds, Object.keys(currentLayouts))) {
    issues.push({ boundary: 'scope', code: 'layout-scope-mismatch', message: 'authoritative layouts must cover exactly the admitted snapshot area scope' })
  }
  const proposalKeys = proposals.map(p => nestIdentity(p.areaId, p.id))
  const configKeys = config.areas.flatMap(a => a.nests.map(n => nestIdentity(a.areaId, n.id)))
  if (!sameMembers(proposalKeys, configKeys)) {
    issues.push({ boundary: 'scope', code: 'nest-scope-mismatch', message: 'each proposal must have exactly one configured nest and each configured nest exactly one proposal' })
  }
  const spatial = validateNests(proposals, id => areaView(snapshot, id), catalog)
  append('proposal', spatial.issues)
  const reports = new Map(spatial.reports.map(r => [r.id, r]))
  for (const areaId of areaIds) {
    const current = currentLayouts[areaId]
    const stored = snapshot.areas[areaId]?.layoutVersion
    if (typeof current !== 'string' || !current || current !== stored) {
      issues.push({ boundary: 'layout', code: 'layout-mismatch', message: `area ${areaId}: snapshot ${stored ?? 'missing'}, authority ${current ?? 'missing'}` })
    }
  }
  for (const area of config.areas) {
    for (const nest of area.nests) {
      const proposal = proposals.find(p => p.id === nest.id && p.areaId === area.areaId)
      const report = reports.get(nest.id)
      const habitatsMatch = proposal && JSON.stringify([...proposal.habitats].sort()) === JSON.stringify([...nest.habitats].sort())
      if (!proposal || !report || proposal.zoneId !== nest.zoneId || !habitatsMatch
        || nest.maxAlive !== proposal.maxAlive || nest.groupCap !== proposal.groupCap
        || !sameMembers(report.candidates.map(tileIdentity), nest.tiles.map(tileIdentity))) {
        issues.push({ boundary: 'config-proposal', code: 'nest-config-mismatch', message: `nest ${area.areaId}/${nest.id} does not match its validated spatial proposal` })
      }
    }
  }
  if (issues.length) return { ok: false, issues } // never expose a partially admitted state
  const result = createPopulation(config, { catalog })
  return result.ok ? result : { ok: false, issues: result.issues.map(i => ({ boundary: 'population', code: i.code, message: i.message })) }
}
