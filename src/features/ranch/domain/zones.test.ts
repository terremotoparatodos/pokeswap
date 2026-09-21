import { describe, expect, it } from 'vitest'
import { assignHomes, preferredZone, ZONE_IDS, ZONES, type ZoneId } from './zones'

const roomy = Object.fromEntries(ZONE_IDS.map(z => [z, 10_000])) as Record<ZoneId, number>
const ids = (n: number) => Array.from({ length: n }, (_, i) => `r${i}`)

describe('assignHomes', () => {
  it('shares sum to one', () => {
    expect(ZONE_IDS.reduce((sum, z) => sum + ZONES[z].share, 0)).toBeCloseTo(1, 10)
  })

  it('is deterministic and gives each member its preferred zone while there is room', () => {
    const a = assignHomes(ids(300), roomy)
    const b = assignHomes(ids(300), roomy)
    expect([...a]).toEqual([...b])
    for (const [id, home] of a) expect(home.zone).toBe(preferredZone(id))
  })

  it('is prefix-stable: newcomers never move earlier members', () => {
    const small = assignHomes(ids(100), roomy)
    const large = assignHomes(ids(2000), roomy)
    for (const [id, home] of small) expect(large.get(id)).toEqual(home)
  })

  it('never reuses an address and fills slots from zero', () => {
    const homes = assignHomes(ids(500), roomy)
    const addresses = new Set([...homes.values()].map(h => `${h.zone}:${h.slot}`))
    expect(addresses.size).toBe(500)
    for (const zone of ZONE_IDS) {
      const slots = [...homes.values()].filter(h => h.zone === zone).map(h => h.slot).sort((x, y) => x - y)
      expect(slots).toEqual(slots.map((_, i) => i))
    }
  })

  it('sends members to the roomiest zone when theirs is full, and drops them past capacity', () => {
    const capacity = { ...roomy, casa: 0, prado: 0, lago: 0, bosque: 0, flores: 0, rocas: 3, corrales: 1, descanso: 0 }
    const homes = assignHomes(ids(10), capacity)
    expect(homes.size).toBe(4)
    expect([...homes.values()].filter(h => h.zone === 'rocas')).toHaveLength(3)
    expect([...homes.values()].filter(h => h.zone === 'corrales')).toHaveLength(1)
  })

  it('spreads newcomers roughly by share', () => {
    const homes = assignHomes(ids(4000), roomy)
    for (const zone of ZONE_IDS) {
      const count = [...homes.values()].filter(h => h.zone === zone).length
      expect(count / 4000).toBeGreaterThan(ZONES[zone].share * 0.8)
      expect(count / 4000).toBeLessThan(ZONES[zone].share * 1.2)
    }
  })
})
