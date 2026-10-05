// The ECO-1 starting configuration is valid against the real battle catalog
// and the real world ids, and says exactly what the proposal says.

import { describe, expect, it } from 'vitest'
import core from '../../battle/catalog/generated/core.json'
import { WORLD_AREAS } from '../../../../services/realtime/src/world/areas.js'
import { caveInterior } from '../../../../services/realtime/src/world/caveLayouts.js'
import { RESOURCE_ZONES } from '../../../../services/realtime/src/world/resourceZones.js'
import { ECO_1_ENCOUNTER_CATALOG as catalog } from './initialCatalog'
import { ordinaryEncounterExclusion } from './policy'
import { entriesForSpecies, entriesInZone, zoneDistribution } from './queries'
import { lookupFromSpeciesList } from './testing'
import { ENCOUNTER_RARITIES } from './types'
import { validateEncounterCatalog } from './validation'

const lookup = lookupFromSpeciesList(core.species)

// POKEMON_ECOSYSTEM_1_PROPOSAL.md §A.2, as flat percentages of all appearances in the zone.
const PROPOSAL: Record<string, Record<string, number>> = {
  'pradera.abierta': { pidgey: 28, rattata: 28, bidoof: 14, 'nidoran-f': 6, 'nidoran-m': 6, hoppip: 6, shinx: 6, pidgeotto: 2, raticate: 1.5, pikachu: 2, nidorina: 0.25, nidorino: 0.25 },
  'pradera.bosque': { caterpie: 26, weedle: 26, oddish: 18, metapod: 6, kakuna: 6, pineco: 6, ledyba: 6, gloom: 2, pidgeotto: 1.5, ledian: 1, pikachu: 1, forretress: 0.5 },
  'cueva-inicial': { zubat: 30, geodude: 28, whismur: 12, diglett: 9, paras: 8, sandshrew: 7, graveler: 2, golbat: 1.5, sudowoodo: 1, loudred: 1, dunsparce: 0.5 },
}

describe('ECO-1 initial catalog', () => {
  it('validates with no issue against core.json', () => {
    const result = validateEncounterCatalog(catalog, lookup)
    expect(result.issues).toEqual([])
    expect(result.ok).toBe(true)
  })

  // The proposal's tables hold 12 + 12 + 11 = 35 entries; its summary (and the ECO-1 brief) said 31.
  // The tables are the source: this test pins them, so nothing is added or dropped silently.
  it('is provisional and holds exactly the proposal tables: 35 entries, no more', () => {
    expect(catalog.status).toBe('provisional')
    expect(catalog.entries).toHaveLength(35)
    for (const [zoneId, species] of Object.entries(PROPOSAL)) {
      expect(entriesInZone(catalog, zoneId).map(entry => entry.speciesName).sort()).toEqual(Object.keys(species).sort())
    }
  })

  it('counts 33 distinct species and 21 families (the proposal summary said 25 and 22)', () => {
    expect(new Set(catalog.entries.map(entry => entry.speciesId)).size).toBe(33)
    expect(new Set(catalog.entries.map(entry => entry.familyId)).size).toBe(21)
    expect(catalog.families).toHaveLength(21)
  })

  it('reproduces the proposal: tiers first, then weights inside the tier', () => {
    for (const [zoneId, species] of Object.entries(PROPOSAL)) {
      const distribution = zoneDistribution(catalog, zoneId)!
      expect(distribution.emptyTiers).toEqual([])
      expect(distribution.unassigned).toBe(0)
      expect(distribution.tiers.map(tier => [tier.rarity, tier.probability])).toEqual([['common', 0.7], ['uncommon', 0.24], ['rare', 0.055], ['very_rare', 0.005]])
      for (const tier of distribution.tiers) {
        for (const { entry, probability } of tier.entries) expect(probability).toBeCloseTo(species[entry.speciesName] / 100, 12)
      }
      const total = distribution.tiers.flatMap(tier => tier.entries).reduce((sum, item) => sum + item.probability, 0)
      expect(total).toBeCloseTo(1, 12)
    }
  })

  it('keeps one entry per zone for a species found in several zones', () => {
    expect(entriesForSpecies(catalog, 17).map(entry => [entry.zoneId, entry.rarity, entry.weight])).toEqual([
      ['pradera.abierta', 'rare', 2], ['pradera.bosque', 'rare', 1.5],
    ])
    expect(entriesForSpecies(catalog, 25).map(entry => entry.id)).toEqual(['pradera.abierta:pikachu', 'pradera.bosque:pikachu'])
  })

  it('has no species from an excluded category, and no third stage', () => {
    for (const entry of catalog.entries) expect(ordinaryEncounterExclusion(catalog, entry.speciesId), entry.id).toBeNull()
    const stage = new Map(catalog.families.flatMap(family => family.members.map(member => [member.speciesId, member.stage] as const)))
    for (const entry of catalog.entries) expect(stage.get(entry.speciesId), entry.id).toBeLessThanOrEqual(2)
  })

  it('names existing, stable world ids', () => {
    for (const zone of catalog.zones) {
      const known = zone.areaId in WORLD_AREAS || caveInterior(zone.areaId) !== null
      expect(known, zone.id).toBe(true)
      if (zone.kind === 'cave') expect(caveInterior(zone.areaId), zone.id).not.toBeNull()
      if (zone.subzoneId !== null) {
        expect(RESOURCE_ZONES.some(subzone => subzone.id === zone.subzoneId && subzone.areaId === zone.areaId), zone.id).toBe(true)
      }
    }
  })

  it('lists categories whose ids exist and match known anchors of the catalog', () => {
    const name = (id: number) => lookup(id)?.name
    const listed = (category: string) => catalog.categories.find(list => list.category === category)!.speciesIds
    expect(listed('legendary').map(name)).toEqual(expect.arrayContaining(['articuno', 'mewtwo', 'lugia', 'rayquaza', 'giratina']))
    expect(listed('mythical').map(name)).toEqual(expect.arrayContaining(['mew', 'celebi', 'jirachi', 'arceus']))
    expect(listed('baby').map(name)).toEqual(expect.arrayContaining(['pichu', 'bonsly']))
    for (const list of catalog.categories) expect(list.source.length, list.category).toBeGreaterThan(10)
  })

  it('lists every rarity in a fixed order', () => {
    expect(ENCOUNTER_RARITIES).toEqual(['common', 'uncommon', 'rare', 'very_rare'])
  })
})
