// @vitest-environment node
// R1/R2: reviewer probes, directly against the admission API that exists at b03c437.
import { describe, expect, it } from 'vitest'
import core from '../../battle/catalog/generated/core.json'
import { ECO_1_ENCOUNTER_CATALOG } from '../encounters/initialCatalog'
import { lookupFromSpeciesList } from '../encounters/testing'
import { PROVISIONAL_IDLE, PROVISIONAL_RESPAWN } from '../population/config'
import { proposedAreaConfig } from './capacityProposal'
import { createValidatedPopulation, type PopulationReadinessInput } from './readiness'
import { areaView } from './geometry'
import { SNAPSHOT } from './nestData'
import { NEST_PROPOSALS } from './nestProposals'
import { candidatesOf, tileRejections } from './nestValidation'
// @ts-expect-error — authoritative JS is only imported by test tooling, never runtime
import { layoutVersion } from '../../../../services/realtime/src/world/layoutVersion.js'

const inputs = (): PopulationReadinessInput => ({
  catalog: ECO_1_ENCOUNTER_CATALOG,
  lookupSpecies: lookupFromSpeciesList(core.species),
  config: { namespace: 'review-r1-r2', areas: Object.keys(SNAPSHOT.areas).map(id => proposedAreaConfig(id, PROVISIONAL_RESPAWN, PROVISIONAL_IDLE)) },
  snapshot: SNAPSHOT, proposals: NEST_PROPOSALS,
  currentLayouts: Object.fromEntries(Object.keys(SNAPSHOT.areas).map(id => [id, layoutVersion(id)])),
})

function reject(input: PopulationReadinessInput) {
  const result = createValidatedPopulation(input)
  expect(result.ok).toBe(false) // baseline must fail here by admitting the actual invalid input
  expect(result).not.toHaveProperty('state')
  if (result.ok) throw new Error('invalid admission')
  expect(result.issues.length).toBeGreaterThan(0)
  return result.issues
}

describe('review R1/R2 acceptance against b03c437', () => {
  it('admits the unchanged complete scope as dormant state', () => {
    const i = inputs()
    const result = createValidatedPopulation(i)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(JSON.stringify(result.issues))
    expect(Object.keys(result.state.nests)).toHaveLength(i.proposals.length)
    expect(Object.values(result.state.areas).every(a => a.status === 'dormant')).toBe(true)
    expect(Object.values(result.state.nests).every(n => n.alive.length === 0)).toBe(true)
    expect(result.state.lastTickAt).toBeNull()
  })

  it.each(['one-cave-tile', 'one-tile'] as const)('R1 rejects %s without a partial state', probe => {
    const i = inputs()
    const areaId = probe === 'one-cave-tile' ? 'cueva-inicial' : 'pradera'
    const config = { ...i.config, areas: i.config.areas.map(a => a.areaId !== areaId ? a : {
      ...a, nests: a.nests.map((n, j) => j ? n : { ...n, tiles: [n.tiles[0]] }),
    }) }
    const target = config.areas.find(a => a.areaId === areaId)!.nests[0]
    expect(target.tiles).toHaveLength(1)
    expect(target.maxAlive).toBeGreaterThan(1) // no authored limit was changed to hide the defect
    expect(reject({ ...i, config }).some(e => e.code === 'nest-config-mismatch')).toBe(true)
  })

  it('R1 rejects missing-nest against the complete proposals', () => {
    const i = inputs()
    const config = { ...i.config, areas: i.config.areas.map(a => a.areaId !== 'pradera' ? a : { ...a, nests: a.nests.slice(1) }) }
    reject({ ...i, config })
  })

  it('R1 rejects empty-areas against the complete proposals and snapshot', () => {
    const i = inputs()
    reject({ ...i, config: { ...i.config, areas: [] }, currentLayouts: {} })
  })

  it('R2 rejects forged-geometry-current-layout even with a fully matching derived tile set', () => {
    const i = inputs()
    const tile = { tx: -34, ty: -86 }
    const proposal = i.proposals.find(n => n.id === 'pradera-pastizal-oeste')!
    expect(tileRejections(areaView(SNAPSHOT, 'pradera')!, proposal, tile.tx, tile.ty)).toEqual(['blocked'])
    const a = i.snapshot.areas.pradera
    const offset = (tile.tx - a.window.minTx) * 3
    const rows = a.rows.map((row, y) => y !== tile.ty - a.window.minTy ? row : row.slice(0, offset) + '000' + row.slice(offset + 3))
    const snapshot = { ...i.snapshot, areas: { ...i.snapshot.areas, pradera: { ...a, rows } } }
    const config = { ...i.config, areas: i.config.areas.map(area => area.areaId !== 'pradera' ? area : {
      ...area, nests: area.nests.map(n => n.id !== proposal.id ? n : { ...n, tiles: [...n.tiles, tile] }),
    }) }
    // Correct label from an independently imported authoritative module.
    expect(snapshot.areas.pradera.layoutVersion).toBe(i.currentLayouts.pradera)
    const derived = candidatesOf(areaView(snapshot, 'pradera')!, proposal)
    const configured = config.areas.find(a => a.areaId === 'pradera')!.nests.find(n => n.id === proposal.id)!.tiles
    const keys = (tiles: readonly { tx: number; ty: number }[]) => tiles.map(t => `${t.tx},${t.ty}`).sort()
    expect(keys(configured)).toEqual(keys(derived)) // R1 equality alone cannot close R2
    expect(reject({ ...i, snapshot, config }).some(e => e.code === 'geometry-content-mismatch')).toBe(true)
  })
})
