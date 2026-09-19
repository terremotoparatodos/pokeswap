// Buildings from scratch: templates, placement, inspector edits and the patch.

import { describe, expect, it } from 'vitest'
import { HEARTHOME, LOBBY_ID } from '../../wildlands/areas/atlas'
import { TownArea } from '../../wildlands/areas/townArea'
import type { Tile } from '../../wildlands/engine/pathfinding'
import { BUILDING_TEMPLATES, buildingOrigin, buildingTemplate, templateOf } from './buildingCatalog'
import { applyPatch, diffCities, parsePatch, serializePatch } from './cityPatch'
import { addBuilding, editBuilding, previewAddBuilding, type EditResult } from './editOps'
import { deepFreeze, fromTownDef, toTownDef, type LabCity } from './labCity'
import { validateMap } from './validateMap'

const baseline = (): LabCity => deepFreeze(fromTownDef(HEARTHOME))
const ok = (result: EditResult): LabCity => {
  if (!result.ok) throw new Error(result.errors.join('\n'))
  return result.city
}

const spots = new Map<string, Tile>()

/**
 * The first cursor tile (row by row, from the city centre down) where a
 * template fits on the baseline cleanly, with walkable ground below its whole
 * front. Memoised: each probe builds a whole grid.
 */
function freeSpot(city: LabCity, templateId: string, clean = true): Tile {
  const key = `${templateId}|${clean}`
  const known = spots.get(key)
  if (known) return known
  const area = new TownArea(toTownDef(city, HEARTHOME))
  const w = buildingTemplate(templateId)!.w
  for (let ty = 20; ty < city.terrain.length; ty++) {
    for (let tx = 0; tx < city.terrain[0].length; tx++) {
      const { x } = buildingOrigin({ w, d: 1 }, { tx, ty })
      const front = Array.from({ length: w }, (_, i) => !area.isSolid(x + i, ty + 1)).every(Boolean)
      const result = addBuilding(HEARTHOME, city, templateId, { tx, ty })
      if (result.ok && (!clean || (front && !result.warnings.length))) {
        spots.set(key, { tx, ty })
        return { tx, ty }
      }
    }
  }
  throw new Error(`no room for ${templateId}`)
}

describe('building templates', () => {
  it('offer every hand-drawn building of the city once, plus a painted block per style', () => {
    const art = BUILDING_TEMPLATES.filter(t => t.group === 'art')
    const pngs = new Set(HEARTHOME.buildings.map(b => b.image!.src))
    expect(art.map(t => t.image!.src).sort()).toEqual([...pngs].sort())
    expect(BUILDING_TEMPLATES.filter(t => t.group === 'block').map(t => t.style)).toContain('house')
    expect(new Set(BUILDING_TEMPLATES.map(t => t.id)).size).toBe(BUILDING_TEMPLATES.length)
  })

  it('copy the source building’s footprint, roof line and stairs, but never its function', () => {
    const gate = buildingTemplate('art:amity-gate')!
    expect(gate).toMatchObject({ w: 6, d: 9, image: { flatTop: 'all' }, open: [{ tx: 2, ty: 8 }, { tx: 3, ty: 8 }] })
    for (const t of BUILDING_TEMPLATES) expect(t).not.toHaveProperty('feature')
  })

  it('put the cursor on the middle of the bottom row', () => {
    expect(buildingOrigin({ w: 5, d: 4 }, { tx: 20, ty: 30 })).toEqual({ x: 18, y: 27 })
  })

  it('recognise a building’s look', () => {
    const center = HEARTHOME.buildings.find(b => b.id === 'pokecenter')!
    expect(templateOf(center)?.id).toBe('art:pokecenter')
    expect(templateOf({ style: 'gym' })?.id).toBe('block:gym')
  })
})

describe('adding a building', () => {
  it('places a template on free ground, with a new id and no function', () => {
    const base = baseline()
    const at = freeSpot(base, 'art:house-green')
    const result = addBuilding(HEARTHOME, base, 'art:house-green', at)
    const city = ok(result)
    const b = city.buildings.find(x => x.id === 'building-new-1')!
    expect(b).toMatchObject({ style: 'house', w: 4, d: 5, name: 'Edificio nuevo', image: { src: '/assets/town/house-green.png' } })
    expect(b.feature).toBeUndefined()
    expect(b.door).toBeUndefined()
    // The real engine makes its footprint solid.
    const area = new TownArea(toTownDef(city, HEARTHOME))
    expect(area.isSolid(b.x, b.y)).toBe(true)
    expect(area.isSolid(b.x + b.w - 1, b.y + b.d - 1)).toBe(true)
  })

  it('refuses a spot on top of another building and says why', () => {
    const result = addBuilding(HEARTHOME, baseline(), 'art:mart', { tx: 17, ty: 19 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/superpone con "pokecenter"/)
  })

  it('refuses a building that would stick out of the map', () => {
    expect(addBuilding(HEARTHOME, baseline(), 'art:gym', { tx: 1, ty: 2 }).ok).toBe(false)
  })

  it('previews the whole footprint, solid except the stairs', () => {
    const base = baseline()
    const at = freeSpot(base, 'art:amity-gate', false)
    const p = previewAddBuilding(HEARTHOME, base, 'art:amity-gate', at)
    expect(p.valid).toBe(true)
    expect(p.tiles).toHaveLength(6 * 9)
    expect(p.solid).toHaveLength(6 * 9 - 2)
  })
})

describe('editing a building', () => {
  const add = (templateId = 'block:house') => {
    const base = baseline()
    return ok(addBuilding(HEARTHOME, base, templateId, freeSpot(base, templateId)))
  }
  const id = 'building-new-1'

  it('renames it and sets what it says', () => {
    const city = ok(editBuilding(HEARTHOME, add(), id, { name: 'Biblioteca', blurb: 'Huele a libros viejos.' }))
    expect(city.buildings.find(b => b.id === id)).toMatchObject({ name: 'Biblioteca', blurb: 'Huele a libros viejos.' })
  })

  it('turns it into an ENTRANCE: a function adds a door, and warns about a second entrance', () => {
    const result = editBuilding(HEARTHOME, add(), id, { feature: 'mercado' })
    const city = ok(result)
    const b = city.buildings.find(x => x.id === id)!
    expect(b.feature).toBe('mercado')
    expect(b.door).toEqual({ tx: b.x + 2, ty: b.y + b.d - 1 })
    expect(result.ok && result.warnings.join(' ')).toMatch(/ya tiene ENTRADA en Tienda/)
    // The real engine: the door tile is walkable and entering it opens the Mercado.
    const area = new TownArea(toTownDef(city, HEARTHOME))
    expect(area.isSolid(b.door!.tx, b.door!.ty)).toBe(false)
    expect(area.doors.find(d => d.buildingId === id)?.feature).toBe('mercado')
    expect(validateMap(city, HEARTHOME).map(f => f.code)).toContain('ENTRANCE_DUPLICATED')
  })

  it('moves or removes the door, warning when a function is left without one', () => {
    let city = ok(editBuilding(HEARTHOME, add(), id, { feature: 'swap' }))
    city = ok(editBuilding(HEARTHOME, city, id, { doorColumn: 0 }))
    const b = city.buildings.find(x => x.id === id)!
    expect(b.door).toEqual({ tx: b.x, ty: b.y + b.d - 1 })
    const result = editBuilding(HEARTHOME, city, id, { doorColumn: null })
    expect(result.ok && result.warnings.join(' ')).toMatch(/no tiene puerta/)
    expect(validateMap(ok(result), HEARTHOME).map(f => f.code)).toContain('ENTRANCE_WITHOUT_DOOR')
    expect(editBuilding(HEARTHOME, city, id, { doorColumn: 99 }).ok).toBe(false)
  })

  it('resizes a painted block keeping its front row, and refuses sizes outside the limits', () => {
    const before = add().buildings.find(b => b.id === id)!
    const city = ok(editBuilding(HEARTHOME, add(), id, { w: 3, d: 2 }))
    const b = city.buildings.find(x => x.id === id)!
    expect(b).toMatchObject({ x: before.x, w: 3, d: 2 })
    expect(b.y + b.d).toBe(before.y + before.d)
    expect(editBuilding(HEARTHOME, city, id, { w: 0 }).ok).toBe(false)
    expect(editBuilding(HEARTHOME, city, id, { d: 13 }).ok).toBe(false)
  })

  it('swaps the look: a drawing brings its size, standing on the same bottom row', () => {
    const before = add().buildings.find(b => b.id === id)!
    const city = ok(editBuilding(HEARTHOME, add(), id, { template: 'art:mart' }))
    const b = city.buildings.find(x => x.id === id)!
    expect(b).toMatchObject({ style: 'mart', w: 4, d: 4, image: { src: '/assets/town/mart.png' } })
    expect(b.y + b.d).toBe(before.y + before.d)
    const back = ok(editBuilding(HEARTHOME, city, id, { template: 'block:gym' }))
    expect(back.buildings.find(x => x.id === id)!.image).toBeUndefined()
  })

  it('can edit the city’s own buildings too (name, function, look)', () => {
    const result = editBuilding(HEARTHOME, baseline(), 'pokecenter', { feature: null, name: 'Centro viejo' })
    expect(result.ok && result.warnings.join(' ')).toMatch(/Mi caja" queda sin ENTRADA/)
  })
})

describe('the patch', () => {
  it('exports a new building as a full record and imports it back byte-identical', () => {
    const base = baseline()
    let city = ok(addBuilding(HEARTHOME, base, 'art:poffin', freeSpot(base, 'art:poffin')))
    city = ok(editBuilding(HEARTHOME, city, 'building-new-1', { name: 'Museo', feature: 'pokedex', blurb: 'Fósiles.' }))
    const patch = diffCities(base, city, LOBBY_ID)
    expect(patch.version).toBe(3)
    expect(patch.buildings.added).toHaveLength(1)
    expect(patch.buildings.added[0]).toMatchObject({ id: 'building-new-1', name: 'Museo', feature: 'pokedex', style: 'redhouse', image: { src: '/assets/town/poffin.png' } })
    const text = serializePatch(patch)
    const parsed = parsePatch(text)
    const back = parsed.ok ? applyPatch(base, parsed.value) : null
    expect(back?.ok).toBe(true)
    if (back?.ok) expect(serializePatch(diffCities(base, back.city, LOBBY_ID))).toBe(text)
  })

  it('records edits to a baseline building in buildings.modified and applies them', () => {
    const base = baseline()
    const city = ok(editBuilding(HEARTHOME, base, 'house1', { name: 'Casa de la abuela', feature: 'perfil', template: 'block:house' }))
    const patch = diffCities(base, city, LOBBY_ID)
    expect(patch.buildings.modified).toEqual([expect.objectContaining({ id: 'house1', to: expect.objectContaining({ name: 'Casa de la abuela', feature: 'perfil' }) })])
    expect(patch.buildings.modified[0].to.image).toBeUndefined()
    const back = applyPatch(base, JSON.parse(serializePatch(patch)))
    expect(back.ok && back.conflicts).toEqual([])
    if (back.ok) expect(serializePatch(diffCities(base, back.city, LOBBY_ID))).toBe(serializePatch(patch))
  })

  it('still imports v2 patches, which have no buildings.modified', () => {
    const base = baseline()
    const v2 = JSON.parse(serializePatch(diffCities(base, base, LOBBY_ID)))
    v2.version = 2
    delete v2.buildings.modified
    expect(applyPatch(base, v2).ok).toBe(true)
  })
})
