// ECO-CAPACITY-1: population zones inside one area. Every limit applies at
// once; maxima are not reservations; capacity blocks are diagnosed apart
// from pool gaps.

import { describe, expect, it } from 'vitest'
import { validatePopulationConfig } from './config'
import { capacityReport, spawnFailureCategory } from './capacity'
import { createPopulation, retireEncounter, tickPopulation } from './engine'
import { caveArea, caveNest, deps, gridGeometry, populationConfig, populationViolations, row, seeded } from './testing'
import type { AreaConfig, PopulationConfig, PopulationEvent, PopulationState, RandomSource } from './types'

const AREA = 'cueva-inicial'
const geometry = () => gridGeometry()
const alive = (s: PopulationState) => Object.values(s.nests).flatMap(n => n.alive)
const inZone = (s: PopulationState, config: PopulationConfig, zone: string) =>
  config.areas[0].nests.filter(n => n.populationZoneId === zone).reduce((sum, n) => sum + s.nests[`${AREA}/${n.id}`].alive.length, 0)

/** Per-member nests keep topping up to their maximum, which is what stresses zone and area limits. */
const TOP_UP = { policy: 'per-member' as const, delayMs: 10_000, jitter: 0, retryMs: 5_000 }

/** "abierta": 3 nests (up to 9 alive); "bosque": 1 nest (up to 3). Cave pool, synthetic tiles. */
function twoZones(over: Partial<AreaConfig> = {}, abiertaMax: number | null = 6, bosqueMax: number | null = 3): PopulationConfig {
  const nests = [
    caveNest('a1', row(1, 0, 9), { populationZoneId: 'abierta', respawn: TOP_UP }),
    caveNest('a2', row(2, 0, 9), { populationZoneId: 'abierta', respawn: TOP_UP }),
    caveNest('a3', row(3, 0, 9), { populationZoneId: 'abierta', respawn: TOP_UP }),
    caveNest('b1', row(5, 0, 9), { populationZoneId: 'bosque', respawn: TOP_UP }),
  ]
  return populationConfig([caveArea(nests, {
    maxAlive: 9,
    zones: [{ id: 'abierta', ...(abiertaMax === null ? {} : { maxAlive: abiertaMax }) }, { id: 'bosque', ...(bosqueMax === null ? {} : { maxAlive: bosqueMax }) }],
    ...over,
  })])
}

function run(config: PopulationConfig, opts: { steps?: number; random?: RandomSource; retire?: number; check?: PopulationConfig } = {}) {
  const created = createPopulation(config, deps)
  if (!created.ok) throw new Error(JSON.stringify(created.issues))
  let state = created.state
  const random = opts.random ?? seeded(5)
  const events: PopulationEvent[] = []
  let now = 0
  const violations: string[] = []
  for (let i = 0; i < (opts.steps ?? 60); i++) {
    const r = tickPopulation(state, config, deps, { now, activeAreas: new Set([AREA]), geometry, random })
    if (!r.ok) throw new Error(r.reason)
    state = r.state
    events.push(...r.events)
    violations.push(...populationViolations(state, opts.check ?? config, geometry))
    for (const e of alive(state)) {
      if (random() < (opts.retire ?? 0)) {
        const out = retireEncounter(state, config, { encounterId: e.id, cause: 'defeated', now, random })
        if (out.ok) state = out.state
      }
    }
    now += 20_000
  }
  return { state, events, violations: [...new Set(violations)] }
}
const failures = (events: PopulationEvent[]) => events.flatMap(e => (e.type === 'spawn-failed' ? [e.reason] : []))

describe('two zones sharing one area', () => {
  it('respect nest, zone and area limits at once, over a long busy run', () => {
    const { violations, events } = run(twoZones(), { steps: 400, retire: 0.3 })
    expect(violations).toEqual([])
    expect(failures(events)).toContain('zone-full')
  })

  it('a saturated zone stops at its maximum while the other zone still fills', () => {
    const config = twoZones()
    const { state, events } = run(config, { steps: 30 })
    expect(inZone(state, config, 'abierta')).toBe(6)
    expect(inZone(state, config, 'bosque')).toBeGreaterThan(0)
    expect(failures(events)).toContain('zone-full')
    expect(failures(events)).not.toContain('area-full') // 6 + 3 = 9 = area: no contention in this config
  })

  it('maxima are not reservations: without the abierta maximum, bosque can find the area full', () => {
    const config = twoZones({ maxAlive: 9 }, null, 3)
    const report = capacityReport(config.areas[0])
    expect(report.zones.find(z => z.zoneId === 'bosque')!.guaranteed).toBe(0) // abierta can take all 9
    const { events, violations } = run(config, { steps: 300, retire: 0.15, random: seeded(21) })
    expect(violations).toEqual([])
    const bosqueBlocks = events.filter(e => e.type === 'spawn-failed' && e.nestId === 'b1').map(e => (e as { reason: string }).reason)
    expect(bosqueBlocks).toContain('area-full') // nothing kept room for it
    // With the abierta maximum (6 + 3 = 9 = area), the same run never blocks bosque on the area.
    const capped = run(twoZones({ maxAlive: 9 }), { steps: 300, retire: 0.15, random: seeded(21) })
    expect(capped.events.filter(e => e.type === 'spawn-failed' && e.nestId === 'b1').map(e => (e as { reason: string }).reason)).not.toContain('area-full')
  })

  it('an area total below the sum of maxima is reported as contention, with the numeric guarantee per zone', () => {
    const config = twoZones({ maxAlive: 7 })
    const report = capacityReport(config.areas[0])
    expect(report.contention).toBe(true)
    expect(report.zones.map(z => [z.zoneId, z.ceiling, z.guaranteed])).toEqual([['abierta', 6, 4], ['bosque', 3, 1]])
    expect(report.notes.join('\n')).toMatch(/Σ zone ceilings 9 > area max 7/)
    expect(capacityReport(twoZones().areas[0]).contention).toBe(false)
  })
})

describe('groups and room', () => {
  it('a group that does not fit the remaining room is not shrunk below its minimum and is diagnosed as capacity', () => {
    // Zubat-only nest (common: Zubat 2–3) in a zone with room 1.
    const config = populationConfig([caveArea([
      caveNest('fill', row(1, 0, 9), { habitats: ['cave-nook'], populationZoneId: 'z', respawn: TOP_UP }), // Whismur & co., groups of 1
      caveNest('bats', row(3, 0, 9), { habitats: ['cave-ceiling'], populationZoneId: 'z', respawn: TOP_UP }), // common = Zubat 2–3 only
    ], { maxAlive: 9, zones: [{ id: 'z', maxAlive: 4 }] })])
    const { events, violations } = run(config, { steps: 300, retire: 0.3, random: seeded(9) })
    expect(violations).toEqual([])
    for (const e of events) if (e.type === 'spawned' && e.encounters[0].speciesId === 41) expect(e.encounters.length).toBeGreaterThanOrEqual(2)
    const noRoom = events.flatMap(e => (e.type === 'spawn-failed' && e.reason === 'no-room-for-group' ? [e] : []))
    expect(noRoom.length).toBeGreaterThan(0)
    expect(noRoom.every(e => e.nestId === 'bats')).toBe(true)
    expect(noRoom.map(e => e.limitedBy)).toContain('zone')
    expect(spawnFailureCategory('no-room-for-group')).toBe('group-room')
    expect(spawnFailureCategory('empty-tier')).toBe('pool')
  })

  it('a real pool gap is still empty-tier', () => {
    const config = populationConfig([caveArea([caveNest('bats', row(3, 0, 9), { habitats: ['cave-ceiling'], populationZoneId: 'z' })], { zones: [{ id: 'z' }] })])
    expect(failures(run(config, { steps: 80 }).events)).toContain('empty-tier') // ceiling has no uncommon / very rare entry
  })
})

describe('transitions', () => {
  it('retirement frees zone capacity and the blocked nest fills again', () => {
    const config = twoZones()
    let { state } = run(config, { steps: 30 })
    expect(inZone(state, config, 'abierta')).toBe(6)
    for (const e of alive(state).filter(x => x.nestId.startsWith('a'))) {
      const out = retireEncounter(state, config, { encounterId: e.id, cause: 'defeated', now: 600_000, random: seeded(1) })
      if (out.ok) state = out.state
    }
    expect(inZone(state, config, 'abierta')).toBe(0)
    const r = tickPopulation(state, config, deps, { now: 600_000 + 120_000, activeAreas: new Set([AREA]), geometry, random: seeded(2) })
    if (!r.ok) throw new Error(r.reason)
    expect(inZone(r.state, config, 'abierta')).toBeGreaterThan(0)
    expect(populationViolations(r.state, config, geometry)).toEqual([])
  })

  it('idle and dormant areas keep zone limits on return', () => {
    const config = twoZones()
    const created = createPopulation(config, deps)
    if (!created.ok) throw new Error('config')
    let s = created.state
    const tick = (now: number, on: boolean) => {
      const r = tickPopulation(s, config, deps, { now, activeAreas: new Set(on ? [AREA] : []), geometry, random: seeded(now) })
      if (!r.ok) throw new Error(r.reason)
      s = r.state
      expect(populationViolations(s, config, geometry)).toEqual([])
    }
    for (const t of [0, 20_000, 40_000]) tick(t, true)
    tick(60_000, false)
    tick(400_000, false)
    expect(alive(s)).toEqual([])
    for (const t of [500_000, 520_000, 540_000, 560_000]) tick(t, true)
    expect(inZone(s, config, 'abierta')).toBeLessThanOrEqual(6)
    expect(alive(s).length).toBeGreaterThan(0)
  })

  it('repeated evaluations at the same instant change nothing, and runs are deterministic', () => {
    const config = twoZones()
    const a = run(config, { steps: 25, random: seeded(77) })
    const b = run(config, { steps: 25, random: seeded(77) })
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state))
    const again = tickPopulation(a.state, config, deps, { now: a.state.lastTickAt!, activeAreas: new Set([AREA]), geometry, random: seeded(1) })
    expect(again.ok && again.events).toEqual([])
    expect(again.ok && again.state.nests).toEqual(a.state.nests)
  })
})

describe('configuration', () => {
  const codes = (config: PopulationConfig) => validatePopulationConfig(config, deps.catalog).map(i => i.code)

  it('accepts zones, zone-less nests next to zoned ones, and configs without zones (unchanged)', () => {
    expect(codes(twoZones())).toEqual([])
    const mixed = twoZones()
    expect(codes({ ...mixed, areas: [{ ...mixed.areas[0], nests: [...mixed.areas[0].nests, caveNest('free', row(7, 0, 9))] }] })).toEqual([])
    expect(codes(populationConfig([caveArea([caveNest('n', row(1, 0, 9))])]))).toEqual([])
  })

  it('refuses wrong zone references and invalid limits', () => {
    const base = twoZones()
    const area = base.areas[0]
    const withArea = (patch: Partial<AreaConfig> | Record<string, unknown>) => ({ ...base, areas: [{ ...area, ...patch } as AreaConfig] })
    expect(codes(withArea({ nests: [...area.nests, caveNest('ghost', row(7, 0, 9), { populationZoneId: 'pantano' })] }))).toContain('unknown-population-zone')
    expect(codes(withArea({ zones: [{ id: 'abierta' }, { id: 'abierta' }] }))).toContain('duplicate-population-zone')
    expect(codes(withArea({ zones: [{ id: 'a:b' }, { id: 'bosque' }] }))).toEqual(expect.arrayContaining(['invalid-id', 'unknown-population-zone']))
    for (const maxAlive of [0, -1, 1.5, Number.NaN, '3']) {
      expect(codes(withArea({ zones: [{ id: 'abierta', maxAlive }, { id: 'bosque' }] })), String(maxAlive)).toContain('invalid-limit')
    }
  })
})

describe('negative controls: removing a limit makes the excess visible, for the right cause', () => {
  it('without the zone maximum, the zone exceeds it', () => {
    // Area 12 so that only the zone maximum (6) can stop abierta's three nests (up to 9).
    const intended = twoZones({ maxAlive: 12 })
    const { violations } = run(twoZones({ maxAlive: 12 }, null, 3), { steps: 30, check: intended })
    expect(violations.join('\n')).toMatch(/zone abierta holds [7-9] > 6/)
    expect(violations.join('\n')).not.toMatch(/area/)
  })

  it('without the area maximum, the area exceeds it', () => {
    const intended = twoZones({ maxAlive: 7 })
    const { violations } = run(twoZones({ maxAlive: 99 }), { steps: 30, check: intended })
    expect(violations.join('\n')).toMatch(/area cueva-inicial holds (8|9) > 7/)
    expect(violations.join('\n')).not.toMatch(/zone/)
  })
})
