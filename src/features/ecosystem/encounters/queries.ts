// Pure questions over an encounter catalog (ECO-1).
//
// Two levels, always in this order:
//   1. The zone's `rarityShares` (percent) chooses a tier.
//   2. Inside that tier, entry `weight`s split the tier's share.
// So P(entry) = share(tier) / 100 × weight / Σ weights of its tier's candidates.
//
// An EMPTY tier (share > 0 but no candidate after the policy and the caller's
// filter) keeps its probability: it is reported as `unassigned`, and a pick
// that lands in it returns `{ ok: false, reason: 'empty-tier' }`. Nothing is
// silently redistributed to the other tiers.
//
// A pick never trusts that the catalog was validated: shares that are not
// finite, negative or all zero, or a tier whose candidates do not all have a
// positive finite weight, answer `{ ok: false, reason: 'invalid-distribution' }`
// instead of drawing something anyway.
//
// No randomness lives here. A pick takes an explicit ticket of two numbers in
// [0, 1); whoever calls decides where they come from (a server CSPRNG, a
// seeded test generator). The same catalog and ticket always give the same answer.

import { ordinaryEncounterExclusion } from './policy'
import { ENCOUNTER_RARITIES, type EncounterCatalog, type EncounterEntry, type EncounterRarity, type EncounterZone } from './types'

export type EntryFilter = (entry: EncounterEntry) => boolean

export interface TierDistribution {
  readonly rarity: EncounterRarity
  /** share / 100 */
  readonly probability: number
  readonly entries: readonly { readonly entry: EncounterEntry; readonly probability: number }[]
}

export interface ZoneDistribution {
  readonly zoneId: string
  readonly tiers: readonly TierDistribution[]
  /** Tiers with probability > 0 and no candidate. */
  readonly emptyTiers: readonly EncounterRarity[]
  /** Total probability of the empty tiers: appearances that would yield no encounter. */
  readonly unassigned: number
}

export interface EncounterTicket {
  readonly tierRoll: number
  readonly entryRoll: number
}

export type PickResult =
  | { readonly ok: true; readonly entry: EncounterEntry; readonly rarity: EncounterRarity }
  | { readonly ok: false; readonly reason: 'empty-tier'; readonly rarity: EncounterRarity }
  | { readonly ok: false; readonly reason: 'unknown-zone' }
  | { readonly ok: false; readonly reason: 'invalid-distribution' }

export function zoneById(catalog: EncounterCatalog, zoneId: string): EncounterZone | null {
  return catalog.zones.find(zone => zone.id === zoneId) ?? null
}

export function entriesInZone(catalog: EncounterCatalog, zoneId: string): EncounterEntry[] {
  return catalog.entries.filter(entry => entry.zoneId === zoneId)
}

/** Every zone entry of a species. The same species in two zones is two entries. */
export function entriesForSpecies(catalog: EncounterCatalog, speciesId: number): EncounterEntry[] {
  return catalog.entries.filter(entry => entry.speciesId === speciesId)
}

export function entriesInFamily(catalog: EncounterCatalog, familyId: number): EncounterEntry[] {
  return catalog.entries.filter(entry => entry.familyId === familyId)
}

export function entriesOfRarity(catalog: EncounterCatalog, rarity: EncounterRarity, zoneId?: string): EncounterEntry[] {
  return catalog.entries.filter(entry => entry.rarity === rarity && (zoneId === undefined || entry.zoneId === zoneId))
}

/** Entries that may actually be drawn: in the zone, allowed by policy and by the caller's filter. */
function candidates(catalog: EncounterCatalog, zoneId: string, rarity: EncounterRarity, filter?: EntryFilter): EncounterEntry[] {
  return catalog.entries.filter(entry =>
    entry.zoneId === zoneId && entry.rarity === rarity
    && ordinaryEncounterExclusion(catalog, entry.speciesId) === null
    && (filter ? filter(entry) : true))
}

const tierProbability = (zone: EncounterZone, rarity: EncounterRarity): number => zone.rarityShares[rarity] / 100

export function zoneDistribution(catalog: EncounterCatalog, zoneId: string, filter?: EntryFilter): ZoneDistribution | null {
  const zone = zoneById(catalog, zoneId)
  if (!zone) return null
  const tiers: TierDistribution[] = []
  const emptyTiers: EncounterRarity[] = []
  let unassigned = 0
  for (const rarity of ENCOUNTER_RARITIES) {
    const probability = tierProbability(zone, rarity)
    const list = candidates(catalog, zoneId, rarity, filter)
    const total = list.reduce((sum, entry) => sum + entry.weight, 0)
    if (probability > 0 && list.length === 0) {
      emptyTiers.push(rarity)
      unassigned += probability
    }
    tiers.push({
      rarity,
      probability,
      entries: list.map(entry => ({ entry, probability: total > 0 ? probability * entry.weight / total : 0 })),
    })
  }
  return { zoneId, tiers, emptyTiers, unassigned }
}

const isWeight = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

function assertRoll(name: string, value: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError(`${name} must be a finite number in [0, 1), got ${String(value)}`)
  }
}

/** Walks cumulative weights; the last positive item absorbs floating-point remainder. */
function walk<T>(items: readonly T[], weightOf: (item: T) => number, roll: number, total: number): T {
  let acc = 0
  let last = items[0]
  for (const item of items) {
    const weight = weightOf(item)
    if (weight <= 0) continue
    last = item
    acc += weight / total
    if (roll < acc) return item
  }
  return last
}

export function pickEncounter(catalog: EncounterCatalog, zoneId: string, ticket: EncounterTicket, filter?: EntryFilter): PickResult {
  assertRoll('tierRoll', ticket.tierRoll)
  assertRoll('entryRoll', ticket.entryRoll)
  const zone = zoneById(catalog, zoneId)
  if (!zone) return { ok: false, reason: 'unknown-zone' }

  const shares = ENCOUNTER_RARITIES.map(r => zone.rarityShares[r])
  if (!shares.every(isWeight) || !(shares.reduce((sum, share) => sum + share, 0) > 0)) return { ok: false, reason: 'invalid-distribution' }
  const rarity = walk(ENCOUNTER_RARITIES, r => tierProbability(zone, r), ticket.tierRoll, 1)
  const list = candidates(catalog, zoneId, rarity, filter)
  if (list.length === 0) return { ok: false, reason: 'empty-tier', rarity }
  if (!list.every(entry => isWeight(entry.weight) && entry.weight > 0)) return { ok: false, reason: 'invalid-distribution' }
  const total = list.reduce((sum, entry) => sum + entry.weight, 0)
  return { ok: true, entry: walk(list, entry => entry.weight, ticket.entryRoll, total), rarity }
}

/** Builds a ticket from an injected source of numbers in [0, 1). Never Math.random by default. */
export function ticketFrom(next: () => number): EncounterTicket {
  return { tierRoll: next(), entryRoll: next() }
}
