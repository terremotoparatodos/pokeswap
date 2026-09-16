import { describe, expect, it } from 'vitest'
import { World } from '../../wildlands/engine/world'
import { bladeArt, frostMoteArt, petalArt, seedArt } from '../art/forageFx'
import { sickleIconArt, sickleSwingArt, SICKLE_ITEMS } from '../art/forageItems'
import { FORAGE_ANCHORS, FORAGE_NODE_IDS, forageNodeArt, isForageNodeId, plainForageArt } from '../art/forageNodes'
import { BERRY_TONES, HERB_FLOWERS } from '../art/foragePalette'
import { color, hasColor, opaqueCount } from '../art/pixelArt'
import { GATHERING_NODES, NODE_BY_ID } from '../domain/catalog/nodes'
import { PRADERA_LANDMARKS, PRADERA_SEED } from '../demo/praderaLandmarks'
import { nodeAt, worldNodePort } from '../domain/nodePlacement'
import { forageStyle } from './useForageController'
import { foragePose, forageTimeline, takesBetween } from './forageTimeline'
import { forageVisual, regrowFrame } from './forageVisualState'

describe('forage nodes', () => {
  it('covers exactly the alchemy gathering nodes of the catalog', () => {
    const catalog = GATHERING_NODES.filter(node => node.profession === 'alchemy').map(node => node.id).sort()
    expect([...FORAGE_NODE_IDS].sort()).toEqual(catalog)
    // Every node is drawn on the anchor the domain gives it.
    for (const nodeId of FORAGE_NODE_IDS) {
      expect(NODE_BY_ID.get(nodeId)!.anchors).toContain(FORAGE_ANCHORS[nodeId])
    }
  })

  it('keeps the host prop and adds only what can be gathered', () => {
    const plain = plainForageArt('bush')
    const ready = forageNodeArt('berry_bush', 'ready')
    expect(ready.w).toBe(plain.w)
    expect(ready.h).toBe(plain.h)
    // The berries are the icon's own blue, and the plain bush has none.
    expect(hasColor(ready, color(BERRY_TONES.oran.tones[1]))).toBe(true)
    expect(hasColor(plain, color(BERRY_TONES.oran.tones[1]))).toBe(false)
  })

  it('tells a grove from a berry bush by its fruit and its blossoms', () => {
    const bush = forageNodeArt('berry_bush', 'ready')
    const grove = forageNodeArt('wild_grove', 'ready')
    expect(hasColor(grove, color(BERRY_TONES.sitrus.tones[1]))).toBe(true)
    expect(hasColor(grove, color(BERRY_TONES.leppa.tones[1]))).toBe(true)
    expect(hasColor(bush, color(BERRY_TONES.sitrus.tones[1]))).toBe(false)
    expect(hasColor(grove, color(HERB_FLOWERS[2])), 'blossoms').toBe(true)
  })

  it('separates a herb patch from plain tall grass', () => {
    const patch = forageNodeArt('herb_patch', 'ready')
    const grass = plainForageArt('tallGrass')
    expect(opaqueCount(patch)).toBeGreaterThan(opaqueCount(grass))
    expect(hasColor(patch, color(HERB_FLOWERS[2]))).toBe(true)
    expect(hasColor(grass, color(HERB_FLOWERS[2]))).toBe(false)
  })

  it('leaves a picked plant that is neither the full one nor just faded', () => {
    for (const nodeId of FORAGE_NODE_IDS) {
      const ready = forageNodeArt(nodeId, 'ready')
      const picked = forageNodeArt(nodeId, 'picked')
      expect(picked.pixels, nodeId).not.toEqual(ready.pixels)
      // Regrowth sits between the two, never equal to either.
      const regrowing = forageNodeArt(nodeId, 'regrowing', 1)
      expect(regrowing.pixels, nodeId).not.toEqual(picked.pixels)
      expect(regrowing.pixels, nodeId).not.toEqual(ready.pixels)
    }
  })

  it('maps respawn progress to a regrowth frame', () => {
    expect(regrowFrame(0)).toBe(0)
    expect(regrowFrame(0.9)).toBe(1)
  })
})

describe('sickle', () => {
  it('matches the catalog tools and separates tiers and conditions', () => {
    for (const [tier, itemId] of Object.entries(SICKLE_ITEMS)) {
      expect(NODE_BY_ID.get(itemId) ?? itemId).toBeTruthy()
      const art = sickleIconArt(Number(tier) as 1 | 2 | 3)
      expect(opaqueCount(art), itemId).toBeGreaterThan(10)
    }
    const ok = sickleIconArt(2)
    expect(opaqueCount(sickleIconArt(2, 'broken'))).toBeLessThan(opaqueCount(ok))
    expect(sickleIconArt(3).pixels).not.toEqual(sickleIconArt(1).pixels)
    expect(sickleIconArt(2, 'retired').pixels).not.toEqual(ok.pixels)
  })

  it('mirrors the sweep for the other facing', () => {
    const right = sickleSwingArt(2, 2, false)
    const left = sickleSwingArt(2, 2, true)
    expect(left.w).toBe(right.w)
    expect(left.pixels).not.toEqual(right.pixels)
  })
})

describe('forage timeline', () => {
  it('lets the domain choose the gesture', () => {
    // The gesture follows the domain preview, not the node's tier: with no
    // usable sickle you pick by hand, and with one the domain cuts (and wears it).
    expect(forageStyle(true)).toBe('hand')
    expect(forageStyle(false)).toBe('sickle')
    // And the catalog really does leave the early plants toolless.
    expect(NODE_BY_ID.get('berry_bush')!.minToolTier).toBe(0)
    expect(NODE_BY_ID.get('herb_patch')!.minToolTier).toBe(0)
    expect(NODE_BY_ID.get('wild_grove')!.minToolTier).toBeGreaterThan(0)
    expect(NODE_BY_ID.get('frost_bloom')!.minToolTier).toBeGreaterThan(0)
  })

  it('runs reach → take → settle and ends in a reward', () => {
    const timeline = forageTimeline(12, 'hand')
    expect(foragePose(timeline, 0).phase).toBe('reach')
    expect(foragePose(timeline, 320).phase).toBe('take')
    expect(foragePose(timeline, 460).phase).toBe('settle')
    expect(foragePose(timeline, timeline.resultAtMs + 10).phase).toBe('reward')
    expect(foragePose(timeline, timeline.totalMs + 1).phase).toBe('done')
    expect(takesBetween(timeline, 0, timeline.resultAtMs)).toHaveLength(timeline.picks)
  })

  it('sways the plant instead of shaking it, and only while taking', () => {
    const timeline = forageTimeline(18, 'sickle')
    expect(foragePose(timeline, 10).sway).toBe(0)
    expect(Math.abs(foragePose(timeline, 300).sway)).toBeGreaterThan(0)
    // The sickle shows a frame; the hand never does.
    expect(foragePose(timeline, 300).toolFrame).toBe(2)
    expect(foragePose(forageTimeline(12, 'hand'), 10).toolFrame).toBe(0)
  })
})

describe('forage visual state', () => {
  const base = {
    adjacent: false, targeted: false, gathering: false, respawnInSeconds: 0, respawnSeconds: 90,
    rareNode: false, detected: false, needsTool: false,
  }

  it('asks for a hand or a sickle depending on the node', () => {
    expect(forageVisual({ ...base, status: 'available', adjacent: true }).bubble).toBe('hand')
    expect(forageVisual({ ...base, status: 'available', adjacent: true, needsTool: true }).bubble).toBe('sickle')
  })

  it('shows the plant picked, then regrowing, then ready', () => {
    expect(forageVisual({ ...base, status: 'depleted' }).art).toBe('picked')
    expect(forageVisual({ ...base, status: 'depleted', respawnInSeconds: 80 }).art).toBe('picked')
    const late = forageVisual({ ...base, status: 'depleted', respawnInSeconds: 20 })
    expect(late.art).toBe('regrowing')
    expect(late.regrowProgress).toBeGreaterThan(0.5)
    expect(forageVisual({ ...base, status: 'available' }).art).toBe('ready')
  })

  it('locks by level and by access without hiding the plant', () => {
    expect(forageVisual({ ...base, status: 'locked_level', adjacent: true }).bubble).toBe('lock')
    expect(forageVisual({ ...base, status: 'locked_access', adjacent: true }).bubble).toBe('seal')
  })
})

describe('forage effects', () => {
  it('uses vegetal shapes, not stone chips', () => {
    const petal = petalArt(HERB_FLOWERS[1], true)
    expect(petal.w).toBeGreaterThan(petal.h)
    expect(opaqueCount(petalArt(HERB_FLOWERS[1], false))).toBeLessThan(opaqueCount(petal))
    expect(bladeArt(true).h).toBeGreaterThan(bladeArt(true).w)
    expect(opaqueCount(seedArt())).toBe(4)
    expect(opaqueCount(frostMoteArt(true))).toBe(5)
  })
})

describe('forage nodes in the real world', () => {
  it('finds every alchemy node where the Pradera landmarks say it is', () => {
    const world = new World(PRADERA_SEED)
    const port = worldNodePort(world)
    const landmarks = PRADERA_LANDMARKS.filter(landmark => NODE_BY_ID.get(landmark.definitionId)?.profession === 'alchemy')
    expect(landmarks).toHaveLength(4)
    for (const landmark of landmarks) {
      const placement = nodeAt(port, landmark.tx, landmark.ty)
      expect(placement?.definitionId, landmark.definitionId).toBe(landmark.definitionId)
      expect(isForageNodeId(placement!.definitionId)).toBe(true)
    }
  })
})
