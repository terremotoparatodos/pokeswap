// CAVES-3 on the browser side: the cave interior is the authored layout, the
// same one the service enforces, and nothing else lives in it.

import { describe, expect, it } from 'vitest'
import { CAVES, cavesIn } from '../../../services/realtime/src/world/caves.js'
import { caveInterior, isCaveFloor } from '../../../services/realtime/src/world/caveLayouts.js'
import { Atlas } from '../wildlands/areas/atlas'
import { portalAt } from '../wildlands/engine/area'
import { isPresenceAreaId } from '../wildlands/multiplayer/domain/presence'
import { CaveArea } from './world/caveArea'

const atlas = new Atlas()
const [cave] = cavesIn('pradera')
const interior = caveInterior(cave.interiorAreaId)!

describe('CAVES-3 in the browser', () => {
  it('the atlas builds the interior as a shared presence area', () => {
    expect(Atlas.isKnown('cueva-inicial')).toBe(true)
    expect(atlas.get('cueva-inicial')).toBeInstanceOf(CaveArea)
    expect(isPresenceAreaId('cueva-inicial')).toBe(true)
    expect(isPresenceAreaId('cueva-falsa')).toBe(false)
  })

  it('collides exactly like the service: the layout decides, out of bounds is rock', () => {
    const area = atlas.get('cueva-inicial')
    for (let ty = -2; ty < interior.height + 2; ty++) {
      for (let tx = -2; tx < interior.width + 2; tx++) {
        expect(area.isSolid(tx, ty), `${tx},${ty}`).toBe(!isCaveFloor(interior.id, tx, ty))
      }
    }
  })

  it('arrives on the S tile facing in, never on the exit pad, and every floor tile is reachable', () => {
    const area = atlas.get('cueva-inicial')
    const arrival = area.arrival('pradera')
    expect(arrival).toEqual({ ...interior.arrival })
    expect(portalAt(area, arrival.tx, arrival.ty)).toBeNull()
    expect(area.isReachable?.(interior.exit.tx, interior.exit.ty)).toBe(true)
    expect(area.isReachable?.(0, 0)).toBe(false)
  })

  it('has exactly one portal, the exit pad, back to Pradera', () => {
    const area = atlas.get('cueva-inicial')
    expect(area.portals).toHaveLength(1)
    expect(area.portals[0]).toMatchObject({ to: 'pradera', pad: true, tiles: [{ ...interior.exit }] })
  })

  it('is empty: no props, no populace, no water, no pickups, no talk', () => {
    const area = atlas.get('cueva-inicial')
    expect(area.decorIn(-1000, -1000, 1000, 1000)).toEqual([])
    const populace = area.createPopulace({ pokedex: [], npcSprites: [] })
    expect(populace.actors).toEqual([])
    for (let ty = 0; ty < interior.height; ty++) {
      for (let tx = 0; tx < interior.width; tx++) {
        expect(area.isWater(tx, ty)).toBe(false)
        expect(area.collect(tx, ty)).toBe(false)
        expect(area.talkAt(tx, ty)).toBeNull()
      }
    }
  })

  it('Pradera: only the open mouth tile leads inside, and leaving lands on the approach', () => {
    const pradera = atlas.get('pradera')
    const inward = pradera.portals.filter(p => p.to === cave.interiorAreaId)
    expect(inward).toHaveLength(1)
    expect(inward[0].tiles).toEqual([{ ...cave.mouth }])
    expect(pradera.isSolid(cave.mouth.tx, cave.mouth.ty)).toBe(false)
    expect(portalAt(pradera, cave.approach.tx, cave.approach.ty)).toBeNull()
    for (const t of cave.clearance) expect(portalAt(pradera, t.tx, t.ty)).toBeNull()
    expect(pradera.arrival('cueva-inicial')).toEqual({ ...cave.approach, dir: 'down' })
    // The Ciudad pad is untouched.
    expect(pradera.portals.filter(p => p.to === 'ciudad-corazon')).toHaveLength(1)
  })

  it('no other world grows a cave portal', () => {
    for (const id of ['ciudad-corazon', 'bosque', 'desierto', 'tundra', 'costa']) {
      const area = atlas.get(id)
      expect(area.portals.some(p => CAVES.some(c => c.interiorAreaId === p.to)), id).toBe(false)
    }
  })
})
