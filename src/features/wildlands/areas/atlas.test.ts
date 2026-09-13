import { describe, expect, it } from 'vitest'
import { portalAt } from '../engine/area'
import { findPath } from '../engine/pathfinding'
import { HEARTHOME, LOBBY_ID, WORLDS } from './atlas'
import { TownArea } from './townArea'
import { WildArea } from './wildArea'

describe('Ciudad Corazón lobby', () => {
  const town = new TownArea(HEARTHOME)
  const W = 64
  const H = 49

  it('has a rectangular 64×49 terrain made only of known cells', () => {
    expect(HEARTHOME.terrain).toHaveLength(H)
    for (const row of HEARTHOME.terrain) {
      expect(row).toHaveLength(W)
      expect(row).toMatch(/^[sgpt]+$/)
    }
  })

  it('treats everything outside the map as blocked', () => {
    expect(town.isSolid(-1, 10)).toBe(true)
    expect(town.isSolid(W, 10)).toBe(true)
    expect(town.isSolid(10, H)).toBe(true)
  })

  it('keeps buildings inside the map and apart from each other', () => {
    const taken = new Map<string, string>()
    for (const b of HEARTHOME.buildings) {
      expect(b.x >= 0 && b.y >= 0 && b.x + b.w <= W && b.y + b.d <= H, b.id).toBe(true)
      for (let y = b.y; y < b.y + b.d; y++) {
        for (let x = b.x; x < b.x + b.w; x++) {
          const key = `${x},${y}`
          expect(taken.get(key), `${b.id} overlaps ${taken.get(key)} at ${key}`).toBeUndefined()
          taken.set(key, b.id)
        }
      }
    }
    for (const p of HEARTHOME.props) {
      expect(taken.has(`${p.tx},${p.ty}`), `${p.kind} at ${p.tx},${p.ty} sits on a building`).toBe(false)
    }
  })

  it('links every gate to a real world, on walkable portal tiles', () => {
    const worldIds = new Set(WORLDS.map(w => w.id))
    expect(town.portals).toHaveLength(WORLDS.length)
    for (const gate of town.portals) {
      expect(worldIds.has(gate.to)).toBe(true)
      for (const t of gate.tiles) {
        expect(town.isSolid(t.tx, t.ty)).toBe(false)
        expect(portalAt(town, t.tx, t.ty)).toBe(gate)
      }
    }
  })

  it('can walk from the spawn to every gate, and gate arrivals are open', () => {
    const blocked = (tx: number, ty: number) => town.isSolid(tx, ty)
    expect(blocked(HEARTHOME.spawn.tx, HEARTHOME.spawn.ty)).toBe(false)
    for (const gate of town.portals) {
      expect(blocked(gate.arrival.tx, gate.arrival.ty), `arrival from ${gate.to}`).toBe(false)
      const goal = gate.tiles[0]
      const path = findPath({
        start: HEARTHOME.spawn, target: goal, blocked, radius: 64, maxNodes: 20000,
        isGoal: (x, y) => x === goal.tx && y === goal.ty,
      })
      expect(path, `path to ${gate.to}`).not.toBeNull()
    }
    expect(town.arrival('costa')).toMatchObject(town.portals.find(g => g.to === 'costa')!.arrival)
    expect(town.arrival(null)).toMatchObject(HEARTHOME.spawn)
  })

  it('lets signs and buildings talk when faced', () => {
    const sign = HEARTHOME.props.find(p => p.kind === 'sign')!
    expect(town.talkAt(sign.tx, sign.ty)).toBe(sign.text)
    const pc = HEARTHOME.buildings.find(b => b.id === 'pokecenter')!
    expect(town.talkAt(pc.x + 2, pc.y + pc.d - 1)).toMatch(/^Centro Pokémon · /)
    expect(town.talkAt(HEARTHOME.spawn.tx, HEARTHOME.spawn.ty)).toBeNull()
  })

  it('places residents, wanderers and Pokémon on open tiles', () => {
    for (const spot of [...HEARTHOME.residents, ...HEARTHOME.wanderers, ...HEARTHOME.pokemon]) {
      expect(town.isSolid(spot.tx, spot.ty), `spot ${spot.tx},${spot.ty}`).toBe(false)
    }
  })
})

describe('worlds', () => {
  it('each world has a unique seed and an open return pad next to its arrival', () => {
    expect(new Set(WORLDS.map(w => w.seed)).size).toBe(WORLDS.length)
    for (const def of WORLDS) {
      const world = new WildArea(def, LOBBY_ID)
      const start = world.arrival()
      const [pad] = world.portals
      expect(pad.to).toBe(LOBBY_ID)
      expect(pad.pad).toBe(true)
      expect(pad.tiles[0]).toEqual({ tx: start.tx, ty: start.ty - 1 })
      expect(world.isSolid(start.tx, start.ty) || world.isWater(start.tx, start.ty)).toBe(false)
      expect(world.isSolid(pad.tiles[0].tx, pad.tiles[0].ty)).toBe(false)
    }
  })
})
