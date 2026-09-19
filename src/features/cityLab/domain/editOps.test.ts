import { describe, expect, it } from 'vitest'
import { HEARTHOME } from '../../wildlands/areas/atlas'
import { TownArea } from '../../wildlands/areas/townArea'
import { CityGrid } from './cityGrid'
import {
  addProp, addWanderer, brushTiles, deleteEntity, duplicateEntity, moveEntity, paintTerrain, setFacing, setSignText,
} from './editOps'
import { isSolidKind } from './labCatalog'
import { deepFreeze, fromTownDef, SPAWN_REF, toTownDef, type EntityRef, type LabCity } from './labCity'
import { LabHistory } from './labHistory'

const baseline = (): LabCity => deepFreeze(fromTownDef(HEARTHOME))
const ok = (result: ReturnType<typeof moveEntity>): LabCity => {
  if (!result.ok) throw new Error(result.errors.join('\n'))
  return result.city
}
const lamp: EntityRef = { type: 'prop', id: 'lamp@28,18' }
const openStreet = { tx: 30, ty: 22 }

describe('baseline and working copy', () => {
  it('mirrors the real town definition, with stable ids', () => {
    const city = baseline()
    expect(city.props).toHaveLength(HEARTHOME.props.length)
    expect(city.props.find(p => p.id === 'lamp@28,18')).toMatchObject({ kind: 'lamp', tx: 28, ty: 18 })
    expect(city.buildings.map(b => b.id)).toContain('pokecenter')
    expect(city.gates.map(g => g.id)).toContain('gate-tundra')
    expect(new Set(city.props.map(p => p.id)).size).toBe(city.props.length)
  })

  it('round-trips to a TownDef that gives the same collision as production', () => {
    const def = toTownDef(baseline(), HEARTHOME)
    const real = new TownArea(HEARTHOME)
    const lab = new TownArea(def)
    for (let ty = 0; ty < real.height; ty++) for (let tx = 0; tx < real.width; tx++) expect(lab.isSolid(tx, ty)).toBe(real.isSolid(tx, ty))
  })

  it('keeps the baseline frozen: edits copy instead of mutating', () => {
    const base = baseline()
    expect(Object.isFrozen(base.props)).toBe(true)
    expect(Object.isFrozen(base.props[0])).toBe(true)
    const snapshot = JSON.stringify(base)
    const moved = ok(moveEntity(HEARTHOME, base, lamp, openStreet))
    const painted = paintTerrain(moved, [{ tx: 30, ty: 25 }], 'g')
    ok(deleteEntity(painted, lamp))
    expect(JSON.stringify(base)).toBe(snapshot)
    expect(moved).not.toBe(base)
    expect(moved.buildings).toBe(base.buildings) // untouched lists are shared
  })

  it('does not touch the production TownDef', () => {
    const before = JSON.stringify(HEARTHOME)
    ok(moveEntity(HEARTHOME, baseline(), { type: 'building', id: 'mart' }, { tx: 28, ty: 21 }))
    expect(JSON.stringify(HEARTHOME)).toBe(before)
  })
})

describe('move', () => {
  it('moves a prop and snaps it to the tile', () => {
    const city = ok(moveEntity(HEARTHOME, baseline(), lamp, openStreet))
    expect(city.props.find(p => p.id === lamp.id)).toMatchObject(openStreet)
    const grid = new CityGrid(city, HEARTHOME)
    expect(grid.solid(openStreet.tx, openStreet.ty)).toBe(true)
    expect(grid.solid(28, 18)).toBe(false)
  })

  it('refuses a prop inside a building, on another prop, out of bounds or on a door', () => {
    const base = baseline()
    expect(moveEntity(HEARTHOME, base, lamp, { tx: 17, ty: 16 }).ok).toBe(false) // Pokémon Center
    expect(moveEntity(HEARTHOME, base, lamp, { tx: 34, ty: 18 }).ok).toBe(false) // another lamp
    expect(moveEntity(HEARTHOME, base, lamp, { tx: -1, ty: 3 }).ok).toBe(false)
    expect(moveEntity(HEARTHOME, base, lamp, { tx: 17, ty: 19 }).ok).toBe(false) // door
    const exit = moveEntity(HEARTHOME, base, lamp, { tx: 17, ty: 20 })
    expect(exit.ok).toBe(false)
    if (!exit.ok) expect(exit.errors.join()).toMatch(/salida/)
  })

  it('moves a building with its door and open tiles, carrying its gate', () => {
    const base = baseline()
    const city = ok(moveEntity(HEARTHOME, base, { type: 'building', id: 'amityL' }, { tx: 9, ty: 1 }))
    const amity = city.buildings.find(b => b.id === 'amityL')!
    expect(amity.x).toBe(9)
    expect(amity.open).toEqual([{ tx: 11, ty: 9 }, { tx: 12, ty: 9 }])
    const gate = city.gates.find(g => g.id === 'gate-tundra')!
    expect(gate.tiles).toEqual([{ tx: 11, ty: 9 }, { tx: 12, ty: 9 }])
    expect(gate.arrival).toMatchObject({ tx: 11, ty: 11 })
    const mart = ok(moveEntity(HEARTHOME, base, { type: 'building', id: 'mart' }, { tx: 28, ty: 21 }))
    expect(mart.buildings.find(b => b.id === 'mart')!.door).toEqual({ tx: 30, ty: 24 })
  })

  it('refuses overlapping buildings', () => {
    const result = moveEntity(HEARTHOME, baseline(), { type: 'building', id: 'house1' }, { tx: 17, ty: 15 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join()).toMatch(/pokecenter/)
  })

  it('validates the spawn: walkable, off portals and with room around it', () => {
    const base = baseline()
    expect(moveEntity(HEARTHOME, base, SPAWN_REF, { tx: 17, ty: 16 }).ok).toBe(false) // building
    expect(moveEntity(HEARTHOME, base, SPAWN_REF, { tx: 10, ty: 9 }).ok).toBe(false) // gate
    expect(moveEntity(HEARTHOME, base, SPAWN_REF, { tx: 0, ty: 0 }).ok).toBe(false) // forest
    const city = ok(moveEntity(HEARTHOME, base, SPAWN_REF, openStreet))
    expect(city.spawn).toMatchObject({ ...openStreet, dir: 'down' })
    expect(setFacing(city, SPAWN_REF, 'left').spawn.dir).toBe('left')
  })

  it('keeps NPCs out of solid tiles', () => {
    const resident: EntityRef = { type: 'resident', id: 'resident-0' }
    expect(moveEntity(HEARTHOME, baseline(), resident, { tx: 16, ty: 16 }).ok).toBe(false)
    expect(ok(moveEntity(HEARTHOME, baseline(), resident, openStreet)).residents[0]).toMatchObject(openStreet)
  })
})

describe('add, delete, duplicate', () => {
  it('adds real props, street and world kinds, with the engine’s solidity', () => {
    const street = addProp(HEARTHOME, baseline(), 'lamp', openStreet)
    expect(street.ok && street.ref).toEqual({ type: 'prop', id: 'new-1' })
    const withLamp = ok(street)
    const rock = ok(addProp(HEARTHOME, withLamp, 'boulder', { tx: 31, ty: 22 }))
    expect(rock.props.find(p => p.id === 'new-2')?.kind).toBe('boulder')
    const grid = new CityGrid(rock, HEARTHOME)
    expect(grid.solid(31, 22)).toBe(isSolidKind('boulder'))
    const crystal = ok(addProp(HEARTHOME, rock, 'crystal', { tx: 32, ty: 22 }))
    expect(new CityGrid(crystal, HEARTHOME).solid(32, 22)).toBe(false)
  })

  it('refuses to add onto an occupied tile', () => {
    expect(addProp(HEARTHOME, baseline(), 'rock', { tx: 28, ty: 18 }).ok).toBe(false)
  })

  it('deletes everything but the spawn', () => {
    const city = ok(deleteEntity(baseline(), lamp))
    expect(city.props.some(p => p.id === lamp.id)).toBe(false)
    expect(deleteEntity(baseline(), SPAWN_REF).ok).toBe(false)
    expect(ok(deleteEntity(baseline(), { type: 'wanderer', id: 'wanderer-0' })).wanderers).toHaveLength(4)
    expect(ok(deleteEntity(baseline(), { type: 'fountain', id: 'fountain-0' })).fountains).toHaveLength(2)
  })

  it('deletes a feature building, warning that its entrance is gone', () => {
    const result = deleteEntity(baseline(), { type: 'building', id: 'pokecenter' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.city.buildings.some(b => b.id === 'pokecenter')).toBe(false)
    expect(result.warnings.join()).toMatch(/ENTRADA a "caja"/)
    // Its footprint is walkable ground now.
    expect(new CityGrid(result.city, HEARTHOME).solid(17, 16)).toBe(false)
  })

  it('deletes a gate building, warning that its portal is left without art', () => {
    const result = deleteEntity(baseline(), { type: 'building', id: 'amityL' })
    expect(result.ok && result.warnings.join()).toMatch(/Tundra/)
  })

  it('deletes an exit (from the portal or from its arrival), warning about the world', () => {
    for (const type of ['gate', 'arrival'] as const) {
      const result = deleteEntity(baseline(), { type, id: 'gate-costa' })
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      expect(result.city.gates.some(g => g.id === 'gate-costa')).toBe(false)
      expect(result.warnings.join()).toMatch(/SALIDA/)
    }
  })

  it('duplicates a building with its door, warning about the second entrance', () => {
    const result = duplicateEntity(HEARTHOME, baseline(), { type: 'building', id: 'mart' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const copy = result.city.buildings.find(b => b.id === 'building-new-1')!
    const mart = result.city.buildings.find(b => b.id === 'mart')!
    expect(copy.feature).toBe('mercado')
    expect(copy.door).toEqual({ tx: mart.door!.tx + copy.x - mart.x, ty: mart.door!.ty + copy.y - mart.y })
    expect(result.warnings.join()).toMatch(/dos puertas/)
  })

  it('duplicates an exit and a fountain', () => {
    const gate = duplicateEntity(HEARTHOME, baseline(), { type: 'gate', id: 'gate-pradera' })
    expect(gate.ok && gate.city.gates.find(g => g.id === 'gate-new-1')?.to).toBe('pradera')
    const fountain = duplicateEntity(HEARTHOME, baseline(), { type: 'fountain', id: 'fountain-1' })
    expect(fountain.ok && fountain.city.fountains).toHaveLength(4)
  })

  it('duplicates onto the nearest valid tile with a fresh id', () => {
    const result = duplicateEntity(HEARTHOME, baseline(), lamp)
    const city = ok(result)
    const copy = city.props.find(p => p.id === 'new-1')!
    expect(copy.kind).toBe('lamp')
    expect(Math.abs(copy.tx - 28) + Math.abs(copy.ty - 18)).toBeLessThanOrEqual(2)
    expect(new CityGrid(city, HEARTHOME).props(copy.tx, copy.ty)).toEqual(['new-1'])
  })

  it('adds wanderers only on walkable ground', () => {
    expect(addWanderer(HEARTHOME, baseline(), { tx: 0, ty: 0 }).ok).toBe(false)
    expect(ok(addWanderer(HEARTHOME, baseline(), openStreet)).wanderers).toHaveLength(6)
  })

  it('edits sign text', () => {
    const id = baseline().props.find(p => p.kind === 'sign')!.id
    expect(setSignText(baseline(), id, 'Hola').props.find(p => p.id === id)?.text).toBe('Hola')
  })
})

describe('terrain', () => {
  it('paints with 1×1 and 3×3 brushes and the engine follows', () => {
    const city = paintTerrain(baseline(), brushTiles(openStreet, 3), 't')
    const grid = new CityGrid(city, HEARTHOME)
    for (const t of brushTiles(openStreet, 3)) expect(grid.solid(t.tx, t.ty)).toBe(true)
    expect(paintTerrain(city, brushTiles(openStreet, 1), 's').terrain[22][30]).toBe('s')
  })

  it('returns the same city when nothing changes', () => {
    const base = baseline()
    expect(paintTerrain(base, [{ tx: 30, ty: 22 }], 's')).toBe(base)
    expect(paintTerrain(base, [{ tx: -4, ty: 2 }], 'g')).toBe(base)
  })
})

describe('undo / redo / reset', () => {
  it('walks back and forth through versions', () => {
    const base = baseline()
    const history = new LabHistory(base)
    const a = ok(moveEntity(HEARTHOME, base, lamp, openStreet))
    history.push(a)
    const b = ok(deleteEntity(a, { type: 'wanderer', id: 'wanderer-0' }))
    history.push(b)
    expect(history.undo()).toBe(a)
    expect(history.undo()).toBe(base)
    expect(history.canUndo).toBe(false)
    expect(history.redo()).toBe(a)
    history.push(paintTerrain(a, [{ tx: 30, ty: 25 }], 'g'))
    expect(history.canRedo).toBe(false)
    history.reset(base)
    expect(history.current).toBe(base)
    expect(history.canUndo).toBe(false)
  })

  it('ignores a no-op push', () => {
    const history = new LabHistory(baseline())
    history.push(history.current)
    expect(history.canUndo).toBe(false)
  })
})
