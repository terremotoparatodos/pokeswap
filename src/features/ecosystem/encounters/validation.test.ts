// Negative controls: each guard of the validator catches the fault it exists
// for. Every case starts from the valid catalog and breaks ONE thing, so a
// passing test proves that guard alone fires.

import { describe, expect, it } from 'vitest'
import core from '../../battle/catalog/generated/core.json'
import { ECO_1_ENCOUNTER_CATALOG as valid } from './initialCatalog'
import { lookupFromSpeciesList } from './testing'
import type { EncounterCatalog, EncounterEntry, EncounterZone } from './types'
import { validateEncounterCatalog, type EncounterIssueCode } from './validation'

const lookup = lookupFromSpeciesList(core.species)

const withEntry = (index: number, patch: Partial<EncounterEntry> | Record<string, unknown>): EncounterCatalog => ({
  ...valid,
  entries: valid.entries.map((entry, i) => (i === index ? ({ ...entry, ...patch } as EncounterEntry) : entry)),
})
const withZone = (index: number, patch: Partial<EncounterZone> | Record<string, unknown>): EncounterCatalog => ({
  ...valid,
  zones: valid.zones.map((zone, i) => (i === index ? ({ ...zone, ...patch } as EncounterZone) : zone)),
})
const plus = (...entries: EncounterEntry[]): EncounterCatalog => ({ ...valid, entries: [...valid.entries, ...entries] })
const codes = (catalog: EncounterCatalog): EncounterIssueCode[] => validateEncounterCatalog(catalog, lookup).issues.map(issue => issue.code)

const PIDGEY = 0 // pradera.abierta:pidgey
const METAPOD = valid.entries.findIndex(entry => entry.id === 'pradera.bosque:metapod')
const PIDGEOTTO = valid.entries.findIndex(entry => entry.id === 'pradera.abierta:pidgeotto')

describe('the validator rejects', () => {
  it('a species that does not exist, or a slug that does not match it', () => {
    expect(codes(withEntry(PIDGEY, { speciesId: 9999 }))).toContain('unknown-species')
    expect(codes(withEntry(PIDGEY, { speciesName: 'pidgy', id: 'pradera.abierta:pidgy' }))).toContain('species-name-mismatch')
  })

  it('a duplicated entry id', () => {
    expect(codes(plus(valid.entries[PIDGEY]))).toContain('duplicate-entry-id')
  })

  it('the same species twice in one zone, but not across zones', () => {
    const second = { ...valid.entries[PIDGEY], id: 'pradera.abierta:pidgey-again' }
    expect(codes(plus(second))).toContain('duplicate-species-in-zone')
    expect(codes(valid)).not.toContain('duplicate-species-in-zone') // Pidgeotto and Pikachu live in two zones
  })

  it('an unknown zone, rarity, habitat or zone kind', () => {
    expect(codes(withEntry(PIDGEY, { zoneId: 'pradera.playa', id: 'pradera.playa:pidgey' }))).toContain('unknown-zone')
    expect(codes(withEntry(PIDGEY, { rarity: 'legendary' }))).toContain('unknown-rarity')
    expect(codes(withEntry(PIDGEY, { habitat: 'volcano' }))).toContain('unknown-habitat')
    expect(codes(withEntry(PIDGEY, { habitat: 'cave-ceiling' }))).toContain('habitat-zone-mismatch')
    expect(codes(withZone(0, { kind: 'sky' }))).toContain('unknown-zone-kind')
    expect(codes(withZone(0, { rarityShares: { ...valid.zones[0].rarityShares, mythic: 0 } }))).toContain('unknown-rarity')
  })

  it('negative, zero, infinite or non-numeric weights', () => {
    for (const weight of [-1, 0, Number.POSITIVE_INFINITY, Number.NaN, '28']) {
      expect(codes(withEntry(PIDGEY, { weight })), String(weight)).toContain('invalid-weight')
    }
  })

  it('tier shares that are invalid or do not sum to 100 (e.g. 99)', () => {
    expect(codes(withZone(0, { rarityShares: { common: 70, uncommon: 24, rare: 5.5, very_rare: -0.5 } }))).toContain('invalid-rarity-share')
    expect(codes(withZone(0, { rarityShares: { common: 70, uncommon: 24, rare: 5.5, very_rare: Number.NaN } }))).toContain('invalid-rarity-share')
    expect(codes(withZone(0, { rarityShares: { common: 69, uncommon: 24, rare: 5.5, very_rare: 0.5 } }))).toContain('shares-not-100')
  })

  it('a tier with share but no entry, and an entry in a 0 % tier', () => {
    const noVeryRare = { ...valid, entries: valid.entries.filter(entry => !(entry.zoneId === 'cueva-inicial' && entry.rarity === 'very_rare')) }
    expect(codes(noVeryRare)).toContain('empty-tier')
    const zeroRare = withZone(0, { rarityShares: { common: 70, uncommon: 24, rare: 0, very_rare: 6 } })
    expect(codes(zeroRare)).toContain('unreachable-entry')
  })

  it('incoherent group limits', () => {
    for (const group of [{ min: 0, max: 1 }, { min: 3, max: 2 }, { min: 1, max: 7 }, { min: 1.5, max: 2 }]) {
      expect(codes(withEntry(PIDGEY, { group })), JSON.stringify(group)).toContain('invalid-group')
    }
  })

  it('wrong family references', () => {
    expect(codes(withEntry(PIDGEY, { familyId: 9999 }))).toContain('unknown-family')
    expect(codes(withEntry(PIDGEY, { familyId: 19 }))).toContain('not-family-member')
    const badFamily = { ...valid, families: valid.families.map(f => (f.id === 16 ? { ...f, members: [f.members[0], { ...f.members[1], speciesName: 'pidgeot' }] } : f)) }
    expect(codes(badFamily)).toContain('family-member-name-mismatch')
    const skip = { ...valid, families: valid.families.map(f => (f.id === 19 ? { ...f, members: [f.members[0], { ...f.members[1], stage: 3 as const }] } : f)) }
    expect(codes(skip)).toContain('invalid-family-stages')
    const misnamed = { ...valid, families: valid.families.map(f => (f.id === 19 ? { ...f, id: 20 } : f)) }
    expect(codes(misnamed)).toContain('family-id-not-first-member')
  })

  it('species excluded from ordinary encounters (legendary, starter, baby…)', () => {
    const mewtwo = { ...valid.entries[PIDGEY], id: 'pradera.abierta:mewtwo', speciesId: 150, speciesName: 'mewtwo', familyId: 150 }
    const withMewtwoFamily = { ...plus(mewtwo), families: [...valid.families, { id: 150, members: [{ speciesId: 150, speciesName: 'mewtwo', stage: 1 as const }] }] }
    expect(validateEncounterCatalog(withMewtwoFamily, lookup).issues.filter(i => i.code === 'excluded-species').map(i => i.entryId)).toEqual(['pradera.abierta:mewtwo'])
    const pichu = { ...valid.entries[PIDGEY], id: 'pradera.abierta:pichu', speciesId: 172, speciesName: 'pichu', familyId: 172 }
    expect(codes(plus(pichu))).toContain('excluded-species')
  })

  it('a stage above the zone maximum, and an intermediate below rare without an exception', () => {
    const pidgeot = { ...valid.entries[PIDGEOTTO], id: 'pradera.abierta:pidgeot', speciesId: 18, speciesName: 'pidgeot', rarity: 'very_rare' as const }
    expect(codes(plus(pidgeot))).toContain('stage-above-zone-max')
    expect(codes(withEntry(PIDGEOTTO, { rarity: 'uncommon' }))).toContain('intermediate-below-rare')
    expect(codes(withEntry(METAPOD, { restrictions: {} }))).toContain('intermediate-below-rare')
  })

  it('an exception nobody needs', () => {
    expect(codes(withEntry(PIDGEY, { restrictions: valid.entries[METAPOD].restrictions }))).toContain('unused-exception')
  })

  it('invalid zone levels and category ids', () => {
    expect(codes(withZone(0, { levelRange: { min: 6, max: 5 } }))).toContain('invalid-level-range')
    const ghost = { ...valid, categories: [...valid.categories, { category: 'legendary' as const, speciesIds: [9999, 9999], source: 'test' }] }
    expect(codes(ghost)).toEqual(expect.arrayContaining(['category-unknown-species', 'category-duplicate-species']))
  })

  it('and reports every problem, not just the first', () => {
    const broken = withEntry(PIDGEY, { speciesId: 9999, weight: -1, group: { min: 2, max: 1 } })
    expect(codes(broken)).toEqual(expect.arrayContaining(['unknown-species', 'invalid-weight', 'invalid-group']))
  })
})
