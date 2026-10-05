// The proposed initial capacity on the ten ECO-MAP-1 nests: valid for the
// engine, the arithmetic leaves numeric room for the forest, and a stressed
// run respects every limit. Positions, habitats and species are unchanged.

import { describe, expect, it } from 'vitest'
import { ECO_1_ENCOUNTER_CATALOG } from '../encounters/initialCatalog'
import { capacityReport } from '../population/capacity'
import { PROVISIONAL_IDLE, PROVISIONAL_RESPAWN, validatePopulationConfig } from '../population/config'
import { createPopulation, retireEncounter, tickPopulation } from '../population/engine'
import { gridGeometry, populationViolations, seeded } from '../population/testing'
import type { PopulationConfig, PopulationEvent } from '../population/types'
import { NEST_PROPOSALS } from './nestProposals'
import { proposedAreaConfig, PROVISIONAL_CAPACITY } from './capacityProposal'

const deps = { catalog: ECO_1_ENCOUNTER_CATALOG }
const config = (areaId: string, respawn = PROVISIONAL_RESPAWN): PopulationConfig => ({ namespace: 'cap', areas: [proposedAreaConfig(areaId, respawn, PROVISIONAL_IDLE)] })

describe('proposed capacity for the ECO-MAP-1 nests', () => {
  it('keeps the ten nests exactly as proposed and assigns each to the zone of its catalog pool', () => {
    const nests = [...config('pradera').areas[0].nests, ...config('cueva-inicial').areas[0].nests]
    expect(nests.map(n => n.id).sort()).toEqual(NEST_PROPOSALS.map(n => n.id).sort())
    for (const n of nests) {
      const p = NEST_PROPOSALS.find(x => x.id === n.id)!
      expect([n.zoneId, n.habitats, n.maxAlive, n.groupCap]).toEqual([p.zoneId, p.habitats, p.maxAlive, p.groupCap])
    }
    expect(Object.fromEntries(nests.map(n => [n.id, n.populationZoneId]))).toMatchObject({
      'pradera-pastizal-oeste': 'abierta', 'pradera-orilla-este': 'abierta', 'bosque-claro-suroeste': 'bosque', 'cueva-techo-norte': 'cueva',
    })
  })

  it('is a valid engine configuration', () => {
    for (const areaId of Object.keys(PROVISIONAL_CAPACITY)) expect(validatePopulationConfig(config(areaId), ECO_1_ENCOUNTER_CATALOG), areaId).toEqual([])
  })

  it('pradera: 12 + 6 = 18 — no numeric contention; the forest keeps 6 when abierta is at its maximum', () => {
    const report = capacityReport(config('pradera').areas[0])
    expect(report.contention).toBe(false)
    // [zone, max, nests' total, ceiling, numerically guaranteed]
    expect(report.zones.map(z => [z.zoneId, z.max, z.nestTotal, z.ceiling, z.guaranteed])).toEqual([
      ['abierta', 12, 15, 12, 12], ['bosque', 6, 6, 6, 6],
    ])
    // Without the abierta maximum, the same area would leave the forest only 3 numerically.
    const area = config('pradera').areas[0]
    const uncapped = capacityReport({ ...area, zones: [{ id: 'abierta' }, { id: 'bosque', maxAlive: 6 }] })
    expect(uncapped.contention).toBe(true)
    expect(uncapped.zones.find(z => z.zoneId === 'bosque')!.guaranteed).toBe(3)
  })

  it('cueva: one zone; the area total binds (9 possible, 6 allowed) without inter-zone contention', () => {
    const report = capacityReport(config('cueva-inicial').areas[0])
    expect([report.contention, report.zones[0].ceiling]).toEqual([false, 9])
    expect(report.notes.join('\n')).toMatch(/area limit binds/)
  })

  it('a stressed run (top-up respawn, retirements) respects nest, zone and area limits; abierta hits its maximum, the forest is never blocked by the area', () => {
    const stressed = config('pradera', { policy: 'per-member', delayMs: 10_000, jitter: 0.2, retryMs: 5_000 })
    const created = createPopulation(stressed, deps)
    if (!created.ok) throw new Error(JSON.stringify(created.issues))
    let state = created.state
    const random = seeded(2026)
    const events: PopulationEvent[] = []
    let now = 0
    for (let i = 0; i < 400; i++) {
      const r = tickPopulation(state, stressed, deps, { now, activeAreas: new Set(['pradera']), geometry: () => gridGeometry(), random })
      if (!r.ok) throw new Error(r.reason)
      state = r.state
      events.push(...r.events)
      expect(populationViolations(state, stressed, () => gridGeometry())).toEqual([])
      for (const e of Object.values(state.nests).flatMap(n => n.alive)) {
        if (random() < 0.1) { const out = retireEncounter(state, stressed, { encounterId: e.id, cause: 'defeated', now, random }); if (out.ok) state = out.state }
      }
      now += 10_000
    }
    const failed = (pred: (e: PopulationEvent & { type: 'spawn-failed' }) => boolean) => events.filter(e => e.type === 'spawn-failed' && pred(e as never)).length
    expect(failed(e => e.reason === 'zone-full' && e.nestId.startsWith('pradera-'))).toBeGreaterThan(0)
    expect(failed(e => e.reason === 'area-full' && e.nestId.startsWith('bosque-'))).toBe(0)
    expect(events.some(e => e.type === 'spawned' && e.nestId.startsWith('bosque-'))).toBe(true)
  })
})
