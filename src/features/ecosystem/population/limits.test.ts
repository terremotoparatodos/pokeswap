// Limits, geometry, catalog exclusions and invalid pools: the engine never
// exceeds a limit, never invents a place, never invents an encounter.

import { describe, expect, it } from 'vitest'
import { ECO_1_ENCOUNTER_CATALOG } from '../encounters/initialCatalog'
import type { EncounterCatalog } from '../encounters/types'
import { createPopulation, retireEncounter, tickPopulation } from './engine'
import { publicArea } from './projection'
import { caveArea, caveNest, gridGeometry, populationConfig, populationViolations, row, scripted, seeded } from './testing'
import type { AreaGeometry, PopulationConfig, PopulationEvent, PopulationState, RandomSource } from './types'

const AREA = 'cueva-inicial'
const T0 = 2_000_000

function run(config: PopulationConfig, options: { catalog?: EncounterCatalog; geometry?: AreaGeometry | null; random?: RandomSource; steps?: number; retire?: number } = {}) {
  const catalog = options.catalog ?? ECO_1_ENCOUNTER_CATALOG
  const geo = () => (options.geometry === undefined ? gridGeometry() : options.geometry)
  const random = options.random ?? seeded(11)
  const created = createPopulation(config, { catalog })
  if (!created.ok) throw new Error(JSON.stringify(created.issues))
  let state: PopulationState = created.state
  const events: PopulationEvent[] = []
  let now = T0
  for (let step = 0; step < (options.steps ?? 1); step++) {
    const r = tickPopulation(state, config, { catalog }, { now, activeAreas: new Set([AREA]), geometry: geo, random })
    if (!r.ok) throw new Error(r.reason)
    state = r.state
    events.push(...r.events)
    expect(populationViolations(state, config, geo)).toEqual([])
    for (const encounter of Object.values(state.nests).flatMap(n => n.alive)) {
      if (random() < (options.retire ?? 0)) {
        const retired = retireEncounter(state, config, { encounterId: encounter.id, cause: 'defeated', now, random })
        if (retired.ok) state = retired.state
      }
    }
    now += 20_000
  }
  return { state, events, alive: Object.values(state.nests).flatMap(n => n.alive) }
}

const spawned = (events: readonly PopulationEvent[]) => events.flatMap(e => (e.type === 'spawned' ? e.encounters : []))
const failures = (events: readonly PopulationEvent[]) => events.flatMap(e => (e.type === 'spawn-failed' ? [e.reason] : []))

describe('limits', () => {
  it('nest and area limits hold through a long, busy simulation', () => {
    const config = populationConfig([caveArea([caveNest('a', row(1, 0, 9)), caveNest('b', row(2, 0, 9)), caveNest('c', row(3, 0, 9))], { maxAlive: 5 })])
    const { events } = run(config, { steps: 400, retire: 0.3 })
    expect(spawned(events).length).toBeGreaterThan(100)
    expect(failures(events)).toContain('area-full')
  })

  it('a group never exceeds the nest cap: with groupCap 1 a Zubat colony (2–3) cannot appear', () => {
    const config = populationConfig([caveArea([caveNest('a', row(1, 0, 9), { groupCap: 1, maxAlive: 1 })])])
    const { events } = run(config, { steps: 300, retire: 0.5 })
    expect(spawned(events).length).toBeGreaterThan(50)
    expect(spawned(events).every(e => e.groupSize === 1 && e.speciesId !== 41)).toBe(true)
  })
})

describe('geometry', () => {
  it('no open tile → no encounter, a retry, and no invented position', () => {
    const tiles = row(1, 0, 4)
    const config = populationConfig([caveArea([caveNest('a', tiles)])])
    const { alive, events } = run(config, { steps: 5, geometry: gridGeometry(tiles) })
    expect(alive).toEqual([])
    expect(failures(events)).toContain('no-open-tile')
  })

  it('no geometry for the area → nothing spawns', () => {
    const config = populationConfig([caveArea([caveNest('a', row(1, 0, 4))])])
    const { alive, events } = run(config, { steps: 3, geometry: null })
    expect(alive).toEqual([])
    expect(failures(events)).toContain('no-geometry')
  })

  it('a group is clamped to the open tiles; entries that need more room are skipped, not squeezed', () => {
    const config = populationConfig([caveArea([caveNest('a', [{ tx: 0, ty: 0 }])])])
    const { events } = run(config, { steps: 300, retire: 0.6 })
    expect(spawned(events).length).toBeGreaterThan(50)
    expect(spawned(events).every(e => e.groupSize === 1 && e.speciesId !== 41)).toBe(true)
  })

  it('nests sharing tiles never stack two encounters on one tile', () => {
    const shared = row(1, 0, 2)
    const config = populationConfig([caveArea([caveNest('a', shared), caveNest('b', shared)])])
    const { alive } = run(config, { steps: 50, retire: 0.2 })
    expect(new Set(alive.map(e => `${e.tile.tx},${e.tile.ty}`)).size).toBe(alive.length)
  })
})

describe('catalog', () => {
  it('a nest only hosts its habitats: a ceiling nest yields Zubat and Golbat', () => {
    const config = populationConfig([caveArea([caveNest('a', row(1, 0, 9), { habitats: ['cave-ceiling'] })])])
    const { events } = run(config, { steps: 200, retire: 0.5 })
    const species = new Set(spawned(events).map(e => e.speciesId))
    expect([...species].every(id => id === 41 || id === 42)).toBe(true)
    // Common is all Zubat; other tiers of this nest are empty and say so instead of borrowing another habitat.
    expect(failures(events)).toContain('empty-tier')
  })

  it('never spawns an excluded species, even from a tainted catalog', () => {
    const mewtwo = { ...ECO_1_ENCOUNTER_CATALOG.entries.find(e => e.id === 'cueva-inicial:zubat')!, id: 'cueva-inicial:mewtwo', speciesId: 150, speciesName: 'mewtwo', familyId: 150, weight: 1_000 }
    const tainted: EncounterCatalog = { ...ECO_1_ENCOUNTER_CATALOG, entries: [mewtwo, ...ECO_1_ENCOUNTER_CATALOG.entries] }
    const config = populationConfig([caveArea([caveNest('a', row(1, 0, 9))])])
    const { events } = run(config, { catalog: tainted, steps: 200, retire: 0.5 })
    expect(spawned(events).length).toBeGreaterThan(30)
    expect(spawned(events).some(e => e.speciesId === 150)).toBe(false)
  })

  it('an invalid distribution or an emptied pool spawns nothing and retries later', () => {
    const zeroShares: EncounterCatalog = {
      ...ECO_1_ENCOUNTER_CATALOG,
      zones: ECO_1_ENCOUNTER_CATALOG.zones.map(z => (z.id === AREA ? { ...z, rarityShares: { common: 0, uncommon: 0, rare: 0, very_rare: 0 } } : z)),
    }
    const config = populationConfig([caveArea([caveNest('a', row(1, 0, 9))])])
    const invalid = run(config, { catalog: zeroShares, steps: 10 })
    expect(invalid.alive).toEqual([])
    expect(new Set(failures(invalid.events))).toEqual(new Set(['invalid-distribution']))

    // Every cave entry turned into an event-only species: the pool exists but has no candidate.
    const allExcluded: EncounterCatalog = {
      ...ECO_1_ENCOUNTER_CATALOG,
      entries: ECO_1_ENCOUNTER_CATALOG.entries.map(e => (e.zoneId === AREA ? { ...e, speciesId: 150, speciesName: 'mewtwo' } : e)),
    }
    const empty = run(config, { catalog: allExcluded, steps: 10 })
    expect(empty.alive).toEqual([])
    expect(new Set(failures(empty.events))).toEqual(new Set(['empty-tier']))
  })
})

describe('projection', () => {
  it('publishes identity, species, tile and group — never due times, rarity, entry or generation fields', () => {
    const config = populationConfig([caveArea([caveNest('a', row(1, 0, 9))])])
    const { state } = run(config, { steps: 2 })
    const view = publicArea(state, AREA)
    expect(view.simulated).toBe(true)
    expect(view.encounters.length).toBeGreaterThan(0)
    for (const encounter of view.encounters) expect(Object.keys(encounter).sort()).toEqual(['groupId', 'id', 'speciesId', 'tile'])
    expect(JSON.stringify(view)).not.toMatch(/dueAt|rarity|entryId|generation|lastTickAt/)
  })
})

describe('the invariant checker itself (negative controls)', () => {
  const config = populationConfig([caveArea([caveNest('a', row(1, 0, 3), { maxAlive: 2 }), caveNest('b', row(2, 0, 3), { maxAlive: 2 })], { maxAlive: 3 })])
  const geo = () => gridGeometry([{ tx: 3, ty: 1 }])
  const base = run(config, { steps: 1, random: scripted(0) }).state
  const enc = (nestId: string, i: number, tile = { tx: i, ty: nestId === 'a' ? 1 : 2 }) =>
    ({ id: `test-epoch-1:${AREA}:${nestId}:1:${i}`, groupId: `test-epoch-1:${AREA}:${nestId}:1`, areaId: AREA, nestId, generation: 1, member: i, groupSize: 1, entryId: 'x', speciesId: 74, familyId: 74, rarity: 'common' as const, tile, spawnedAt: T0 })
  const withAlive = (a: ReturnType<typeof enc>[], b: ReturnType<typeof enc>[] = []): PopulationState => ({
    ...base,
    nests: { [`${AREA}/a`]: { generation: 1, alive: a, dueAt: null }, [`${AREA}/b`]: { generation: 1, alive: b, dueAt: null } },
  })

  it('flags each broken invariant', () => {
    expect(populationViolations(withAlive([enc('a', 0)]), config, geo)).toEqual([])
    expect(populationViolations(withAlive([enc('a', 0), enc('a', 1), enc('a', 2)]), config, geo).join()).toMatch(/nest a holds 3 > 2/)
    expect(populationViolations(withAlive([enc('a', 0), enc('a', 1)], [enc('b', 0), enc('b', 1)]), config, geo).join()).toMatch(/area .* holds 4 > 3/)
    expect(populationViolations(withAlive([enc('a', 0), enc('a', 0, { tx: 1, ty: 1 })]), config, geo).join()).toMatch(/duplicate id/)
    expect(populationViolations(withAlive([enc('a', 0), enc('a', 1, { tx: 0, ty: 1 })]), config, geo).join()).toMatch(/two encounters on 0,1/)
    expect(populationViolations(withAlive([enc('a', 0, { tx: 9, ty: 9 })]), config, geo).join()).toMatch(/outside its nest tiles/)
    expect(populationViolations(withAlive([enc('a', 3)]), config, geo).join()).toMatch(/blocked tile/)
    expect(populationViolations(withAlive([{ ...enc('a', 0), generation: 5 }]), config, geo).join()).toMatch(/future generation/)
  })
})
