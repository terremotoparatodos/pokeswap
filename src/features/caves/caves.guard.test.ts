// @vitest-environment node
// CAVES-2 on the browser side: the mouths come from `caves.js` and nowhere
// else, collide exactly as the service says, and no longer open the Dungeon
// prototype. Everything is derived from `CAVES`.

import { describe, expect, it, vi } from 'vitest'
import { CAVES, cavesIn } from '../../../services/realtime/src/world/caves.js'
import { WORLD_AREAS } from '../../../services/realtime/src/world/areas.js'
import { isSolidAtArea } from '../../../services/realtime/src/world/resourceZones.js'
import { Atlas, WORLDS } from '../wildlands/areas/atlas'
import { TILE } from '../wildlands/engine/world'
import { CaveMouthOverlay, caveFeet, caveLabel } from './world/caveMouthOverlay'

// Pixels need a canvas this environment does not have; where the sprite goes is what is under test.
vi.mock('./art/caveEntranceArt', async importOriginal => ({
  ...(await importOriginal<typeof import('./art/caveEntranceArt')>()),
  caveEntranceSprite: () => ({ stub: 'cave' }),
}))

const atlas = new Atlas()
/** Every application source file (tests excluded below), keyed relative to this folder. */
const SOURCES = import.meta.glob<string>('../../**/*.{ts,vue}', { query: '?raw', import: 'default', eager: true })
/** `../devSurfaces/x.vue` → `features/devSurfaces/x.vue`: the key resolved from `src/features/caves/`. */
function file(path: string): string {
  const out = ['features', 'caves']
  for (const part of path.split('/')) {
    if (part === '..') out.pop()
    else if (part !== '.') out.push(part)
  }
  return out.join('/')
}

describe('CAVES-2 in the browser', () => {
  it('draws exactly the caves of caves.js: one sprite per cave in its area, none anywhere else', () => {
    const overlay = new CaveMouthOverlay({ player: () => null })
    for (const id of ['ciudad-corazon', ...WORLDS.map(world => world.id)]) {
      const sprites = overlay.sprites(atlas.get(id))
      expect(sprites.length, id).toBe(cavesIn(id).length)
      cavesIn(id).forEach((cave, i) => expect({ x: sprites[i].wx, y: sprites[i].wy }).toEqual(caveFeet(cave)))
    }
    expect(overlay.sprites(atlas.get('pradera')).length).toBe(1)
  })

  it('stands the art on the middle of the front row and names an open cave as such', () => {
    for (const cave of CAVES) {
      const feet = caveFeet(cave)
      expect(feet.x).toBe((cave.mouth.tx + 0.5) * TILE)
      expect(Math.floor(feet.y / TILE)).toBe(cave.anchor.ty)
      expect(caveLabel(cave)).toBe('Cueva')
      expect(caveLabel({ ...cave, entrance: 'closed' })).toMatch(/próximamente/)
    }
  })

  it('labels a cave only for a player in its area and within reach of its approach', () => {
    const [cave] = cavesIn('pradera')
    const pradera = atlas.get('pradera')
    const at = (tx: number, ty: number, areaId = 'pradera') => new CaveMouthOverlay({ player: () => ({ tx, ty, areaId }) }).labels(pradera)
    expect(at(cave.approach.tx, cave.approach.ty)).toHaveLength(1)
    expect(at(cave.approach.tx, cave.approach.ty + 20)).toHaveLength(0)
    expect(at(cave.approach.tx, cave.approach.ty, 'ciudad-corazon')).toHaveLength(0)
  })

  it('collides like the service: rock solid but the open mouth, approach and clearance open, on the client World', () => {
    const { seed } = WORLD_AREAS.pradera
    const pradera = atlas.get('pradera')
    for (const cave of cavesIn('pradera')) {
      for (const t of cave.footprint) {
        const mouth = t.tx === cave.mouth.tx && t.ty === cave.mouth.ty
        expect(pradera.isSolid(t.tx, t.ty), `${t.tx},${t.ty}`).toBe(!mouth)
        expect(isSolidAtArea('pradera', seed!, t.tx, t.ty)).toBe(!mouth)
      }
      for (const t of cave.clearance) {
        expect(pradera.isSolid(t.tx, t.ty), `${t.tx},${t.ty}`).toBe(false)
        expect(isSolidAtArea('pradera', seed!, t.tx, t.ty)).toBe(false)
      }
    }
  })

  it('no world surface opens the Dungeon prototype or places entrances from a seed', () => {
    const offenders: string[] = []
    for (const [path, text] of Object.entries(SOURCES)) {
      const name = file(path)
      if (name.endsWith('.test.ts')) continue
      // The prototype keeps its own feature and the DEV-only surface gallery (/dev/superficies).
      if (name.startsWith('features/dungeonEntrances/') || name.startsWith('features/dungeonPrototype/') || name.startsWith('features/devSurfaces/')) continue
      if (/dungeonEntrances\/|DungeonRunPanel|PlayDungeon|areaEntrances|placeEntrances/.test(text)) offenders.push(name)
    }
    expect(Object.keys(SOURCES).map(file)).toContain('app/router/routes.ts')
    expect(Object.keys(SOURCES).length).toBeGreaterThan(200)
    expect(offenders).toEqual([])
    const view = SOURCES['../wildlands/components/WildlandsView.vue']
    expect(view).toMatch(/CaveMouthOverlay/)
    expect(view).not.toMatch(/DungeonEntrances|DungeonRunPanel|dungeonRun/)
  })
})
