// F6: explicit, pure admission gate for a future adapter. Not gameplay wiring.
// currentLayouts MUST come from the authoritative world, independently of the snapshot.
import { validateEncounterCatalog } from '../encounters/validation'
import type { EncounterCatalog, EncounterSpeciesLookup } from '../encounters/types'
import { validatePopulationConfig } from '../population/config'
import { createPopulation } from '../population/engine'
import type { PopulationConfig, PopulationState } from '../population/types'
import { areaView, type GeometrySnapshot } from './geometry'
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
  readonly boundary: 'catalog' | 'population' | 'proposal' | 'layout' | 'config-proposal'
  readonly code: string
  readonly message: string
}
export type ReadinessResult =
  | { readonly ok: true; readonly state: PopulationState }
  | { readonly ok: false; readonly issues: readonly ReadinessIssue[] }

export function createValidatedPopulation(input: PopulationReadinessInput): ReadinessResult {
  const { catalog, config, snapshot, proposals, currentLayouts } = input
  const issues: ReadinessIssue[] = []
  const append = (boundary: ReadinessIssue['boundary'], rows: readonly { code: string; message: string }[]) => {
    issues.push(...rows.map(row => ({ boundary, code: row.code, message: row.message })))
  }
  append('catalog', validateEncounterCatalog(catalog, input.lookupSpecies).issues)
  append('population', validatePopulationConfig(config, catalog))
  const spatial = validateNests(proposals, id => areaView(snapshot, id), catalog)
  append('proposal', spatial.issues)
  const reports = new Map(spatial.reports.map(r => [r.id, r]))
  for (const area of config.areas) {
    const current = currentLayouts[area.areaId]
    const stored = snapshot.areas[area.areaId]?.layoutVersion
    if (typeof current !== 'string' || !current || current !== stored) {
      issues.push({ boundary: 'layout', code: 'layout-mismatch', message: `area ${area.areaId}: snapshot ${stored ?? 'missing'}, authority ${current ?? 'missing'}` })
    }
    for (const nest of area.nests) {
      const proposal = proposals.find(p => p.id === nest.id && p.areaId === area.areaId)
      const report = reports.get(nest.id)
      const candidates = new Set(report?.candidates.map(t => `${t.tx},${t.ty}`) ?? [])
      const habitatsMatch = proposal && JSON.stringify([...proposal.habitats].sort()) === JSON.stringify([...nest.habitats].sort())
      if (!proposal || !report || proposal.zoneId !== nest.zoneId || !habitatsMatch
        || nest.maxAlive !== proposal.maxAlive || nest.groupCap !== proposal.groupCap
        || nest.tiles.some(t => !candidates.has(`${t.tx},${t.ty}`))) {
        issues.push({ boundary: 'config-proposal', code: 'nest-config-mismatch', message: `nest ${area.areaId}/${nest.id} does not match its validated spatial proposal` })
      }
    }
  }
  if (issues.length) return { ok: false, issues } // never expose a partially admitted state
  const result = createPopulation(config, { catalog })
  return result.ok ? result : { ok: false, issues: result.issues.map(i => ({ boundary: 'population', code: i.code, message: i.message })) }
}
