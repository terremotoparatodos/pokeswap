// ECO-BALANCE-1 experiment guards: the comparison changes only what it claims
// to change, uses the product catalog untouched, declares B's shares, and is
// reproducible.

import { describe, expect, it } from 'vitest'
import core from '../../battle/catalog/generated/core.json'
import { ECO_1_ENCOUNTER_CATALOG } from '../encounters/initialCatalog'
import { lookupFromSpeciesList } from '../encounters/testing'
import { validateEncounterCatalog } from '../encounters/validation'
import { analyticMix, declaredShares, experimentCatalog, experimentConfig, nestPools, runOnce, SCENARIOS, VARIANTS, type Variant } from './balance'
import type { PreviewZoneId } from './scenarios'

const ZONES: PreviewZoneId[] = ['pradera.abierta', 'pradera.bosque', 'cueva-inicial']
const VARIANT_IDS = Object.keys(VARIANTS) as Variant[]
const lookup = lookupFromSpeciesList(core.species)

describe('experiment design', () => {
  it('extends the product catalog without changing it, and the result validates', () => {
    const before = JSON.stringify(ECO_1_ENCOUNTER_CATALOG)
    const catalog = experimentCatalog()
    expect(JSON.stringify(ECO_1_ENCOUNTER_CATALOG)).toBe(before)
    expect(catalog.entries.slice(0, 35)).toEqual(ECO_1_ENCOUNTER_CATALOG.entries)
    expect(validateEncounterCatalog(catalog, lookup).issues).toEqual([])
  })

  it('B declares shares only on tiers with candidates, summing to 100', () => {
    for (const zone of ZONES) for (const pool of nestPools(zone, 'B')) {
      const shares = declaredShares(zone, pool)
      expect(Object.values(shares).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 9)
      for (const [tier, share] of Object.entries(shares)) {
        const has = ECO_1_ENCOUNTER_CATALOG.entries.some(e => e.zoneId === zone && pool.includes(e.habitat) && e.rarity === tier)
        expect(share > 0, `${zone} ${pool} ${tier}`).toBe(has)
      }
    }
    // The forest clearing hosts only rares: B turns that nest into a 100 % rare nest.
    expect(declaredShares('pradera.bosque', ['clearing'])).toEqual({ common: 0, uncommon: 0, rare: 100, very_rare: 0 })
  })

  it('variants differ only in nest pools (and, for B, the zone carrying the declared shares)', () => {
    for (const zone of ZONES) {
      const strip = (variant: Variant) => {
        const area = experimentConfig(zone, variant, 1).areas[0]
        return { ...area, nests: area.nests.map(({ habitats, zoneId, ...rest }) => { void habitats; void zoneId; return rest }) }
      }
      for (const variant of VARIANT_IDS) expect(strip(variant), `${zone} ${variant}`).toEqual(strip('A'))
      for (const variant of VARIANT_IDS) expect(experimentConfig(zone, variant, 1).areas[0].nests).toHaveLength(6)
    }
  })

  it('C2 reproduces the zone shares exactly per appearance; A loses a large share of attempts to empty-tier', () => {
    for (const zone of ZONES) {
      const c2 = analyticMix(zone, 'C2')
      expect(c2.emptyTier).toBe(0)
      const expected = { common: 0.7, uncommon: 0.24, rare: 0.055, very_rare: 0.005 }
      for (const [tier, p] of Object.entries(expected)) expect(c2.mix[tier as keyof typeof expected], `${zone} ${tier}`).toBeCloseTo(p, 12)
      expect(analyticMix(zone, 'A').emptyTier).toBeGreaterThan(0.3)
      expect(analyticMix(zone, 'B').emptyTier).toBe(0)
    }
  })
})

describe('runs', () => {
  const catalog = experimentCatalog()

  it('are reproducible: same inputs, identical metrics', () => {
    const scenario = SCENARIOS.find(s => s.id === 'medium')!
    expect(runOnce('cueva-inicial', 'C1', scenario, 30, 1005, catalog)).toEqual(runOnce('cueva-inicial', 'C1', scenario, 30, 1005, catalog))
  })

  it('face the same planned demand in every variant (opportunities do not depend on the population)', () => {
    for (const scenario of SCENARIOS) {
      const planned = VARIANT_IDS.map(v => runOnce('pradera.bosque', v, scenario, 30, 1003, catalog).opportunitiesPlanned)
      expect(new Set(planned).size, scenario.id).toBe(1)
    }
  })

  it('never exceed what was planned, and count what was done', () => {
    for (const variant of VARIANT_IDS) {
      const m = runOnce('cueva-inicial', variant, SCENARIOS.find(s => s.id === 'high')!, 30, 1001, catalog)
      expect(m.retiredDone).toBeLessThanOrEqual(m.opportunitiesPlanned)
      expect(m.retiredPerPlayer).toBeCloseTo(m.retiredDone / 15, 9)
      expect(Object.values(m.byRarity).reduce((a, b) => a + b, 0)).toBe(m.encounters)
    }
  })
})
