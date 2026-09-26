// MAP-2 on the browser side: the Pradera the client draws is the one the
// server validates, the caves did not move, and lookalike scenery is never an
// exact copy of a workable prop.

import { describe, expect, it } from 'vitest'
import { Atlas } from '../../wildlands/areas/atlas'
import { isPortalTile } from '../../wildlands/engine/area'
import { World } from '../../wildlands/engine/world'
import { areaEntrances } from '../../dungeonEntrances/domain/entranceSpawns'
import { backdropRockArt, backdropTreeArt } from '../../skills/scene/art/backdropArt'
import { plainRockArt } from '../../skills/scene/art/miningNodes'
import { plainTreeArt } from '../../skills/scene/art/loggingTrees'
import { WORLD_AREAS } from '../../../../services/realtime/src/world/areas.js'
import { PLOTS } from '../../../../services/realtime/src/world/plots.js'
import { resourceAt } from '../../../../services/realtime/src/world/resourceLayout.js'
import { decorAtArea, isPlannedTile, isSolidAtArea } from '../../../../services/realtime/src/world/resourceZones.js'
import { AUTHORED_DECOR } from '../../../../services/realtime/src/world/resourceZoneLayout.js'
import { decorAt } from '../../../../services/realtime/src/world/terrain.js'

const pradera = new Atlas().get('pradera')
const spawn = WORLD_AREAS.pradera.spawn!
const seed = WORLD_AREAS.pradera.seed!
const R = 64

/** The caves as `DungeonEntrances.vue` places them, with the same seed derivation. */
function seedOf(areaId: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < areaId.length; i++) hash = Math.imul(hash ^ areaId.charCodeAt(i), 0x01000193) >>> 0
  return hash
}
/** MAP-1's measurement before any zone existed (docs/design/map-1/audit.json). */
const CAVES_BEFORE_MAP2 = [
  { tx: -26, ty: -74 }, { tx: 7, ty: -59 }, { tx: -24, ty: -43 }, { tx: 19, ty: -58 }, { tx: -30, ty: -85 }, { tx: 16, ty: -49 },
]

describe('MAP-2 in the browser', () => {
  it('draws and collides exactly like the server layer, tile by tile', () => {
    const world = (pradera as unknown as { world: World }).world
    expect(world.areaId).toBe('pradera')
    for (let ty = spawn.ty - R; ty <= spawn.ty + R; ty++) {
      for (let tx = spawn.tx - R; tx <= spawn.tx + R; tx++) {
        expect(world.decorAt(tx, ty)).toBe(decorAtArea('pradera', seed, tx, ty))
        expect(pradera.isSolid(tx, ty)).toBe(isSolidAtArea('pradera', seed, tx, ty))
      }
    }
  })

  it('leaves the frozen procedural world alone when no area is named', () => {
    const plain = new World(seed)
    const layered = new World(seed, 'pradera')
    const planted = [...AUTHORED_DECOR].find(([, kind]) => kind === 'tree')![0].split(':').map(Number)
    const cleared = [...AUTHORED_DECOR].find(([, kind]) => kind === null)![0].split(':').map(Number)
    expect(plain.areaId).toBeNull()
    expect(layered.decorAt(planted[1], planted[2])).toBe('tree')
    expect(plain.decorAt(planted[1], planted[2])).toBe(decorAt(seed, planted[1], planted[2]))
    expect(plain.decorAt(planted[1], planted[2])).not.toBe('tree')
    expect(layered.decorAt(cleared[1], cleared[2])).toBeNull()
    expect(plain.decorAt(cleared[1], cleared[2])).toBe(decorAt(seed, cleared[1], cleared[2]))
    expect(plain.decorAt(cleared[1], cleared[2])).not.toBeNull()
  })

  it('keeps every cave where it was before the zones', () => {
    const caves = areaEntrances({
      areaId: 'pradera', origin: pradera.arrival(null), seed: seedOf('pradera'), now: Date.now(),
      port: {
        isSolid: (tx, ty) => pradera.isSolid(tx, ty),
        isWater: (tx, ty) => pradera.isWater(tx, ty),
        // What the component asks: the portal, planned zone ground, and what the professions own (nodes, plots).
        isTaken: (tx, ty) => isPortalTile(pradera, tx, ty) || isPlannedTile('pradera', tx, ty)
          || resourceAt('pradera', tx, ty) !== null || PLOTS.some(p => p.tx === tx && p.ty === ty),
      },
    })
    expect(caves.map(cave => cave.placement.anchor)).toEqual(CAVES_BEFORE_MAP2)
    for (const cave of caves) for (const tile of cave.placement.footprint) expect(isPlannedTile('pradera', tile.tx, tile.ty)).toBe(false)
  })

  it('draws scenery lookalikes as backdrop: same shape and anchor, never the same pixels', () => {
    const pairs = [[plainTreeArt('tree'), backdropTreeArt('tree')], [plainTreeArt('pine'), backdropTreeArt('pine')], [plainRockArt('rock'), backdropRockArt('rock')]] as const
    for (const [plain, backdrop] of pairs) {
      expect([backdrop.w, backdrop.h, backdrop.ax, backdrop.ay]).toEqual([plain.w, plain.h, plain.ax, plain.ay])
      let opaque = 0, changed = 0
      for (let i = 0; i < plain.pixels.length; i++) {
        if (plain.pixels[i] >>> 24 === 0) { expect(backdrop.pixels[i] >>> 24).toBe(0); continue }
        opaque++
        if (backdrop.pixels[i] !== plain.pixels[i]) changed++
      }
      expect(changed / opaque).toBeGreaterThan(0.9)
    }
  })
})
