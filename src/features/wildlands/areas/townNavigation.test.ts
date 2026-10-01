// CAVES-4 on the browser side: Ciudad Corazón collides exactly like the
// presence service, because both read the shared town layout.

import { describe, expect, it } from 'vitest'
import {
  TOWN_BUILDINGS, TOWN_GATES, TOWN_HEIGHT, TOWN_PROPS, TOWN_SPAWN, TOWN_WIDTH, isTownWalkable,
} from '../../../../services/realtime/src/world/townLayout.js'
import { Atlas, HEARTHOME, LOBBY_ID } from './atlas'
import { TownArea } from './townArea'

const town = new Atlas().get(LOBBY_ID) as TownArea

describe('Ciudad Corazón navigation parity (CAVES-4)', () => {
  it('collides exactly like the service on every tile, out of bounds included', () => {
    expect(town).toBeInstanceOf(TownArea)
    for (let ty = -3; ty < TOWN_HEIGHT + 3; ty++) {
      for (let tx = -3; tx < TOWN_WIDTH + 3; tx++) {
        expect(town.isSolid(tx, ty), `${tx},${ty}`).toBe(!isTownWalkable(tx, ty))
      }
    }
  })

  it('every gate keeps the shared tiles and arrival; only the label is the browser\'s', () => {
    expect(town.portals.map(p => ({ to: p.to, tiles: p.tiles, arrival: p.arrival })))
      .toEqual(TOWN_GATES.map(g => ({ to: g.to, tiles: [...g.tiles], arrival: { ...g.arrival } })))
    for (const gate of town.portals) expect(gate.label).toMatch(/^Puerta /)
    expect(town.arrival(null)).toEqual({ ...TOWN_SPAWN })
    expect(town.arrival('pradera')).toEqual({ tx: 8, ty: 41, dir: 'right' })
  })

  it('every shared footprint is one building, every door comes from it, every sign has its text', () => {
    expect(HEARTHOME.buildings.map(b => b.id)).toEqual(TOWN_BUILDINGS.map(b => b.id))
    for (const b of HEARTHOME.buildings) {
      const shared = TOWN_BUILDINGS.find(s => s.id === b.id)!
      expect({ x: b.x, y: b.y, w: b.w, d: b.d, open: b.open, door: b.door })
        .toEqual({ x: shared.x, y: shared.y, w: shared.w, d: shared.d, open: shared.open ? [...shared.open] : undefined, door: shared.door ? { ...shared.door } : undefined })
    }
    expect(HEARTHOME.props.map(p => ({ kind: p.kind, tx: p.tx, ty: p.ty }))).toEqual(TOWN_PROPS.map(p => ({ kind: p.kind, tx: p.tx, ty: p.ty })))
    for (const sign of HEARTHOME.props.filter(p => p.kind === 'sign')) expect(sign.text, `${sign.tx},${sign.ty}`).toMatch(/\S/)
  })

  it('the browser copies the shared data instead of handing out the frozen originals', () => {
    expect(Object.isFrozen(HEARTHOME.gates[0].tiles)).toBe(false)
    expect(Object.isFrozen(HEARTHOME.buildings[0])).toBe(false)
  })
})
