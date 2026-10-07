import { describe, expect, it } from 'vitest'
import core from '../../battle/catalog/generated/core.json'
import { ECO_1_ENCOUNTER_CATALOG as catalog } from './initialCatalog'
import { ordinaryEncounterExclusion } from './policy'
import { pickEncounter, zoneDistribution } from './queries'
import { lookupFromSpeciesList } from './testing'
import { validateEncounterCatalog } from './validation'
import type { EncounterCatalog } from './types'

const lookup = lookupFromSpeciesList(core.species)
const ticket = { tierRoll: 0, entryRoll: 0 }
const shares = (values: number[]): EncounterCatalog => ({ ...catalog, zones: catalog.zones.map((z, i) => i ? z : { ...z, rarityShares: { common: values[0], uncommon: values[1], rare: values[2], very_rare: values[3] } }) })

describe('audit F1 / F7 acceptance', () => {
  it.each([[35, 12, 2.75, 0.25], [140, 48, 11, 1], [Number.MAX_VALUE, Number.MAX_VALUE, 0, 0]])('F1 refuses invalid totals %j in picks and distributions', (...values) => {
    const invalid = shares(values)
    expect(pickEncounter(invalid, 'pradera.abierta', ticket)).toEqual({ ok: false, reason: 'invalid-distribution' })
    expect(zoneDistribution(invalid, 'pradera.abierta')).toBeNull()
  })

  it('F1 keeps published probabilities and explicit empty tiers for valid input', () => {
    const d = zoneDistribution(catalog, 'pradera.abierta', e => e.rarity !== 'very_rare')!
    expect(d.unassigned).toBeCloseTo(0.005, 12)
    expect(d.tiers.flatMap(t => t.entries).reduce((s, e) => s + e.probability, d.unassigned)).toBeCloseTo(1, 12)
    expect(pickEncounter(catalog, 'pradera.abierta', { ...ticket, tierRoll: 0.999 }, e => e.rarity !== 'very_rare')).toEqual({ ok: false, reason: 'empty-tier', rarity: 'very_rare' })
  })

  it('F7 rejects overflow of finite weights without choosing the last entry', () => {
    const invalid = { ...catalog, entries: catalog.entries.map(e => e.zoneId === 'pradera.abierta' && e.rarity === 'common' ? { ...e, weight: Number.MAX_VALUE } : e) }
    expect(pickEncounter(invalid, 'pradera.abierta', ticket)).toEqual({ ok: false, reason: 'invalid-distribution' })
    expect(zoneDistribution(invalid, 'pradera.abierta')).toBeNull()
    expect(validateEncounterCatalog(invalid, lookup).issues.map(i => i.code)).toContain('invalid-weight-total')
  })
})

describe('audit F4 acceptance', () => {
  it('F4 missing event classification lists invalidate the catalog', () => {
    const invalid = { ...catalog, categories: [] }
    expect(validateEncounterCatalog(invalid, lookup).ok).toBe(false)
    expect(ordinaryEncounterExclusion(invalid, 150)).toBe('legendary')
    expect(ordinaryEncounterExclusion(invalid, 151)).toBe('mythical')
  })

  it.each([150, 151])('F4 cannot admit event-only species %i after deleting category data', speciesId => {
    const name = lookup(speciesId)!.name
    const invalid: EncounterCatalog = {
      ...catalog, categories: [],
      families: [...catalog.families, { id: speciesId, members: [{ speciesId, speciesName: name, stage: 1 }] }],
      entries: [...catalog.entries.slice(1), { ...catalog.entries[0], id: `pradera.abierta:${name}`, speciesId, speciesName: name, familyId: speciesId }],
    }
    expect(validateEncounterCatalog(invalid, lookup).ok).toBe(false)
    const result = pickEncounter(invalid, 'pradera.abierta', { ...ticket, entryRoll: 0.999 })
    expect(result.ok && result.entry.speciesId === speciesId).toBe(false)
  })

  it('F4 rejects a partial or falsified event list', () => {
    for (const ids of [[], [150], [16]]) {
      const invalid = { ...catalog, categories: catalog.categories.map(c => c.category === 'legendary' ? { ...c, speciesIds: ids } : c) }
      expect(validateEncounterCatalog(invalid, lookup).ok).toBe(false)
    }
  })
})
