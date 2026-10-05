// Queries and the ticket pick: two-level weights, explicit empty tiers,
// determinism, policy exclusions and independence from ownership.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ECO_1_ENCOUNTER_CATALOG as catalog } from './initialCatalog'
import {
  entriesForSpecies, entriesInFamily, entriesInZone, entriesOfRarity, pickEncounter, ticketFrom, zoneDistribution,
  type EncounterTicket,
} from './queries'
import type { EncounterCatalog, EncounterEntry } from './types'

/** mulberry32 — test-local, seeded; the module under test never owns randomness. */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

afterEach(() => vi.restoreAllMocks())

describe('queries by zone, species, family and rarity', () => {
  it('return entries in catalog order, without deduplicating species across zones', () => {
    expect(entriesInZone(catalog, 'cueva-inicial')).toHaveLength(11)
    expect(entriesForSpecies(catalog, 25).map(entry => entry.zoneId)).toEqual(['pradera.abierta', 'pradera.bosque'])
    expect(entriesInFamily(catalog, 16).map(entry => entry.id)).toEqual(['pradera.abierta:pidgey', 'pradera.abierta:pidgeotto', 'pradera.bosque:pidgeotto'])
    expect(entriesInFamily(catalog, 172).map(entry => entry.speciesName)).toEqual(['pikachu', 'pikachu'])
    expect(entriesOfRarity(catalog, 'very_rare').map(entry => entry.speciesName)).toEqual(['nidorina', 'nidorino', 'forretress', 'dunsparce'])
    expect(entriesOfRarity(catalog, 'rare', 'cueva-inicial')).toHaveLength(4)
    expect(entriesInZone(catalog, 'nowhere')).toEqual([])
    expect(zoneDistribution(catalog, 'nowhere')).toBeNull()
  })

  it('apply tier shares first: a tier of one entry keeps its share, it does not grow to its weight', () => {
    const lonely: EncounterCatalog = {
      ...catalog,
      entries: catalog.entries.filter(entry => entry.zoneId !== 'cueva-inicial' || (entry.speciesName !== 'zubat' && entry.speciesName !== 'whismur')),
    }
    const common = zoneDistribution(lonely, 'cueva-inicial')!.tiers.find(tier => tier.rarity === 'common')!
    expect(common.entries.map(item => [item.entry.speciesName, item.probability])).toEqual([['geodude', 0.7]])
  })
})

describe('empty tiers are explicit', () => {
  const noDunsparce = (entry: EncounterEntry) => entry.speciesName !== 'dunsparce'

  it('keep their probability as unassigned instead of redistributing it', () => {
    const distribution = zoneDistribution(catalog, 'cueva-inicial', noDunsparce)!
    expect(distribution.emptyTiers).toEqual(['very_rare'])
    expect(distribution.unassigned).toBeCloseTo(0.005, 12)
    const assigned = distribution.tiers.flatMap(tier => tier.entries).reduce((sum, item) => sum + item.probability, 0)
    expect(assigned).toBeCloseTo(0.995, 12)
    expect(distribution.tiers.find(tier => tier.rarity === 'common')!.probability).toBe(0.7)
  })

  it('and a pick landing in one says so', () => {
    expect(pickEncounter(catalog, 'cueva-inicial', { tierRoll: 0.999, entryRoll: 0 }, noDunsparce)).toEqual({ ok: false, reason: 'empty-tier', rarity: 'very_rare' })
    expect(pickEncounter(catalog, 'cueva-inicial', { tierRoll: 0.999, entryRoll: 0 }).ok).toBe(true)
    expect(pickEncounter(catalog, 'cueva-inicial', { tierRoll: 0.1, entryRoll: 0 }, noDunsparce).ok).toBe(true)
  })

  it('an all-excluding filter empties every tier', () => {
    const distribution = zoneDistribution(catalog, 'pradera.abierta', () => false)!
    expect(distribution.emptyTiers).toEqual(['common', 'uncommon', 'rare', 'very_rare'])
    expect(distribution.unassigned).toBeCloseTo(1, 12)
  })

  it('an unknown zone is its own answer', () => {
    expect(pickEncounter(catalog, 'nowhere', { tierRoll: 0, entryRoll: 0 })).toEqual({ ok: false, reason: 'unknown-zone' })
  })
})

describe('pickEncounter', () => {
  it('maps tier boundaries exactly: [0, .70) common, [.70, .94) uncommon, [.94, .995) rare, [.995, 1) very rare', () => {
    const rarity = (tierRoll: number) => {
      const result = pickEncounter(catalog, 'pradera.abierta', { tierRoll, entryRoll: 0 })
      return result.ok ? result.rarity : null
    }
    expect([0, 0.6999, 0.7, 0.9399, 0.94, 0.9949, 0.995, 0.9999999].map(rarity)).toEqual([
      'common', 'common', 'uncommon', 'uncommon', 'rare', 'rare', 'very_rare', 'very_rare',
    ])
  })

  it('splits a tier by weight: Pidgey 28 · Rattata 28 · Bidoof 14 of the common 70', () => {
    const name = (entryRoll: number) => {
      const result = pickEncounter(catalog, 'pradera.abierta', { tierRoll: 0, entryRoll })
      return result.ok ? result.entry.speciesName : null
    }
    expect([0, 0.3999, 0.4, 0.7999, 0.8, 0.9999].map(name)).toEqual(['pidgey', 'pidgey', 'rattata', 'rattata', 'bidoof', 'bidoof'])
  })

  it('is deterministic and never touches Math.random', () => {
    const spy = vi.spyOn(Math, 'random')
    const run = () => {
      const next = seeded(42)
      return Array.from({ length: 500 }, () => {
        const result = pickEncounter(catalog, 'pradera.bosque', ticketFrom(next))
        return result.ok ? result.entry.id : result.reason
      })
    }
    expect(run()).toEqual(run())
    expect(spy).not.toHaveBeenCalled()
  })

  it('matches the published distribution on a seeded sample (200 000 picks, ±0.3 pp)', () => {
    const next = seeded(7)
    const counts = new Map<string, number>()
    const N = 200_000
    for (let i = 0; i < N; i++) {
      const result = pickEncounter(catalog, 'cueva-inicial', ticketFrom(next))
      if (result.ok) counts.set(result.entry.id, (counts.get(result.entry.id) ?? 0) + 1)
    }
    for (const tier of zoneDistribution(catalog, 'cueva-inicial')!.tiers) {
      for (const { entry, probability } of tier.entries) expect(Math.abs((counts.get(entry.id) ?? 0) / N - probability), entry.id).toBeLessThan(0.003)
    }
  })

  it('refuses tickets outside [0, 1)', () => {
    for (const ticket of [{ tierRoll: 1, entryRoll: 0 }, { tierRoll: -0.1, entryRoll: 0 }, { tierRoll: 0, entryRoll: Number.NaN }] as EncounterTicket[]) {
      expect(() => pickEncounter(catalog, 'pradera.abierta', ticket)).toThrow(RangeError)
    }
  })

  it('never returns an excluded species, even from a catalog that skipped validation', () => {
    const mewtwo: EncounterEntry = { ...catalog.entries[0], id: 'pradera.abierta:mewtwo', speciesId: 150, speciesName: 'mewtwo', familyId: 150, weight: 10_000 }
    const tainted: EncounterCatalog = { ...catalog, entries: [mewtwo, ...catalog.entries] }
    const next = seeded(3)
    for (let i = 0; i < 2_000; i++) {
      const result = pickEncounter(tainted, 'pradera.abierta', ticketFrom(next))
      expect(result.ok && result.entry.speciesId).not.toBe(150)
    }
    expect(zoneDistribution(tainted, 'pradera.abierta')!.tiers[0].entries.map(item => item.entry.speciesId)).not.toContain(150)
  })
})

describe('exclusion scope in the pick', () => {
  it('follows the catalog for its own categories, and the policy for event-only ones', () => {
    const only = (speciesId: number, speciesName: string): EncounterEntry => ({ ...catalog.entries[0], id: `pradera.abierta:${speciesName}`, speciesId, speciesName, familyId: speciesId })
    const starterZone = (excludedCategories: EncounterCatalog['excludedCategories']): EncounterCatalog => ({ ...catalog, entries: [only(1, 'bulbasaur')], excludedCategories })
    const ticket = { tierRoll: 0, entryRoll: 0 }
    expect(pickEncounter(starterZone(catalog.excludedCategories), 'pradera.abierta', ticket)).toEqual({ ok: false, reason: 'empty-tier', rarity: 'common' })
    const opened = pickEncounter(starterZone([]), 'pradera.abierta', ticket)
    expect(opened.ok && opened.entry.speciesName).toBe('bulbasaur')
    const mythical: EncounterCatalog = { ...catalog, entries: [only(151, 'mew')], excludedCategories: [] }
    expect(pickEncounter(mythical, 'pradera.abierta', ticket)).toEqual({ ok: false, reason: 'empty-tier', rarity: 'common' })
  })
})

describe('ownership', () => {
  it('plays no part: no query takes an owner or an owned set', () => {
    // (catalog, zone, ticket, filter?) and (catalog, zone, filter?): nothing else can reach the pick.
    // The source scan in isolation.test.ts checks the module never reads ownership either.
    expect(pickEncounter.length).toBe(4)
    expect(zoneDistribution.length).toBe(3)
    const pidgey = pickEncounter(catalog, 'pradera.abierta', { tierRoll: 0, entryRoll: 0 })
    expect(pidgey.ok && pidgey.entry.speciesName).toBe('pidgey')
  })
})
