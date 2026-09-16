import { describe, expect, it } from 'vitest'
import { WORLDS } from '../../wildlands/areas/atlas'
import { World } from '../../wildlands/engine/world'
import { PRADERA_SEED, PRADERA_SPAWN } from '../demo/praderaLandmarks'
import { nodeAt, worldNodePort } from '../domain/nodePlacement'
import type { Inventory } from '../domain/types'
import { bottlesBetween, brewPose, brewTimeline, loadsBetween, MAX_BOTTLE_PULSES } from './brewTimeline'
import { alchemyBrowser, ALCHEMY_RECIPES, alchemyRecipeView, originOf, recipeLabel } from './recipeBrowser'
import { alchemyStationTile, besideStation } from './stationPlacement'

const PANTRY: Inventory = {
  oran_berry: 10, medicinal_herb: 6, seaweed: 4, vial: 8, sitrus_berry: 4, leppa_berry: 4,
  revival_herb: 2, wild_essence: 1, heart_scale: 1, fish_oil: 2, herbal_extract: 3,
}

describe('brew timeline', () => {
  it('runs load → heat → boil → bottle → reward', () => {
    const timeline = brewTimeline(5, 1)
    expect(brewPose(timeline, 0).phase).toBe('load')
    expect(brewPose(timeline, timeline.loadAtMs + 10).phase).toBe('heat')
    expect(brewPose(timeline, timeline.heatAtMs + 10).phase).toBe('boil')
    expect(brewPose(timeline, timeline.bottleAtMs + 10).phase).toBe('bottle')
    expect(brewPose(timeline, timeline.resultAtMs + 10).phase).toBe('reward')
    expect(brewPose(timeline, timeline.totalMs + 1).phase).toBe('done')
  })

  it('fills the flask while loading and empties it while bottling', () => {
    const timeline = brewTimeline(5, 4)
    expect(brewPose(timeline, 0).fill).toBeLessThan(brewPose(timeline, timeline.loadAtMs).fill)
    expect(brewPose(timeline, timeline.heatAtMs + 10).fill).toBe(1)
    const early = brewPose(timeline, timeline.bottleAtMs + 10).fill
    const late = brewPose(timeline, timeline.resultAtMs - 10).fill
    expect(late).toBeLessThan(early)
  })

  it('caps the ceremony so a big batch still ends, and counts every unit', () => {
    const big = brewTimeline(8, 40)
    expect(big.pulses).toBe(MAX_BOTTLE_PULSES)
    expect(big.totalMs).toBeLessThan(brewTimeline(8, 1).totalMs + 4000)
    expect(brewPose(big, big.totalMs + 1).bottled).toBe(40)
    expect(bottlesBetween(big, 0, big.totalMs)).toHaveLength(MAX_BOTTLE_PULSES)
  })

  it('drops one ingredient at a time while loading', () => {
    const timeline = brewTimeline(5, 1)
    expect(loadsBetween(timeline, 3, 0, timeline.loadAtMs)).toHaveLength(3)
    expect(loadsBetween(timeline, 3, timeline.loadAtMs, timeline.totalMs)).toHaveLength(0)
  })
})

describe('recipe browser', () => {
  it('reads every brewing recipe from the R31-A catalog, and only those', () => {
    expect(ALCHEMY_RECIPES.length).toBeGreaterThanOrEqual(8)
    expect(ALCHEMY_RECIPES.every(recipe => recipe.profession === 'alchemy')).toBe(true)
    // The bench brews; it does not build itself.
    expect(ALCHEMY_RECIPES.some(recipe => recipe.id === 'build_alchemy_table')).toBe(false)
  })

  it('tells apart two recipes that make the same item', () => {
    const essence = ALCHEMY_RECIPES.find(recipe => recipe.id === 'brew_revive')!
    const scale = ALCHEMY_RECIPES.find(recipe => recipe.id === 'brew_revive_scale')!
    const a = recipeLabel(essence)
    const b = recipeLabel(scale)
    expect(a).not.toBe(b)
    expect(a).toContain('Revivir')
    expect(b).toContain('Revivir')
  })

  it('says where each ingredient comes from', () => {
    expect(originOf('oran_berry')).toBe('alchemy')
    expect(originOf('vial')).toBe('mining')
    expect(originOf('fish_oil')).toBe('fishing')
    expect(originOf('wild_essence')).toBe('pve')
  })

  it('separates ready, missing and locked, and names what is short', () => {
    const potion = ALCHEMY_RECIPES.find(recipe => recipe.id === 'brew_potion')!
    const ready = alchemyRecipeView(potion, PANTRY, 10)
    expect(ready.availability).toBe('ready')
    expect(ready.block.kind).toBe('none')
    expect(ready.maxCraftable).toBe(5)

    const empty = alchemyRecipeView(potion, { oran_berry: 1 }, 10)
    expect(empty.availability).toBe('missing')
    expect(empty.block.kind).toBe('missing')
    if (empty.block.kind === 'missing') {
      expect(empty.block.items.map(item => item.itemId)).toContain('vial')
      expect(empty.block.text).toMatch(/falta/i)
    }

    const locked = alchemyRecipeView(ALCHEMY_RECIPES.find(recipe => recipe.id === 'brew_revive')!, PANTRY, 1)
    expect(locked.availability).toBe('locked')
    expect(locked.block.kind).toBe('level')
  })

  it('scales the ingredient cost with the batch', () => {
    const potion = ALCHEMY_RECIPES.find(recipe => recipe.id === 'brew_potion')!
    const four = alchemyRecipeView(potion, PANTRY, 10, 4)
    const oran = four.ingredients.find(ingredient => ingredient.itemId === 'oran_berry')!
    expect(oran.need).toBe(8)
    expect(oran.have).toBe(10)
    expect(oran.missing).toBe(0)
  })

  it('sorts what I can make first and suggests one of them', () => {
    const views = alchemyBrowser(PANTRY, 12)
    expect(views[0].availability).toBe('ready')
    const suggested = views.filter(view => view.recommended)
    expect(suggested).toHaveLength(1)
    expect(suggested[0].availability).toBe('ready')
    // Nothing is suggested when nothing can be made.
    expect(alchemyBrowser({}, 1).some(view => view.recommended)).toBe(false)
  })
})

describe('station placement', () => {
  const world = new World(PRADERA_SEED)
  const port = worldNodePort(world)
  const worldPort = {
    isSolid: (tx: number, ty: number) => world.isSolid(tx, ty),
    isWater: (tx: number, ty: number) => world.isWater(tx, ty),
    hasNode: (tx: number, ty: number) => nodeAt(port, tx, ty) !== null,
  }

  it('derives a clearing near the world spawn, free on every side and off the gate', () => {
    const tile = alchemyStationTile(worldPort, PRADERA_SPAWN)!
    expect(tile).not.toBeNull()
    // Never on the spawn itself: that tile is the gate back to the town.
    expect(Math.max(Math.abs(tile.tx - PRADERA_SPAWN.tx), Math.abs(tile.ty - PRADERA_SPAWN.ty))).toBeGreaterThanOrEqual(4)
    expect(worldPort.isSolid(tile.tx, tile.ty)).toBe(false)
    expect(worldPort.isWater(tile.tx, tile.ty)).toBe(false)
    expect(worldPort.hasNode(tile.tx, tile.ty)).toBe(false)
    for (const side of besideStation(tile)) {
      expect(worldPort.isSolid(side.tx, side.ty), `${side.tx},${side.ty}`).toBe(false)
      expect(worldPort.isWater(side.tx, side.ty)).toBe(false)
    }
  })

  it('is deterministic: the same world always puts the bench on the same tile', () => {
    const again = new World(PRADERA_SEED)
    const other = worldNodePort(again)
    const tile = alchemyStationTile(worldPort, PRADERA_SPAWN)
    const twin = alchemyStationTile({
      isSolid: (tx, ty) => again.isSolid(tx, ty),
      isWater: (tx, ty) => again.isWater(tx, ty),
      hasNode: (tx, ty) => nodeAt(other, tx, ty) !== null,
    }, PRADERA_SPAWN)
    expect(twin).toEqual(tile)
  })

  it('works for every wild world of the atlas, not only Pradera', () => {
    for (const definition of WORLDS) {
      const other = new World(definition.seed)
      const otherPort = worldNodePort(other)
      const tile = alchemyStationTile({
        isSolid: (tx, ty) => other.isSolid(tx, ty),
        isWater: (tx, ty) => other.isWater(tx, ty),
        hasNode: (tx, ty) => nodeAt(otherPort, tx, ty) !== null,
      }, other.findSpawn(definition.prefer))
      expect(tile, definition.id).not.toBeNull()
    }
  })
})
