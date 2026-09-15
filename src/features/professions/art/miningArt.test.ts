import { describe, expect, it } from 'vitest'
import { ROCK_RECIPES } from '../../wildlands/engine/props'
import { GATHERING_NODES } from '../domain/catalog/nodes'
import { ORE_TONES } from './miningPalette'
import { MINING_ASSETS } from './miningAssets'
import { MINING_RESOURCE_ICON_IDS, pickaxeIconArt, pickaxeSwingArt, resourceIconArt } from './miningItems'
import { MINING_NODE_IDS, miningNodeArt, NODE_ANCHORS, RESPAWN_FRAMES } from './miningNodes'
import { color, hasColor, mirror, opaqueCount } from './pixelArt'

const same = (a: Uint32Array, b: Uint32Array) => a.length === b.length && a.every((value, i) => value === b[i])

describe('mining node art', () => {
  it('covers every mining node of the catalog on every anchor it spawns on', () => {
    const catalog = GATHERING_NODES.filter(node => node.profession === 'mining')
    expect(new Set(catalog.map(node => node.id))).toEqual(new Set(MINING_NODE_IDS))
    for (const node of catalog) expect([...NODE_ANCHORS[node.id as (typeof MINING_NODE_IDS)[number]]].sort()).toEqual([...node.anchors].sort())
  })

  it('keeps the host prop footprint so collision and depth stay coherent', () => {
    for (const nodeId of MINING_NODE_IDS) {
      for (const anchor of NODE_ANCHORS[nodeId]) {
        for (const state of ['ready', 'depleted', 'respawning'] as const) {
          const art = miningNodeArt(nodeId, anchor, state)
          if (anchor !== 'crystal') expect([art.w, art.h], `${nodeId} ${anchor}`).toEqual([ROCK_RECIPES[anchor].w, ROCK_RECIPES[anchor].h])
          expect(art.ay).toBe(art.h - 1)
          expect(opaqueCount(art)).toBeGreaterThan(art.w * art.h * 0.2)
        }
      }
    }
  })

  it('shows minerals only while ready and regrows them while respawning', () => {
    const ready = miningNodeArt('iron_vein', 'boulder', 'ready')
    const depleted = miningNodeArt('iron_vein', 'boulder', 'depleted')
    expect(hasColor(ready, color(ORE_TONES.iron.tones[2]))).toBe(true)
    expect(hasColor(depleted, color(ORE_TONES.iron.tones[2]))).toBe(false)
    expect(same(ready.pixels, depleted.pixels)).toBe(false)
    const frames = Array.from({ length: RESPAWN_FRAMES }, (_, frame) => miningNodeArt('iron_vein', 'boulder', 'respawning', frame))
    expect(same(frames[0].pixels, frames[RESPAWN_FRAMES - 1].pixels)).toBe(false)
    expect(same(frames[0].pixels, depleted.pixels)).toBe(false)
  })

  it('makes coal, iron and gold distinguishable by their mineral colour', () => {
    const signature = (id: 'coal_seam' | 'iron_vein' | 'gold_vein', tone: string) => hasColor(miningNodeArt(id, 'boulder', 'ready'), color(tone))
    expect(signature('gold_vein', ORE_TONES.gold.tones[2])).toBe(true)
    expect(signature('iron_vein', ORE_TONES.gold.tones[2])).toBe(false)
    expect(signature('coal_seam', ORE_TONES.coal.tones[0])).toBe(true)
  })

  it('is memoised so all nodes of a kind share one buffer', () => {
    expect(miningNodeArt('coal_seam', 'rock', 'ready')).toBe(miningNodeArt('coal_seam', 'rock', 'ready'))
  })
})

describe('mining item art', () => {
  it('has a readable 16×16 icon for every mining resource', () => {
    for (const itemId of MINING_RESOURCE_ICON_IDS) {
      const icon = resourceIconArt(itemId)!
      expect([icon.w, icon.h]).toEqual([16, 16])
      expect(opaqueCount(icon), itemId).toBeGreaterThan(30)
    }
    expect(resourceIconArt('oran_berry')).toBeNull()
  })

  it('distinguishes pickaxe tiers and conditions', () => {
    const [t1, t2, t3] = ([1, 2, 3] as const).map(tier => pickaxeIconArt(tier))
    expect(same(t1.pixels, t2.pixels)).toBe(false)
    expect(same(t2.pixels, t3.pixels)).toBe(false)
    expect(same(pickaxeIconArt(2, 'broken').pixels, t2.pixels)).toBe(false)
    expect(same(pickaxeIconArt(2, 'retired').pixels, pickaxeIconArt(2, 'broken').pixels)).toBe(false)
  })

  it('builds three distinct swing frames and mirrors them for the left side', () => {
    const frames = ([0, 1, 2] as const).map(frame => pickaxeSwingArt(2, frame, false))
    expect(same(frames[0].pixels, frames[2].pixels)).toBe(false)
    expect(pickaxeSwingArt(2, 1, true).pixels).toEqual(mirror(frames[1]).pixels)
  })
})

describe('mining asset registry', () => {
  it('lists unique ids that all build', () => {
    const ids = MINING_ASSETS.map(asset => asset.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const asset of MINING_ASSETS) expect(opaqueCount(asset.build()), asset.id).toBeGreaterThan(0)
  })
})
