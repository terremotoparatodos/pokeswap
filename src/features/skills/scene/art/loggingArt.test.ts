import { describe, expect, it } from 'vitest'
import { TREE_METRICS, treeKindPixels } from '../../../wildlands/engine/props'
import { barkFlakeArt, leafArt, sawdustArt, splinterArt } from './loggingFx'
import { LOGGING_RESOURCE_ICON_IDS, loggingResourceIconArt } from './loggingItems'
import { CUT_TONES, RIBBON, WOOD_TIERS } from './loggingPalette'
import { LOGGING_NODE_IDS, loggingTreeArt, NODE_TREE_KINDS, regrowState } from './loggingTrees'
import { color, hasColor, opaqueCount } from './pixelArt'

describe('logging trees', () => {
  it('keeps the exact footprint and anchor of the world prop', () => {
    for (const nodeId of LOGGING_NODE_IDS) {
      for (const kind of NODE_TREE_KINDS[nodeId]) {
        const art = loggingTreeArt(nodeId, kind, 'ready')
        const metrics = TREE_METRICS[kind]
        expect(art.w, `${nodeId}/${kind}`).toBe(metrics.w)
        expect(art.h, `${nodeId}/${kind}`).toBe(metrics.h)
        expect(art.ax).toBe(metrics.ax)
        expect(art.ay).toBe(metrics.ay)
      }
    }
  })

  it('breaks the trunk silhouette with a notch and stacks logs at the foot', () => {
    const { w, trunk } = TREE_METRICS.tree
    const plain = treeKindPixels('tree')
    const ready = loggingTreeArt('common_tree', 'tree', 'ready')
    expect(hasColor(ready, color(CUT_TONES[2]))).toBe(true)
    expect(hasColor(ready, color(RIBBON.light)), 'ribbon').toBe(true)

    // The notch is cut out of the trunk, not painted over it: somewhere down the
    // trunk a row of the ready tree is narrower than the same row of the plain one.
    const trunkRow = (pixels: Uint32Array, y: number) => {
      let count = 0
      for (let x = Math.floor(trunk[0]) - 1; x <= Math.ceil(trunk[1]) + 1; x++) if (pixels[y * w + x] !== 0) count++
      return count
    }
    const rows = []
    for (let y = Math.round(trunk[2]); y <= Math.round(trunk[3]); y++) rows.push(y)
    expect(rows.some(y => trunkRow(ready.pixels, y) < trunkRow(plain, y)), 'notch').toBe(true)

    // The logs sit beside the foot, so the tile-level silhouette changes too.
    const footY = TREE_METRICS.tree.ay - 1
    expect(trunkRow(ready.pixels, footY)).toBeGreaterThan(trunkRow(plain, footY))
  })

  it('gives each wood tier its own bark', () => {
    const hardwood = loggingTreeArt('hardwood_tree', 'tree', 'ready')
    expect(hasColor(hardwood, color(WOOD_TIERS.hardwood.tones[1]))).toBe(true)
    expect(hasColor(hardwood, color(WOOD_TIERS.common.tones[1]))).toBe(false)
    expect(hasColor(loggingTreeArt('boreal_tree', 'snowpine', 'ready'), color(WOOD_TIERS.boreal.tones[2]))).toBe(true)
    expect(hasColor(loggingTreeArt('pine_tree', 'pine', 'ready'), color(WOOD_TIERS.pine.tones[1]))).toBe(true)
  })

  it('leaves a stump that grows back through sprout and sapling', () => {
    const ready = opaqueCount(loggingTreeArt('common_tree', 'tree', 'ready'))
    const stump = opaqueCount(loggingTreeArt('common_tree', 'tree', 'stump'))
    const sprout = opaqueCount(loggingTreeArt('common_tree', 'tree', 'sprout'))
    const sapling = opaqueCount(loggingTreeArt('common_tree', 'tree', 'sapling'))
    expect(stump).toBeLessThan(ready / 3)
    expect(sprout).toBeGreaterThan(stump)
    expect(sapling).toBeGreaterThan(sprout)
    expect(sapling).toBeLessThan(ready)
    expect(hasColor(loggingTreeArt('common_tree', 'tree', 'stump'), color(CUT_TONES[2]))).toBe(true)
  })

  it('maps regrowth progress to a stage', () => {
    expect(regrowState(0)).toBe('stump')
    expect(regrowState(0.4)).toBe('sprout')
    expect(regrowState(0.9)).toBe('sapling')
  })
})

describe('logging items', () => {
  it('builds every wood icon at 16×16', () => {
    for (const itemId of LOGGING_RESOURCE_ICON_IDS) {
      const art = loggingResourceIconArt(itemId)!
      expect(art.w, itemId).toBe(16)
      expect(art.h, itemId).toBe(16)
      expect(opaqueCount(art), itemId).toBeGreaterThan(20)
    }
    expect(loggingResourceIconArt('iron_ore')).toBeNull()
  })
})

describe('logging effects', () => {
  it('uses wood shapes, not recoloured stone chips', () => {
    const splinter = splinterArt(true)
    expect(splinter.w).toBeGreaterThan(splinter.h)
    const leaf = leafArt(0, '#44a043')
    expect(leaf.w).toBeGreaterThanOrEqual(4)
    expect(leafArt(1, '#44a043').pixels).not.toEqual(leaf.pixels)
    expect(opaqueCount(sawdustArt(0))).toBeGreaterThan(opaqueCount(sawdustArt(1)))
    expect(opaqueCount(barkFlakeArt('#5b3720'))).toBe(3)
  })
})
