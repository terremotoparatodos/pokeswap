import { describe, expect, it } from 'vitest'
import { T } from '../../wildlands/engine/world'
import { ZONE_IDS } from '../domain/zones'
import { LAKE, PADDOCKS, PROPS, ZONE_FOCUS } from './ranchLayout'
import { RanchMap } from './ranchMap'
import { buildSlots, slotCapacity, SPACED } from './slots'

const map = new RanchMap()
const slots = buildSlots(map)

describe('ranch map', () => {
  it('is deterministic', () => {
    const again = new RanchMap()
    expect(again.solid).toEqual(map.solid)
    expect(again.decor).toEqual(map.decor)
    expect(again.zones).toEqual(map.zones)
  })

  it('opens the entrance and leads the main path to the house', () => {
    for (let y = 80; y < map.h; y++) expect(map.isSolid(60, y), `entrance ${y}`).toBe(false)
    for (let y = 46; y <= 84; y++) expect(map.isPath(60, y), `main path ${y}`).toBe(true)
    expect(map.isSolid(60, 44)).toBe(true) // the house
  })

  it('has a lake of water with a walkable dock', () => {
    expect(map.water[Math.round(LAKE.cy) * map.w + Math.round(LAKE.cx - 4)]).toBe(1)
    // A deep middle for depth, shallow blue everywhere else.
    expect(map.vertexTerrain(LAKE.cx, LAKE.cy)).toBe(T.DEEP)
    expect(map.vertexTerrain(LAKE.cx - 11, LAKE.cy)).toBe(T.WATER)
    for (let y = 29; y <= 34; y++) expect(map.isSolid(86, y), `dock ${y}`).toBe(false)
  })

  it('fences the paddocks except at their gates', () => {
    for (const p of PADDOCKS) {
      for (const gate of p.gates) expect(map.isSolid(gate.x, gate.y)).toBe(false)
      expect(map.fence[p.y0 * map.w + p.x0 + 2]).toBe(1)
      expect(map.zoneAt(p.x0 + 2, p.y0 + 2)).toBe('corrales')
    }
  })

  it('never puts props on the paths', () => {
    for (const prop of PROPS) {
      if (prop.kind === 'arch') continue
      for (let y = prop.at.y0; y <= prop.at.y1; y++) {
        for (let x = prop.at.x0; x <= prop.at.x1; x++) expect(map.isPath(x, y), `${prop.kind} at ${x},${y}`).toBe(false)
      }
    }
  })

  it('places every zone focus inside its own zone', () => {
    for (const zone of ZONE_IDS) {
      const f = ZONE_FOCUS[zone]
      expect(map.zoneAt(Math.floor(f.x), Math.floor(f.y)), zone).toBe(zone)
    }
  })
})

describe('home slots', () => {
  it('only uses habitable tiles of the right zone, each once', () => {
    const seen = new Set<string>()
    for (const zone of ZONE_IDS) {
      for (const { tx, ty } of slots[zone]) {
        expect(map.zoneAt(tx, ty)).toBe(zone)
        expect(map.isHabitable(tx, ty)).toBe(true)
        const key = `${tx},${ty}`
        expect(seen.has(key)).toBe(false)
        seen.add(key)
      }
    }
  })

  it('holds a large community without redrawing the map', () => {
    const capacity = slotCapacity(slots)
    const total = ZONE_IDS.reduce((sum, z) => sum + capacity[z], 0)
    expect(total).toBeGreaterThan(3000)
    for (const zone of ZONE_IDS) expect(capacity[zone], zone).toBeGreaterThan(150)
  })

  it('keeps the first homes of every zone apart', () => {
    for (const zone of ZONE_IDS) {
      const first = slots[zone].slice(0, 40)
      for (let i = 0; i < first.length; i++) {
        for (let j = i + 1; j < first.length; j++) {
          const d = Math.max(Math.abs(first[i].tx - first[j].tx), Math.abs(first[i].ty - first[j].ty))
          expect(d, `${zone} ${i}-${j}`).toBeGreaterThanOrEqual(SPACED)
        }
      }
    }
  })

  it('fills each zone from its focus outward', () => {
    for (const zone of ZONE_IDS) {
      const f = ZONE_FOCUS[zone]
      const dist = (t: { tx: number; ty: number }) => Math.hypot(t.tx + 0.5 - f.x, t.ty + 0.5 - f.y)
      const firstTen = slots[zone].slice(0, 10).map(dist)
      const lastTen = slots[zone].slice(-10).map(dist)
      expect(Math.max(...firstTen), zone).toBeLessThan(Math.min(...lastTen) + 6)
    }
  })
})
