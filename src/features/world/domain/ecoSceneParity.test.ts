// @vitest-environment node
// ECO-BATTLE-SCENE-1: the server freezes a wild ECO encounter on the tile of its SHARED patrol at
// the engage instant. That is only the tile every client draws if the server builds the very same
// patrol — i.e. if its walkability for a wild actor is the client's. The client's rule is the
// game's `walkable` for a wanderer (game.ts): not solid, not a portal, not a door. Checked tile by
// tile over Pradera around its arrival (where its nests are) and over the whole cave, and on real
// patrols built with each rule.

import { describe, expect, it } from 'vitest'
import { Atlas } from '../../wildlands/areas/atlas'
import { isPortalTile } from '../../wildlands/engine/area'
import { doorAt } from '../../wildlands/engine/doors'
import { WORLD_AREAS } from '../../../../services/realtime/src/world/areas.js'
import { encounterPatrol, wildWalkable } from '../../../../services/realtime/src/world/ecoScene.js'
import { buildPatrol } from '../../../../services/realtime/src/world/patrol.js'
import { WILD_SPEED } from '../../../../services/realtime/src/world/wildPopulation.js'

const atlas = new Atlas()
/** The game's rule for a wanderer (game.ts `walkable`), on the client's own area. */
function clientWalkable(areaId: string) {
  const area = atlas.get(areaId as never)
  return (tx: number, ty: number) => !area.isSolid(tx, ty) && !isPortalTile(area, tx, ty) && doorAt(area.doors ?? [], tx, ty) === null
}

const SWEEPS = {
  pradera: { center: WORLD_AREAS.pradera.spawn!, radius: 120 },
  'cueva-inicial': { center: { tx: 30, ty: 30 }, radius: 60 },
} as const

describe('ECO wild walkability: server = client (the shared patrol is the same patrol)', () => {
  for (const [areaId, { center, radius }] of Object.entries(SWEEPS)) {
    it(`${areaId}: every tile within ${radius} of ${center.tx},${center.ty}`, () => {
      const client = clientWalkable(areaId)
      const mismatches: string[] = []
      let walkable = 0
      for (let ty = center.ty - radius; ty <= center.ty + radius; ty++) {
        for (let tx = center.tx - radius; tx <= center.tx + radius; tx++) {
          const a = client(tx, ty)
          const b = wildWalkable(areaId, tx, ty)
          if (a) walkable++
          if (a !== b && mismatches.length < 10) mismatches.push(`${tx},${ty}: client ${a} server ${b}`)
        }
      }
      expect(mismatches).toEqual([])
      expect(walkable).toBeGreaterThan(100) // the sweep did cover walkable ground
    })
  }

  it('real patrols built with either rule are identical (homes on a grid of walkable tiles)', () => {
    let compared = 0
    for (const [areaId, { center, radius }] of Object.entries(SWEEPS)) {
      const client = clientWalkable(areaId)
      for (let ty = center.ty - radius; ty <= center.ty + radius; ty += 7) {
        for (let tx = center.tx - radius; tx <= center.tx + radius; tx += 7) {
          if (!client(tx, ty)) continue
          const id = `eco-n:${areaId}:parity:1:${tx}_${ty}`
          const clientPatrol = buildPatrol({ key: id, home: { tx, ty }, walkable: client, speed: WILD_SPEED })
          expect(encounterPatrol({ id, areaId, tx, ty })).toEqual(clientPatrol)
          compared++
        }
      }
    }
    expect(compared).toBeGreaterThan(50)
  })
})
