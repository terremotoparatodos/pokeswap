// Invalid configuration is refused before any state exists.

import { describe, expect, it } from 'vitest'
import { validatePopulationConfig, type PopulationConfigIssueCode } from './config'
import { createPopulation } from './engine'
import { caveArea, caveNest, deps, populationConfig, row } from './testing'
import type { AreaConfig, NestConfig, PopulationConfig } from './types'

const nest = caveNest('n1', row(3, 2, 6))
const valid = populationConfig([caveArea([nest])])
const codes = (config: PopulationConfig): PopulationConfigIssueCode[] => validatePopulationConfig(config, deps.catalog).map(i => i.code)
const withNest = (patch: Partial<NestConfig> | Record<string, unknown>) => populationConfig([caveArea([{ ...nest, ...patch } as NestConfig])])
const withArea = (patch: Partial<AreaConfig> | Record<string, unknown>) => populationConfig([{ ...caveArea([nest]), ...patch } as AreaConfig])

describe('population config', () => {
  it('accepts the fixture and creates a dormant, empty population', () => {
    expect(codes(valid)).toEqual([])
    const created = createPopulation(valid, deps)
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.state.areas['cueva-inicial']).toEqual({ status: 'dormant', since: null })
    expect(created.state.nests['cueva-inicial/n1']).toEqual({ generation: 0, alive: [], dueAt: null })
  })

  it('refuses ids that would break encounter ids, and duplicates', () => {
    expect(codes(populationConfig([caveArea([nest])], 'epoch:1'))).toContain('invalid-namespace')
    expect(codes(populationConfig([caveArea([nest])], ''))).toContain('invalid-namespace')
    expect(codes(withNest({ id: 'a:b' }))).toContain('invalid-id')
    expect(codes(populationConfig([caveArea([nest]), caveArea([nest])]))).toContain('duplicate-area')
    expect(codes(populationConfig([caveArea([nest, nest])]))).toContain('duplicate-nest')
  })

  it('refuses limits that are not positive integers', () => {
    for (const maxAlive of [0, -1, 1.5, Number.NaN]) expect(codes(withNest({ maxAlive })), String(maxAlive)).toContain('invalid-limit')
    expect(codes(withNest({ groupCap: 0 }))).toContain('invalid-limit')
    expect(codes(withArea({ maxAlive: 0 }))).toContain('invalid-limit')
  })

  it('refuses a respawn policy that could loop or misbehave', () => {
    const r = nest.respawn
    expect(codes(withNest({ respawn: { ...r, retryMs: 0 } }))).toContain('invalid-respawn') // would retry at the same instant forever
    expect(codes(withNest({ respawn: { ...r, delayMs: -1 } }))).toContain('invalid-respawn')
    expect(codes(withNest({ respawn: { ...r, jitter: 0.7 } }))).toContain('invalid-respawn')
    expect(codes(withNest({ respawn: { ...r, policy: 'per-hour' } }))).toContain('invalid-respawn')
    expect(codes(withArea({ idle: { dormantAfterMs: 1, staggerMinMs: 10, staggerMaxMs: 5 } }))).toContain('invalid-idle')
  })

  it('refuses pools that do not exist or do not belong to the area', () => {
    expect(codes(withNest({ zoneId: 'cueva-perdida' }))).toContain('unknown-zone')
    expect(codes(withNest({ zoneId: 'pradera.bosque', habitats: ['undergrowth'] }))).toContain('zone-area-mismatch')
    expect(codes(withNest({ habitats: ['lava'] }))).toContain('unknown-habitat')
    expect(codes(withNest({ habitats: [] }))).toContain('unknown-habitat')
    expect(codes(withNest({ habitats: ['open-grass'] }))).toContain('habitat-without-entries')
  })

  it('refuses missing, fractional or repeated candidate tiles', () => {
    expect(codes(withNest({ tiles: [] }))).toContain('no-tiles')
    expect(codes(withNest({ tiles: [{ tx: 1.5, ty: 2 }] }))).toContain('invalid-tile')
    expect(codes(withNest({ tiles: [{ tx: 1, ty: 2 }, { tx: 1, ty: 2 }] }))).toContain('duplicate-tile')
  })

  it('createPopulation returns the issues instead of a state', () => {
    const created = createPopulation(withNest({ maxAlive: 0 }), deps)
    expect(created.ok).toBe(false)
    if (!created.ok) expect(created.issues.map(i => i.code)).toEqual(['invalid-limit'])
  })
})
