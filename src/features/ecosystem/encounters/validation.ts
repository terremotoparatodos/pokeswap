// Validation of an encounter catalog (ECO-1).
//
// Returns every problem instead of stopping at the first, so a reviewer sees
// the whole picture. It needs one thing from the battle catalog — a species
// lookup — and nothing else: no files, no network, no session.

import { ordinaryEncounterExclusion } from './policy'
import {
  ENCOUNTER_RARITIES, SPECIES_CATEGORY_IDS,
  type EncounterCatalog, type EncounterEntry, type EncounterHabitat, type EncounterSpeciesLookup, type EncounterZone,
  type EncounterZoneKind,
} from './types'

export type EncounterIssueCode =
  | 'duplicate-zone' | 'unknown-zone-kind' | 'invalid-level-range' | 'invalid-max-stage'
  | 'unknown-rarity' | 'invalid-rarity-share' | 'shares-not-100' | 'empty-tier' | 'unreachable-entry'
  | 'duplicate-entry-id' | 'entry-id-format' | 'unknown-zone' | 'duplicate-species-in-zone'
  | 'unknown-species' | 'species-name-mismatch' | 'invalid-weight' | 'invalid-group' | 'unknown-habitat'
  | 'habitat-zone-mismatch' | 'unknown-family' | 'not-family-member' | 'stage-above-zone-max'
  | 'intermediate-below-rare' | 'unused-exception' | 'excluded-species'
  | 'duplicate-family' | 'family-id-not-first-member' | 'family-member-unknown-species' | 'family-member-name-mismatch'
  | 'family-member-repeated' | 'invalid-family-stages'
  | 'category-unknown-species' | 'category-duplicate-species' | 'unknown-category'

export interface EncounterIssue {
  readonly code: EncounterIssueCode
  readonly message: string
  readonly zoneId?: string
  readonly entryId?: string
}

export interface EncounterValidation {
  readonly ok: boolean
  readonly issues: readonly EncounterIssue[]
}

export const MAX_GROUP_SIZE = 6
const SHARE_TOTAL = 100
const SHARE_TOLERANCE = 1e-9

export const HABITAT_ZONE_KIND: Readonly<Record<EncounterHabitat, EncounterZoneKind>> = {
  'open-grass': 'surface', 'tall-grass': 'surface', 'grass-near-water': 'surface', undergrowth: 'surface',
  branches: 'surface', conifers: 'surface', foliage: 'surface', clearing: 'surface', 'damp-clearing': 'surface',
  'cave-ceiling': 'cave', 'cave-rocky-floor': 'cave', 'cave-nook': 'cave', 'cave-floor': 'cave',
  'cave-damp-corner': 'cave', 'cave-dry-floor': 'cave',
}

const isPositiveFinite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
const isNonNegativeFinite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value)

export function validateEncounterCatalog(catalog: EncounterCatalog, lookupSpecies: EncounterSpeciesLookup): EncounterValidation {
  const issues: EncounterIssue[] = []
  const add = (code: EncounterIssueCode, message: string, where: { zoneId?: string; entryId?: string } = {}) =>
    issues.push({ code, message, ...where })

  const zones = validateZones(catalog.zones, add)
  const families = validateFamilies(catalog, lookupSpecies, add)
  validateCategories(catalog, lookupSpecies, add)
  validateEntries(catalog, zones, families, lookupSpecies, add)

  return { ok: issues.length === 0, issues }
}

type Add = (code: EncounterIssueCode, message: string, where?: { zoneId?: string; entryId?: string }) => void
type FamilyIndex = Map<number, Map<number, number>> // familyId → speciesId → stage

function validateZones(zones: readonly EncounterZone[], add: Add): Map<string, EncounterZone> {
  const byId = new Map<string, EncounterZone>()
  for (const zone of zones) {
    const zoneId = zone.id
    if (byId.has(zoneId)) add('duplicate-zone', `zone ${zoneId} is defined twice`, { zoneId })
    byId.set(zoneId, zone)
    if (zone.kind !== 'surface' && zone.kind !== 'cave') add('unknown-zone-kind', `zone ${zoneId} has kind ${String(zone.kind)}`, { zoneId })
    const { min, max } = zone.levelRange
    if (!isInt(min) || !isInt(max) || min < 1 || max > 100 || min > max) add('invalid-level-range', `zone ${zoneId} levels ${min}–${max}`, { zoneId })
    if (zone.maxStage !== 1 && zone.maxStage !== 2 && zone.maxStage !== 3) add('invalid-max-stage', `zone ${zoneId} maxStage ${String(zone.maxStage)}`, { zoneId })

    let total = 0
    let sharesValid = true
    for (const key of Object.keys(zone.rarityShares)) {
      if (!(ENCOUNTER_RARITIES as readonly string[]).includes(key)) add('unknown-rarity', `zone ${zoneId} has a share for unknown rarity ${key}`, { zoneId })
    }
    for (const rarity of ENCOUNTER_RARITIES) {
      const share = zone.rarityShares[rarity]
      if (!isNonNegativeFinite(share)) {
        sharesValid = false
        add('invalid-rarity-share', `zone ${zoneId} share for ${rarity} is ${String(share)}`, { zoneId })
      } else total += share
    }
    if (sharesValid && Math.abs(total - SHARE_TOTAL) > SHARE_TOLERANCE) add('shares-not-100', `zone ${zoneId} shares sum to ${total}, not ${SHARE_TOTAL}`, { zoneId })
  }
  return byId
}

function validateFamilies(catalog: EncounterCatalog, lookup: EncounterSpeciesLookup, add: Add): FamilyIndex {
  const index: FamilyIndex = new Map()
  for (const family of catalog.families) {
    if (index.has(family.id)) add('duplicate-family', `family ${family.id} is defined twice`)
    const members = new Map<number, number>()
    index.set(family.id, members)
    if (family.members[0]?.speciesId !== family.id) add('family-id-not-first-member', `family ${family.id} does not start with species ${family.id}`)
    let previous = 0
    for (const member of family.members) {
      const species = lookup(member.speciesId)
      if (!species) add('family-member-unknown-species', `family ${family.id}: species ${member.speciesId} is not in the catalog`)
      else if (species.name !== member.speciesName) add('family-member-name-mismatch', `family ${family.id}: ${member.speciesId} is ${species.name}, not ${member.speciesName}`)
      if (members.has(member.speciesId)) add('family-member-repeated', `family ${family.id}: ${member.speciesId} listed twice`)
      members.set(member.speciesId, member.stage)
      // Stages start at 1 and never skip; branches repeat a stage.
      const stepOk = member.stage === previous || member.stage === previous + 1
      if (![1, 2, 3].includes(member.stage) || !stepOk || (previous === 0 && member.stage !== 1)) {
        add('invalid-family-stages', `family ${family.id}: stage ${member.stage} after ${previous}`)
      }
      previous = member.stage
    }
  }
  return index
}

function validateCategories(catalog: EncounterCatalog, lookup: EncounterSpeciesLookup, add: Add): void {
  const known = SPECIES_CATEGORY_IDS as readonly string[]
  for (const category of catalog.excludedCategories) {
    if (!known.includes(category)) add('unknown-category', `excludedCategories names unknown category ${String(category)}`)
  }
  for (const list of catalog.categories) {
    if (!known.includes(list.category)) add('unknown-category', `category list ${String(list.category)} is not a known category`)
    const seen = new Set<number>()
    for (const id of list.speciesIds) {
      if (!lookup(id)) add('category-unknown-species', `category ${list.category}: species ${id} is not in the catalog`)
      if (seen.has(id)) add('category-duplicate-species', `category ${list.category}: species ${id} listed twice`)
      seen.add(id)
    }
  }
}

function validateEntries(
  catalog: EncounterCatalog, zones: Map<string, EncounterZone>, families: FamilyIndex,
  lookup: EncounterSpeciesLookup, add: Add,
): void {
  const ids = new Set<string>()
  const speciesByZone = new Map<string, Set<number>>()
  const tierEntries = new Map<string, number>() // `${zoneId}|${rarity}` → entries

  for (const entry of catalog.entries) {
    const where = { zoneId: entry.zoneId, entryId: entry.id }
    if (ids.has(entry.id)) add('duplicate-entry-id', `entry id ${entry.id} is used twice`, where)
    ids.add(entry.id)
    if (entry.id !== `${entry.zoneId}:${entry.speciesName}`) add('entry-id-format', `entry id ${entry.id} should be ${entry.zoneId}:${entry.speciesName}`, where)

    const zone = zones.get(entry.zoneId)
    if (!zone) add('unknown-zone', `entry ${entry.id} names unknown zone ${entry.zoneId}`, where)

    const inZone = speciesByZone.get(entry.zoneId) ?? new Set<number>()
    if (inZone.has(entry.speciesId)) add('duplicate-species-in-zone', `species ${entry.speciesId} appears twice in ${entry.zoneId}`, where)
    inZone.add(entry.speciesId)
    speciesByZone.set(entry.zoneId, inZone)

    const species = lookup(entry.speciesId)
    if (!species) add('unknown-species', `entry ${entry.id}: species ${entry.speciesId} is not in the catalog`, where)
    else if (species.name !== entry.speciesName) add('species-name-mismatch', `entry ${entry.id}: species ${entry.speciesId} is ${species.name}`, where)

    const excludedBy = ordinaryEncounterExclusion(catalog, entry.speciesId)
    if (excludedBy) add('excluded-species', `entry ${entry.id}: species ${entry.speciesId} is ${excludedBy}, excluded from this catalog`, where)

    const rarityKnown = (ENCOUNTER_RARITIES as readonly string[]).includes(entry.rarity)
    if (!rarityKnown) add('unknown-rarity', `entry ${entry.id} has rarity ${String(entry.rarity)}`, where)
    if (!isPositiveFinite(entry.weight)) add('invalid-weight', `entry ${entry.id} has weight ${String(entry.weight)}`, where)
    validateGroup(entry, add)

    const habitatKind = HABITAT_ZONE_KIND[entry.habitat as EncounterHabitat]
    if (!habitatKind) add('unknown-habitat', `entry ${entry.id} has habitat ${String(entry.habitat)}`, where)
    else if (zone && habitatKind !== zone.kind) add('habitat-zone-mismatch', `entry ${entry.id}: ${entry.habitat} is a ${habitatKind} habitat in a ${zone.kind} zone`, where)

    const stage = validateFamilyRef(entry, families, add)
    if (zone && stage !== null) validateStagePolicy(entry, zone, stage, add)

    if (zone && rarityKnown) {
      const key = `${entry.zoneId}|${entry.rarity}`
      tierEntries.set(key, (tierEntries.get(key) ?? 0) + 1)
      if (isNonNegativeFinite(zone.rarityShares[entry.rarity]) && zone.rarityShares[entry.rarity] === 0) {
        add('unreachable-entry', `entry ${entry.id} is ${entry.rarity}, a tier with 0 % in ${entry.zoneId}`, where)
      }
    }
  }

  for (const zone of zones.values()) {
    for (const rarity of ENCOUNTER_RARITIES) {
      const share = zone.rarityShares[rarity]
      if (isPositiveFinite(share) && !tierEntries.get(`${zone.id}|${rarity}`)) {
        add('empty-tier', `zone ${zone.id} gives ${share} % to ${rarity} but has no ${rarity} entry`, { zoneId: zone.id })
      }
    }
  }
}

function validateGroup(entry: EncounterEntry, add: Add): void {
  const { min, max } = entry.group
  if (!isInt(min) || !isInt(max) || min < 1 || max < min || max > MAX_GROUP_SIZE) {
    add('invalid-group', `entry ${entry.id} group ${String(min)}–${String(max)} (allowed 1–${MAX_GROUP_SIZE}, min ≤ max)`, { zoneId: entry.zoneId, entryId: entry.id })
  }
}

/** Returns the entry's stage in its family, or null when the reference is wrong. */
function validateFamilyRef(entry: EncounterEntry, families: FamilyIndex, add: Add): number | null {
  const where = { zoneId: entry.zoneId, entryId: entry.id }
  const members = families.get(entry.familyId)
  if (!members) {
    add('unknown-family', `entry ${entry.id} names unknown family ${entry.familyId}`, where)
    return null
  }
  const stage = members.get(entry.speciesId)
  if (stage === undefined) {
    add('not-family-member', `entry ${entry.id}: species ${entry.speciesId} is not in family ${entry.familyId}`, where)
    return null
  }
  return stage
}

function validateStagePolicy(entry: EncounterEntry, zone: EncounterZone, stage: number, add: Add): void {
  const where = { zoneId: entry.zoneId, entryId: entry.id }
  if (stage > zone.maxStage) add('stage-above-zone-max', `entry ${entry.id} is stage ${stage}; ${zone.id} allows up to ${zone.maxStage}`, where)
  // Intermediates and finals are rare or rarer, unless an authored exception says why not.
  const belowRare = entry.rarity === 'common' || entry.rarity === 'uncommon'
  const excused = entry.restrictions.exception?.rule === 'intermediate-below-rare'
  if (stage >= 2 && belowRare && !excused) add('intermediate-below-rare', `entry ${entry.id} is stage ${stage} but ${entry.rarity}`, where)
  if (excused && !(stage >= 2 && belowRare)) add('unused-exception', `entry ${entry.id} declares an exception it does not need`, where)
}
