import { describe, expect, it, vi } from 'vitest'
import { createActor, createWalkerState, driveWalker, WALK_SPEED, type MoveRules } from './actors'
import { buildingDoors, doorAt, doorForTap, Entrances } from './doors'
import { TapNavigator } from './navigator'
import { HEARTHOME, LOBBY_ID, WORLDS } from '../areas/atlas'
import { TownArea } from '../areas/townArea'
import { WildArea } from '../areas/wildArea'

const town = new TownArea(HEARTHOME)
const shop = town.doors.find(d => d.feature === 'mercado')!

describe('buildingDoors', () => {
  it('only lists buildings with both a door and a feature, exiting below the door facing out', () => {
    const doors = buildingDoors([
      { id: 'a', x: 2, y: 2, w: 3, d: 3, door: { tx: 3, ty: 4 }, feature: 'swap' },
      { id: 'b', x: 8, y: 2, w: 3, d: 3, door: { tx: 9, ty: 4 } },
      { id: 'c', x: 12, y: 2, w: 3, d: 3, feature: 'caja' },
    ])
    expect(doors.map(d => d.buildingId)).toEqual(['a'])
    expect(doors[0].exit).toEqual({ tx: 3, ty: 5, dir: 'down' })
    expect(doorAt(doors, 3, 4)).toBe(doors[0])
    expect(doorAt(doors, 3, 5)).toBeNull()
  })

  it('maps taps on the footprint and the façade drawn above it to the door', () => {
    const [door] = buildingDoors([{ id: 'a', x: 10, y: 10, w: 4, d: 3, door: { tx: 11, ty: 12 }, feature: 'swap' }])
    expect(doorForTap([door], { tx: 13, ty: 12 })).toBe(door)
    expect(doorForTap([door], { tx: 10, ty: 8 })).toBe(door)
    expect(doorForTap([door], { tx: 10, ty: 7 })).toBeNull()
    expect(doorForTap([door], { tx: 14, ty: 11 })).toBeNull()
    expect(doorForTap([door], { tx: 11, ty: 13 })).toBeNull() // the street in front
  })
})

describe('Entrances', () => {
  it('reports entering when the player steps onto a door (onEnterBuilding)', () => {
    const onEnter = vi.fn()
    const entrances = new Entrances(onEnter)
    expect(entrances.arrive(town, shop.exit.tx, shop.exit.ty)).toBe(false)
    expect(onEnter).not.toHaveBeenCalled()
    expect(entrances.arrive(town, shop.door.tx, shop.door.ty)).toBe(true)
    expect(onEnter).toHaveBeenCalledWith(shop)
  })

  it('retargets taps on feature buildings only, and never over a character', () => {
    const entrances = new Entrances()
    const onShop = { tile: { tx: shop.footprint.x, ty: shop.footprint.y }, actor: null }
    expect(entrances.retarget(town, onShop)).toEqual({ tile: shop.door, actor: null })

    const house = HEARTHOME.buildings.find(b => b.id === 'house1')!
    const onHouse = { tile: { tx: house.x, ty: house.y + 1 }, actor: null }
    expect(entrances.retarget(town, onHouse)).toBe(onHouse)

    const npc = createActor({ id: 'n', kind: 'npc', habitat: 'land', tx: shop.exit.tx, ty: shop.exit.ty })
    const onNpc = { tile: { tx: npc.tx, ty: npc.ty - 1 }, actor: npc }
    expect(entrances.retarget(town, onNpc)).toBe(onNpc)
  })

  it('knows where to stand after leaving, and worlds have no doors', () => {
    const entrances = new Entrances()
    expect(entrances.exitFor(town, 'mercado')).toEqual(shop.exit)
    const world = new WildArea(WORLDS[0], LOBBY_ID)
    expect(entrances.exitFor(world, 'mercado')).toBeNull()
    expect(entrances.arrive(world, 0, 0)).toBe(false)
  })

  it('walks from the spawn into every feature building after tapping it', () => {
    for (const door of town.doors) {
      const onEnter = vi.fn()
      const entrances = new Entrances(onEnter)
      const player = createActor({ id: 'p', kind: 'player', habitat: 'any', tx: HEARTHOME.spawn.tx, ty: HEARTHOME.spawn.ty, speed: WALK_SPEED })
      const solid = (tx: number, ty: number) => town.isSolid(tx, ty)
      const nav = new TapNavigator({ isSolid: solid, occupied: () => false })
      const rules: MoveRules = { blocked: (_a, tx, ty) => solid(tx, ty), occupied: () => false }
      const walker = createWalkerState()
      const tapped = { tile: { tx: door.footprint.x + door.footprint.w - 1, ty: door.footprint.y }, actor: null }

      expect(nav.goTo(player, entrances.retarget(town, tapped)), door.buildingId).toBe(true)
      for (let t = 0; t < 30 && !onEnter.mock.calls.length; t += 1 / 60) {
        driveWalker(player, nav.next, 1 / 60, rules, walker, (tx, ty) => {
          nav.arrived()
          if (entrances.arrive(town, tx, ty)) nav.cancel()
        }, true)
        nav.update(player, 1 / 60)
      }
      expect(onEnter, door.buildingId).toHaveBeenCalledWith(door)
      expect([player.tx, player.ty]).toEqual([door.door.tx, door.door.ty])
    }
  })
})
