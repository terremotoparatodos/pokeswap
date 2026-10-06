import { describe, expect, it } from 'vitest'
import core from '../../battle/catalog/generated/core.json'
import { ECO_1_ENCOUNTER_CATALOG } from '../encounters/initialCatalog'
import { lookupFromSpeciesList } from '../encounters/testing'
import type { EncounterCatalog, EncounterSpeciesLookup } from '../encounters/types'
import { PROVISIONAL_IDLE, PROVISIONAL_RESPAWN } from '../population/config'
import { createPopulation } from '../population/engine'
import type { PopulationConfig } from '../population/types'
import * as proposalApi from './capacityProposal'
import { areaView, type GeometrySnapshot } from './geometry'
import { SNAPSHOT } from './nestData'
import { NEST_PROPOSALS } from './nestProposals'
import type { NestProposal } from './nestValidation'

interface Inputs {
  catalog: EncounterCatalog
  config: PopulationConfig
  lookupSpecies: EncounterSpeciesLookup
  snapshot: GeometrySnapshot
  proposals: readonly NestProposal[]
  currentLayouts: Readonly<Record<string, string>>
}
const inputs = (): Inputs => ({
  catalog: ECO_1_ENCOUNTER_CATALOG,
  config: { namespace: 'readiness-test', areas: ['pradera', 'cueva-inicial'].map(id => proposalApi.proposedAreaConfig(id, PROVISIONAL_RESPAWN, PROVISIONAL_IDLE)) },
  lookupSpecies: lookupFromSpeciesList(core.species), snapshot: SNAPSHOT, proposals: NEST_PROPOSALS,
  currentLayouts: Object.fromEntries(Object.values(SNAPSHOT.areas).map(a => [a.areaId, a.layoutVersion])),
})

// Baseline-only adapter: fa14ab2 has no composite gate. Exercising its actual
// create/proposal boundaries makes the regression fail because invalid inputs
// are accepted, not because a new export/module is missing. On the fixed tree
// every test calls the composite gate. Deleting the gate re-exposes these failures.
function gate(input: Inputs): { ok: boolean; issues?: readonly unknown[] } {
  const api = proposalApi as unknown as { createValidatedPopulation?: (input: Inputs) => { ok: boolean; issues?: readonly unknown[] } }
  return api.createValidatedPopulation ? api.createValidatedPopulation(input) : createPopulation(input.config, { catalog: input.catalog })
}

describe('audit F6 acceptance', () => {
  it('F6 accepts the current valid proposal without activating it', () => {
    expect(gate(inputs()).ok).toBe(true)
  })
  it('F6 rejects invalid catalog groups before creating state', () => {
    const i = inputs()
    i.catalog = { ...i.catalog, entries: i.catalog.entries.map(e => e.zoneId === 'cueva-inicial' && e.rarity === 'common' ? { ...e, group: { min: 0, max: 0 } } : e) }
    expect(gate(i).ok).toBe(false)
  })
  it.each(['missing', 'changed'])('F6 rejects %s authoritative layout metadata', mode => {
    const i = inputs()
    i.currentLayouts = mode === 'missing' ? {} : { ...i.currentLayouts, pradera: 'changed-layout' }
    expect(gate(i).ok).toBe(false)
  })
  it('F6 rejects spatial proposal issues instead of discarding them', () => {
    const i = inputs()
    i.proposals = i.proposals.map((n, index) => index ? n : { ...n, anchor: SNAPSHOT.areas.pradera.entry })
    expect(gate(i).ok).toBe(false)
  })
  it('F6 rejects config tiles inconsistent with the validated proposal', () => {
    const i = inputs()
    i.config = { ...i.config, areas: i.config.areas.map((a, index) => index ? a : { ...a, nests: a.nests.map((n, j) => j ? n : { ...n, tiles: [SNAPSHOT.areas.pradera.entry] }) }) }
    expect(gate(i).ok).toBe(false)
  })
  it('F6 proposal builder refuses an invalid anchor', () => {
    const nest = NEST_PROPOSALS[0] as { anchor: { tx: number; ty: number } }
    const previous = nest.anchor
    try {
      nest.anchor = areaView(SNAPSHOT, 'pradera')!.area.entry
      expect(() => proposalApi.proposedAreaConfig('pradera', PROVISIONAL_RESPAWN, PROVISIONAL_IDLE)).toThrow(/invalid nest proposal/)
    } finally { nest.anchor = previous }
  })
})
