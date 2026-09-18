import { describe, expect, it } from 'vitest'
import { HEARTHOME } from '../../wildlands/areas/atlas'
import { TILE } from '../../wildlands/engine/world'
import {
  CITY_TREE_ASSETS, cityTree, FUTURE_CITY_TREES, forestVariantAt, isCityTreeId, treeCollisionTiles, treeFeet,
  treeSpriteBounds, treeTapBounds, treeVisualTiles,
} from './cityTrees'

const PNGS = import.meta.glob<string>('../../../../public/assets/town/tree-*.png', { query: '?inline', import: 'default', eager: true })

/** Width and height straight from the PNG header (IHDR), no image library. */
function pngSize(src: string): { width: number; height: number } {
  const entry = Object.entries(PNGS).find(([path]) => path.endsWith(src))
  if (!entry) throw new Error(`missing ${src}`)
  const bytes = Uint8Array.from(atob(entry[1].split(',')[1]), c => c.charCodeAt(0))
  const u32 = (i: number) => ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0
  return { width: u32(16), height: u32(20) }
}

describe('city tree assets', () => {
  it('are exactly the city forest art, in the order the forest picks them', () => {
    expect(CITY_TREE_ASSETS.map(t => t.src)).toEqual(HEARTHOME.art?.trees)
    expect(CITY_TREE_ASSETS.map(t => t.id)).toEqual(['city-tree-pointed', 'city-tree-pointed-lit', 'city-tree-round'])
    expect(FUTURE_CITY_TREES).toContain('PALM TREE — FUTURE ASSET')
  })

  it('freeze their sizes to the PNGs', () => {
    for (const t of CITY_TREE_ASSETS) expect(pngSize(t.src), t.id).toEqual({ width: t.width, height: t.height })
    expect(CITY_TREE_ASSETS.map(t => [t.width, t.height])).toEqual([[41, 51], [41, 51], [43, 48]])
  })

  it('anchor at the loader default: horizontal centre, bottom row', () => {
    for (const t of CITY_TREE_ASSETS) expect(t.anchor).toEqual({ ax: t.width / 2, ay: t.height - 1 })
    // The trunk sits on the anchor column and above the feet.
    for (const t of CITY_TREE_ASSETS) {
      const mid = (t.parts.trunk.x0 + t.parts.trunk.x1) / 2
      expect(Math.abs(mid - t.anchor.ax)).toBeLessThanOrEqual(1)
      expect(t.parts.trunk.y1).toBeLessThan(t.anchor.ay)
    }
  })

  it('stand where TownArea stands a forest tree', () => {
    // ensureArt: x = (bx + 1)·TILE (+ jitter), y = (by + 2)·TILE − 2
    expect(treeFeet(10, 20)).toEqual({ x: 11 * TILE, y: 22 * TILE - 2 })
  })

  it('own a 2×2 visual cell and block only its bottom row', () => {
    for (const t of CITY_TREE_ASSETS) {
      expect(treeVisualTiles(t.id, 5, 7)).toEqual([{ tx: 5, ty: 7 }, { tx: 6, ty: 7 }, { tx: 5, ty: 8 }, { tx: 6, ty: 8 }])
      expect(treeCollisionTiles(t.id, 5, 7)).toEqual([{ tx: 5, ty: 8 }, { tx: 6, ty: 8 }])
    }
  })

  it('keep sprite bounds, tap hitbox and collision as three different things', () => {
    const t = cityTree('city-tree-pointed')
    expect(treeSpriteBounds(t.id)).toEqual({ x0: -20.5, y0: -50, x1: 20.5, y1: 1 })
    // Tap: the two cell columns, up to the crown's top — narrower than the flared art.
    expect(treeTapBounds(t.id)).toEqual({ x0: -16, y0: -50, x1: 16, y1: 0 })
    expect(treeTapBounds('city-tree-round')).toEqual({ x0: -16, y0: -47, x1: 16, y1: 0 })
    // Collision is the cell's lower row: 32 × 16 px under the feet line.
    expect(t.collisionFootprint).toHaveLength(2)
  })

  it('name the variant a generated forest block shows', () => {
    // Same formula as TownArea: |bx·7 + by·13| mod 3
    expect(forestVariantAt(0, 0)).toBe('city-tree-pointed')
    expect(forestVariantAt(2, 0)).toBe('city-tree-round') // 14 % 3 = 2
    expect(forestVariantAt(2, 2)).toBe('city-tree-pointed-lit') // 40 % 3 = 1
  })

  it('recognise their ids', () => {
    expect(isCityTreeId('city-tree-round')).toBe(true)
    expect(isCityTreeId('tree')).toBe(false)
  })
})

describe('module boundaries', () => {
  const sources = import.meta.glob<string>('./*.ts', { query: '?raw', import: 'default', eager: true })

  it('does not depend on Vue, the editor or any product feature', () => {
    for (const [path, source] of Object.entries(sources)) {
      if (path.endsWith('.test.ts')) continue
      expect(source, path).not.toMatch(/from 'vue'|cityLab|components\/|supabase|colyseus/)
      for (const [, spec] of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        expect(spec.startsWith('./') || spec.includes('/wildlands/engine/'), `${path} → ${spec}`).toBe(true)
      }
    }
  })
})
