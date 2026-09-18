// Placed city trees in the Mapping Lab: placement, collision, validation,
// patch round trip and history. The assets themselves are tested in
// worldAssets/trees.

import { describe, expect, it } from 'vitest'
import { HEARTHOME, LOBBY_ID } from '../../wildlands/areas/atlas'
import { CITY_TREE_ASSETS, treeCollisionTiles, treeFeet } from '../../worldAssets/trees/cityTrees'
import { showcaseTown, wildShowcaseTrees } from '../world/treeShowcase'
import { applyPatch, diffCities, parsePatch, serializePatch } from './cityPatch'
import { CityGrid } from './cityGrid'
import { clearanceMap } from './clearance'
import { addAnchor, addProp, deleteEntity, duplicateEntity, moveEntity, previewAdd } from './editOps'
import { collisionTilesOf, deepFreeze, fromTownDef, labDecor, labTrees, tilesOf, type LabCity } from './labCity'
import { LabHistory } from './labHistory'
import { validateMap } from './validateMap'

const baseline = (): LabCity => deepFreeze(fromTownDef(HEARTHOME))
const ok = (r: { ok: true; city: LabCity } | { ok: false; errors: readonly string[] }): LabCity => {
  if (!r.ok) throw new Error(r.errors.join('\n'))
  return r.city
}
/** Open street south of the spawn: row 22–24 around x 30–40 is plain paving. */
const PLOT = { tx: 34, ty: 23 }

describe('placing a city tree', () => {
  it('puts the trunk under the cursor and the 2×2 cell above it', () => {
    expect(addAnchor('city-tree-round', PLOT)).toEqual({ tx: 34, ty: 22 })
    expect(addAnchor('lamp', PLOT)).toEqual(PLOT)
    const city = ok(addProp(HEARTHOME, baseline(), 'city-tree-round', PLOT))
    const tree = city.props.find(p => p.id === 'new-1')!
    expect(tree).toMatchObject({ kind: 'city-tree-round', tx: 34, ty: 22 })
    expect(tilesOf(city, { type: 'prop', id: 'new-1' })).toHaveLength(4)
    expect(collisionTilesOf(city, { type: 'prop', id: 'new-1' })).toEqual([{ tx: 34, ty: 23 }, { tx: 35, ty: 23 }])
  })

  it('blocks only the trunk row: the crown row stays walkable', () => {
    const city = ok(addProp(HEARTHOME, baseline(), 'city-tree-pointed', PLOT))
    const grid = new CityGrid(city, HEARTHOME)
    expect(grid.solid(34, 23)).toBe(true)
    expect(grid.solid(35, 23)).toBe(true)
    expect(grid.solid(34, 22)).toBe(false)
    expect(grid.solid(35, 22)).toBe(false)
  })

  it('previews the visual cell, the trunk and validity before placing', () => {
    const good = previewAdd(HEARTHOME, baseline(), 'city-tree-pointed', PLOT)
    expect(good).toMatchObject({ valid: true })
    expect(good.tiles).toHaveLength(4)
    expect(good.solid).toEqual([{ tx: 34, ty: 23 }, { tx: 35, ty: 23 }])
    expect(previewAdd(HEARTHOME, baseline(), 'city-tree-pointed', { tx: 17, ty: 20 }).valid).toBe(false)
  })

  it('refuses a trunk on a door exit, a portal, the spawn, a building or another trunk', () => {
    const base = baseline()
    expect(addProp(HEARTHOME, base, 'city-tree-round', { tx: 17, ty: 20 }).ok).toBe(false) // Pokémon Center exit
    expect(addProp(HEARTHOME, base, 'city-tree-round', { tx: 10, ty: 9 }).ok).toBe(false) // Tundra portal
    expect(addProp(HEARTHOME, base, 'city-tree-round', { tx: 30, ty: 20 }).ok).toBe(false) // trunk covers the spawn (31, 20)
    expect(addProp(HEARTHOME, base, 'city-tree-round', { tx: 16, ty: 17 }).ok).toBe(false) // inside the Pokémon Center
    const one = ok(addProp(HEARTHOME, base, 'city-tree-round', PLOT))
    expect(addProp(HEARTHOME, one, 'city-tree-pointed', { tx: 35, ty: 23 }).ok).toBe(false)
  })

  it('lets crowns overlap: a tree behind another, and side by side', () => {
    let city = ok(addProp(HEARTHOME, baseline(), 'city-tree-pointed', PLOT))
    city = ok(addProp(HEARTHOME, city, 'city-tree-round', { tx: 36, ty: 23 })) // cells touch
    city = ok(addProp(HEARTHOME, city, 'city-tree-pointed-lit', { tx: 35, ty: 22 })) // its trunk under their crowns
    expect(labTrees(city)).toHaveLength(3)
    const codes = validateMap(city, HEARTHOME).map(f => f.code)
    expect(codes).not.toContain('TREE_TRUNK_CONFLICT')
  })

  it('moves, duplicates and deletes like any prop', () => {
    const one = ok(addProp(HEARTHOME, baseline(), 'city-tree-round', PLOT))
    const moved = ok(moveEntity(HEARTHOME, one, { type: 'prop', id: 'new-1' }, { tx: 38, ty: 22 }))
    expect(moved.props.find(p => p.id === 'new-1')).toMatchObject({ tx: 38, ty: 22 })
    expect(moveEntity(HEARTHOME, one, { type: 'prop', id: 'new-1' }, { tx: 16, ty: 16 }).ok).toBe(false)
    const twice = ok(duplicateEntity(HEARTHOME, moved, { type: 'prop', id: 'new-1' }))
    const copy = twice.props.find(p => p.id === 'new-2')!
    expect(copy.kind).toBe('city-tree-round')
    // The copy's trunk never lands on the original's.
    const trunks = [...treeCollisionTiles('city-tree-round', 38, 22), ...treeCollisionTiles('city-tree-round', copy.tx, copy.ty)]
    expect(new Set(trunks.map(t => `${t.tx},${t.ty}`)).size).toBe(4)
    expect(ok(deleteEntity(twice, { type: 'prop', id: 'new-1' })).props.some(p => p.id === 'new-1')).toBe(false)
  })

  it('warns when a tree disappears into the forest', () => {
    // (0, 1) is forest in all four cells of a 2×2 block: indistinguishable from the generated trees.
    const hidden = addProp(HEARTHOME, baseline(), 'city-tree-round', { tx: 0, ty: 1 })
    expect(hidden.ok).toBe(true)
    if (hidden.ok) expect(hidden.warnings.join()).toMatch(/dentro del bosque/)
    if (hidden.ok) expect(validateMap(hidden.city, HEARTHOME).map(f => f.code)).toContain('TREE_HIDDEN')
  })

  it('counts only the trunk for multiplayer width', () => {
    const city = ok(addProp(HEARTHOME, baseline(), 'city-tree-round', PLOT))
    const grid = new CityGrid(city, HEARTHOME)
    const map = clearanceMap(grid)
    expect(map[23 * grid.width + 34]).toBe(0) // trunk
    expect(map[22 * grid.width + 34]).toBeGreaterThan(1) // under the crown there is room
  })
})

describe('forest generated vs placed', () => {
  it('never touches the forest: terrain and baseline stay as they were', () => {
    const base = baseline()
    const terrain = JSON.stringify(base.terrain)
    const city = ok(addProp(HEARTHOME, base, 'city-tree-round', PLOT))
    expect(JSON.stringify(city.terrain)).toBe(terrain)
    expect(JSON.stringify(base.terrain)).toBe(terrain)
    expect(city.terrain).toBe(base.terrain)
  })

  it('keeps placed trees apart from world props and from the forest', () => {
    let city = ok(addProp(HEARTHOME, baseline(), 'city-tree-round', PLOT))
    city = ok(addProp(HEARTHOME, city, 'boulder', { tx: 30, ty: 22 }))
    expect(labTrees(city).map(p => p.id)).toEqual(['new-1'])
    expect(labDecor(city).map(p => p.id)).toEqual(['new-2'])
    const grid = new CityGrid(city, HEARTHOME)
    expect(grid.area.trees).toEqual([{ id: 'new-1', kind: 'city-tree-round', tx: 34, ty: 22 }])
  })
})

describe('patch', () => {
  it('references the canonical asset, never pixels, and flags the schema gap', () => {
    const city = ok(addProp(HEARTHOME, baseline(), 'city-tree-pointed-lit', PLOT))
    const patch = diffCities(baseline(), city, LOBBY_ID)
    expect(patch.props.added).toEqual([{ id: 'new-1', kind: 'city-tree-pointed-lit', tx: 34, ty: 22, footprint: { w: 2, d: 2 } }])
    expect(patch.requiresProductionSchemaSupport).toBe(true)
    expect(patch.notes.join()).toMatch(/árbol/)
    expect(diffCities(baseline(), baseline(), LOBBY_ID).requiresProductionSchemaSupport).toBe(false)
  })

  it('round-trips place → export → reset → import byte-identically', () => {
    const base = baseline()
    let city = ok(addProp(HEARTHOME, base, 'city-tree-pointed', PLOT))
    city = ok(addProp(HEARTHOME, city, 'city-tree-round', { tx: 36, ty: 23 }))
    city = ok(duplicateEntity(HEARTHOME, city, { type: 'prop', id: 'new-2' }))
    const text = serializePatch(diffCities(base, city, LOBBY_ID))
    const parsed = parsePatch(text)
    const applied = applyPatch(base, parsed.ok ? parsed.value : null)
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(serializePatch(diffCities(base, applied.city, LOBBY_ID))).toBe(text)
    expect(labTrees(applied.city).map(t => [t.kind, t.tx, t.ty])).toEqual(labTrees(city).map(t => [t.kind, t.tx, t.ty]))
  })
})

describe('history', () => {
  it('undoes and redoes add, move, duplicate and delete of trees', () => {
    const base = baseline()
    const h = new LabHistory(base)
    const added = ok(addProp(HEARTHOME, base, 'city-tree-round', PLOT)); h.push(added)
    const moved = ok(moveEntity(HEARTHOME, added, { type: 'prop', id: 'new-1' }, { tx: 38, ty: 22 })); h.push(moved)
    const dup = ok(duplicateEntity(HEARTHOME, moved, { type: 'prop', id: 'new-1' })); h.push(dup)
    const del = ok(deleteEntity(dup, { type: 'prop', id: 'new-1' })); h.push(del)
    expect(h.undo()).toBe(dup)
    expect(h.undo()).toBe(moved)
    expect(h.undo()).toBe(added)
    expect(h.undo()).toBe(base)
    expect(h.redo()).toBe(added)
    expect(h.redo()).toBe(moved)
  })
})

describe('comparison scenes', () => {
  it('show every asset placed next to forest-generated trees of every variant', () => {
    const scene = showcaseTown()
    for (const asset of CITY_TREE_ASSETS) expect(scene.trees.some(t => t.kind === asset.id)).toBe(true)
    const forestLabels = scene.labels.filter(l => l.text.startsWith('F·')).map(l => l.text)
    expect(new Set(forestLabels).size).toBe(3)
    // Forest blocks sit on even rows, like the city grid TownArea walks.
    for (const t of scene.trees) expect(t.ty % 2).toBe(0)
  })

  it('stand the very same assets in WildLands with the city’s own feet formula', () => {
    const trees = wildShowcaseTrees({ tx: 100, ty: 80 })
    expect(new Set(trees.map(t => t.kind))).toEqual(new Set(CITY_TREE_ASSETS.map(a => a.id)))
    const first = trees[0]
    const feet = treeFeet(93, 75)
    expect({ x: first.x, y: first.y }).toEqual(feet)
  })
})
