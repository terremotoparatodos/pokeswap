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

  it('R1 rejects an omitted area even when its layouts and proposals remain', () => {
    const i = inputs()
    expect(reject({ ...i, config: { ...i.config, areas: i.config.areas.slice(1) } }).some(e => e.code === 'area-scope-mismatch')).toBe(true)
  })

  it('R1 rejects a partial area scope across config, proposals and layouts while the snapshot is complete', () => {
    const i = inputs()
    expect(reject({ ...i, config: { ...i.config, areas: i.config.areas.filter(a => a.areaId === 'pradera') },
      proposals: i.proposals.filter(p => p.areaId === 'pradera'), currentLayouts: { pradera: i.currentLayouts.pradera },
    }).some(e => e.code === 'area-scope-mismatch')).toBe(true)
  })

  it('R1 rejects an extra authoritative layout outside the admitted scope', () => {
    const i = inputs()
    expect(reject({ ...i, currentLayouts: { ...i.currentLayouts, outside: 'unrelated' } }).some(e => e.code === 'layout-scope-mismatch')).toBe(true)
  })

  it('R1 rejects an area scope with no proposals and no configuration', () => {
    const i = inputs()
    expect(reject({ ...i, config: { ...i.config, areas: [] }, proposals: [], currentLayouts: {} }).some(e => e.code === 'area-scope-mismatch')).toBe(true)
  })

  it('R1 checks the reverse direction: configured nest without a proposal', () => {
    const i = inputs()
    expect(reject({ ...i, proposals: i.proposals.slice(1) }).some(e => e.code === 'nest-scope-mismatch')).toBe(true)
  })

  it('R1 checks an extra configured nest has no matching proposal', () => {
    const i = inputs()
    const config = { ...i.config, areas: i.config.areas.map((a, j) => j ? a : { ...a, nests: [...a.nests, { ...a.nests[0], id: 'unproposed' }] }) }
    expect(reject({ ...i, config }).some(e => e.code === 'nest-scope-mismatch')).toBe(true)
  })

  it('R1 rejects repeated tiles as well as omitted tiles', () => {
    const i = inputs()
    const config = { ...i.config, areas: i.config.areas.map((a, j) => j ? a : { ...a, nests: a.nests.map((n, k) => k ? n : { ...n, tiles: [...n.tiles.slice(1), n.tiles[1]] }) }) }
    expect(reject({ ...i, config }).some(e => e.code === 'nest-config-mismatch')).toBe(true)
  })

  it('R1 treats tile ordering as irrelevant to set correspondence', () => {
    const i = inputs()
    const config = { ...i.config, areas: [...i.config.areas].reverse().map(a => ({ ...a, nests: [...a.nests].reverse().map(n => ({ ...n, tiles: [...n.tiles].reverse() })) })) }
    expect(createValidatedPopulation({ ...i, config, proposals: [...i.proposals].reverse() }).ok).toBe(true)
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

  it('R2 cannot use a mutated shared JSON object as its own authority reference', () => {
    const i = inputs()
    const a = SNAPSHOT.areas.pradera
    const rowIndex = -86 - a.window.minTy
    const offset = (-34 - a.window.minTx) * 3
    const original = a.rows[rowIndex]
    const rows = a.rows as string[]
    const config = { ...i.config, areas: i.config.areas.map(area => area.areaId !== 'pradera' ? area : {
      ...area, nests: area.nests.map(n => n.id !== 'pradera-pastizal-oeste' ? n : { ...n, tiles: [...n.tiles, { tx: -34, ty: -86 }] }),
    }) }
    try {
      rows[rowIndex] = original.slice(0, offset) + '000' + original.slice(offset + 3)
      // The input and the ordinary imported snapshot now share the SAME forged
      // object. The independent immutable build-text reference must still reject.
      expect(i.snapshot).toBe(SNAPSHOT)
      expect(reject({ ...i, config }).some(e => e.code === 'geometry-content-mismatch')).toBe(true)
    } finally { rows[rowIndex] = original }
  })

  it.each(['bits', 'window', 'entry', 'protected', 'subzones', 'terrainGenerator'] as const)('R2 checks %s content as well as rows', field => {
    const i = inputs()
    const s = structuredClone(i.snapshot)
    const a = s.areas.pradera
    const snapshot = field === 'bits' ? { ...s, bits: { ...s.bits, blocked: 1 } }
      : field === 'terrainGenerator' ? { ...s, terrainGenerator: s.terrainGenerator + 1 }
        : { ...s, areas: { ...s.areas, pradera: { ...a,
          ...(field === 'window' ? { window: { ...a.window, minTx: a.window.minTx - 1 } } : {}),
          ...(field === 'entry' ? { entry: { ...a.entry, tx: a.entry.tx + 1 } } : {}),
          ...(field === 'protected' ? { protected: [] } : {}),
          ...(field === 'subzones' ? { subzones: [] } : {}),
        } } }
    expect(reject({ ...i, snapshot }).some(e => e.code === 'geometry-content-mismatch')).toBe(true)
  })

  it('R2 accepts identical independent content with a different object property order', () => {
    const i = inputs()
    const s = structuredClone(i.snapshot)
    const snapshot = { areas: s.areas, bits: s.bits, terrainGenerator: s.terrainGenerator, generatedBy: s.generatedBy }
    expect(createValidatedPopulation({ ...i, snapshot }).ok).toBe(true)
  })
})
