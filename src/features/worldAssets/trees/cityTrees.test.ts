import { describe, expect, it } from 'vitest'
import { HEARTHOME } from '../../wildlands/areas/atlas'
import { T, TILE } from '../../wildlands/engine/world'
import {
  CITY_TREE_ASSETS, CITY_TREE_IDS, cityTree, FOREST_TREE_IDS, FUTURE_CITY_TREES, forestVariantAt, isCityTreeId, rootLift,
  treeCollisionTiles, treeFeet, treeSpriteBounds, treeTapBounds, treeVariantForTile, treeVisualTiles,
} from './cityTrees'
import { GROUND_BASE_STYLES, groundBasePixels, groundBaseStyle, rootWidth, townGround, wildGround, type GroundBaseStyle } from './treeGroundBase'

const PNGS = {
  ...import.meta.glob<string>('../../../../public/assets/town/tree-*.png', { query: '?inline', import: 'default', eager: true }),
  ...import.meta.glob<string>('./art/*.png', { query: '?inline', import: 'default', eager: true }),
}

function png(src: string): Uint8Array {
  const entry = Object.entries(PNGS).find(([path]) => path.endsWith(src))
  if (!entry) throw new Error(`missing ${src}`)
  return Uint8Array.from(atob(entry[1].split(',')[1]), c => c.charCodeAt(0))
}

/** Width and height straight from the PNG header (IHDR), no image library. */
function pngSize(src: string): { width: number; height: number } {
  const bytes = png(src)
  const u32 = (i: number) => ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0
  return { width: u32(16), height: u32(20) }
}

/** FNV-1a of a file's bytes: pins the forest PNGs so a rebuild can never touch them. */
function fnv(bytes: Uint8Array): string {
  let h = 0x811c9dc5
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0
  return h.toString(16)
}

describe('city tree family', () => {
  it('has 8 variants with unique ids: 3 from the forest, 2 from the same sheet, 3 derived', () => {
    expect(CITY_TREE_ASSETS).toHaveLength(8)
    expect(new Set(CITY_TREE_IDS).size).toBe(8)
    expect(CITY_TREE_ASSETS.map(t => t.origin)).toEqual(['forest', 'forest', 'forest', 'sheet', 'sheet', 'derived', 'derived', 'derived'])
    expect(FUTURE_CITY_TREES).toContain('PALM TREE — FUTURE ASSET')
  })

  it('links the forest variants to the forest’s own PNGs, in the forest’s order', () => {
    expect(CITY_TREE_ASSETS.filter(t => t.forestSrc).map(t => t.forestSrc)).toEqual(HEARTHOME.art?.trees)
    expect(FOREST_TREE_IDS).toEqual(['city-tree-pointed', 'city-tree-pointed-lit', 'city-tree-round'])
  })

  it('keeps the original forest PNGs byte-for-byte (placed trees use derived copies)', () => {
    expect(['a', 'b', 'c'].map(n => fnv(png(`/assets/town/tree-${n}.png`)))).toEqual(['d4845f54', '79a91981', '74b3862e'])
    for (const t of CITY_TREE_ASSETS) expect(t.src, t.id).not.toMatch(/\/assets\/town\//)
    // The derived pointed tree keeps the forest one's canvas: only the baked shadow was removed.
    expect(pngSize(`/${cityTree('city-tree-pointed').file}`)).toEqual(pngSize('/assets/town/tree-a.png'))
  })

  it('freezes each size to its PNG', () => {
    for (const t of CITY_TREE_ASSETS) expect(pngSize(`/${t.file}`), t.id).toEqual({ width: t.width, height: t.height })
  })

  it('anchors every variant at the loader default, trunk centred and roots just above the feet', () => {
    for (const t of CITY_TREE_ASSETS) {
      expect(t.anchor, t.id).toEqual({ ax: t.width / 2, ay: t.height - 1 })
      const mid = (t.trunk.x0 + t.trunk.x1) / 2
      expect(Math.abs(mid - t.anchor.ax), t.id).toBeLessThanOrEqual(1)
      expect(rootLift(t.id), t.id).toBeGreaterThanOrEqual(4)
      expect(rootLift(t.id), t.id).toBeLessThanOrEqual(7)
    }
    // Forest-derived trees keep the forest's exact root height.
    expect(rootLift('city-tree-pointed')).toBe(4)
    expect(rootLift('city-tree-round')).toBe(5)
  })

  it('stays inside a ~2×2 tile family: none wider than 3.1 tiles or taller than 3.6', () => {
    for (const t of CITY_TREE_ASSETS) {
      expect(t.width / TILE, t.id).toBeLessThanOrEqual(3.1)
      expect(t.height / TILE, t.id).toBeLessThanOrEqual(3.6)
    }
  })

  it('shares one footprint: 2×2 visual cell, 2×1 trunk collision, whatever the silhouette', () => {
    for (const t of CITY_TREE_ASSETS) {
      expect(treeVisualTiles(t.id, 5, 7)).toEqual([{ tx: 5, ty: 7 }, { tx: 6, ty: 7 }, { tx: 5, ty: 8 }, { tx: 6, ty: 8 }])
      expect(treeCollisionTiles(t.id, 5, 7)).toEqual([{ tx: 5, ty: 8 }, { tx: 6, ty: 8 }])
      expect(treeTapBounds(t.id)).toEqual({ x0: -16, y0: -(t.height - 1), x1: 16, y1: 0 })
      expect(treeSpriteBounds(t.id)).toEqual({ x0: -t.width / 2, y0: -(t.height - 1), x1: t.width / 2, y1: 1 })
    }
  })

  it('stands where TownArea stands a forest tree, and names forest variants the same way', () => {
    expect(treeFeet(10, 20)).toEqual({ x: 11 * TILE, y: 22 * TILE - 2 })
    expect(forestVariantAt(0, 0)).toBe('city-tree-pointed')
    expect(forestVariantAt(2, 2)).toBe('city-tree-pointed-lit')
    expect(forestVariantAt(2, 0)).toBe('city-tree-round')
  })

  it('picks "Árbol aleatorio" from the tile: same tile, same tree, and the whole family shows up', () => {
    expect(treeVariantForTile(12, 34)).toBe(treeVariantForTile(12, 34))
    const seen = new Set<string>()
    for (let x = 0; x < 30; x++) for (let y = 0; y < 30; y++) seen.add(treeVariantForTile(x, y))
    expect(seen.size).toBe(8)
    expect(isCityTreeId(treeVariantForTile(-3, 7))).toBe(true)
  })
})

describe('ground bases', () => {
  it('pick a style from the terrain and the tree', () => {
    expect(groundBaseStyle(townGround('g'), 'city-tree-pointed')).toBe('grass-tufts')
    expect(groundBaseStyle(townGround('g'), 'city-tree-round')).toBe('grass-roots')
    expect(groundBaseStyle(townGround('p'), 'city-tree-round')).toBe('paved')
    expect(groundBaseStyle(townGround('s'), 'city-tree-golden')).toBe('paved')
    expect(groundBaseStyle(townGround('t'), 'city-tree-teal')).toBe('forest')
    expect(wildGround(T.GRASS)).toBe('grass')
    expect(wildGround(T.SAND)).toBe('paved')
  })

  it('are small, deterministic, translucent shadows (never an opaque ring)', () => {
    for (const style of GROUND_BASE_STYLES) {
      const a = groundBasePixels(style, rootWidth('city-tree-pointed'))
      const b = groundBasePixels(style, rootWidth('city-tree-pointed'))
      expect(a.pixels).toEqual(b.pixels)
      expect(a.width).toBeLessThanOrEqual(3 * TILE)
      const alphas = [...a.pixels].map(p => p >>> 24).filter(v => v > 0)
      expect(alphas.length).toBeGreaterThan(0)
      // The shadow is see-through; only the few tuft/root pixels may be opaque.
      const opaque = alphas.filter(v => v > 200).length
      expect(opaque, style).toBeLessThanOrEqual(style === 'paved' || style === 'forest' ? 0 : 20)
    }
  })

  it('put tufts or root nubs on grass only', () => {
    const opaque = (s: GroundBaseStyle) => [...groundBasePixels(s, 21).pixels].filter(p => p >>> 24 > 200).length
    expect(opaque('grass-tufts')).toBeGreaterThan(0)
    expect(opaque('grass-roots')).toBeGreaterThan(0)
    expect(opaque('paved')).toBe(0)
    expect(opaque('forest')).toBe(0)
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
