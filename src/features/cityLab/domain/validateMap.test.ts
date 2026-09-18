import { describe, expect, it } from 'vitest'
import { HEARTHOME } from '../../wildlands/areas/atlas'
import { CityGrid } from './cityGrid'
import { clearanceMap, MAX_CLEARANCE } from './clearance'
import { paintTerrain, brushTiles } from './editOps'
import { deepFreeze, fromTownDef, type LabCity } from './labCity'
import { countBySeverity, validateMap } from './validateMap'

const baseline = (): LabCity => deepFreeze(fromTownDef(HEARTHOME))
const codes = (city: LabCity) => validateMap(city, HEARTHOME).map(f => f.code)

describe('Validate Map on the current city', () => {
  it('finds no errors in the baseline, only QA warnings', () => {
    const findings = validateMap(baseline(), HEARTHOME)
    expect(countBySeverity(findings).error).toBe(0)
    expect(findings.length).toBeGreaterThan(0)
  })

  it('flags the forest tree drawn over a walkable tile', () => {
    const canopy = validateMap(baseline(), HEARTHOME).find(f => f.code === 'CANOPY_OVER_WALKABLE')
    expect(canopy?.tiles).toContainEqual({ tx: 36, ty: 7 })
  })

  it('is deterministic', () => {
    expect(validateMap(baseline(), HEARTHOME)).toEqual(validateMap(baseline(), HEARTHOME))
  })
})

describe('Validate Map on broken copies', () => {
  it('reports an invalid spawn', () => {
    const city: LabCity = { ...baseline(), spawn: { tx: 17, ty: 16, dir: 'down' } }
    expect(codes(city)).toContain('SPAWN_INVALID')
  })

  it('reports an NPC standing inside something solid', () => {
    const base = baseline()
    const city: LabCity = { ...base, residents: base.residents.map((r, i) => (i === 0 ? { ...r, tx: 16, ty: 16 } : r)) }
    expect(validateMap(city, HEARTHOME).find(f => f.code === 'NPC_INVALID')?.ref).toEqual({ type: 'resident', id: 'resident-0' })
  })

  it('reports two objects stacked on one tile', () => {
    const base = baseline()
    const city: LabCity = { ...base, props: [...base.props, { id: 'new-1', kind: 'rock', tx: 28, ty: 18 }] }
    expect(codes(city)).toContain('PROP_CONFLICT')
  })

  it('reports a building whose door can no longer be reached, and the path to a gate cut off', () => {
    // Wall off the Tienda's doorstep, then the north-west gate's approach.
    const walled = paintTerrain(baseline(), brushTiles({ tx: 30, ty: 31 }, 3), 't')
    const doorBlocked = paintTerrain(walled, [{ tx: 29, ty: 30 }, { tx: 30, ty: 30 }, { tx: 31, ty: 30 }], 't')
    expect(codes(doorBlocked)).toContain('BUILDING_UNREACHABLE')
    const gateCut = paintTerrain(baseline(), [{ tx: 10, ty: 10 }, { tx: 11, ty: 10 }, { tx: 9, ty: 10 }, { tx: 12, ty: 10 }, { tx: 8, ty: 10 }, { tx: 13, ty: 10 }], 't')
    expect(codes(gateCut)).toContain('GATE_UNREACHABLE')
  })

  it('reports a walkable area cut off from the spawn', () => {
    // A ring of forest around an open square in the middle of the fountain plaza.
    const ring = brushTiles({ tx: 38, ty: 38 }, 5).filter(t => Math.abs(t.tx - 38) === 2 || Math.abs(t.ty - 38) === 2)
    expect(codes(paintTerrain(baseline(), ring, 't'))).toContain('AREA_DISCONNECTED')
  })

  it('flags solid-looking objects that are walked through', () => {
    const base = baseline()
    const city: LabCity = { ...base, props: [...base.props, { id: 'new-1', kind: 'crystal', tx: 30, ty: 22 }] }
    expect(codes(city)).toContain('PROP_NOT_SOLID')
  })
})

describe('multiplayer clearance', () => {
  it('scores corridors by how many fit side by side', () => {
    const grid = new CityGrid(baseline(), HEARTHOME)
    const map = clearanceMap(grid)
    const at = (tx: number, ty: number) => map[ty * grid.width + tx]
    expect(at(0, 0)).toBe(0) // forest
    expect(at(20, 14)).toBe(1) // the lane between the fence and the Pokémon Center
    expect(at(31, 22)).toBe(MAX_CLEARANCE) // the main street
  })
})
