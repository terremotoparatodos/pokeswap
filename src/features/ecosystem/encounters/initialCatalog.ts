// The ECO-1 starting configuration: Pradera (open + forest) and the first cave.
//
// Transcribed from docs/design/POKEMON_ECOSYSTEM_1_PROPOSAL.md §A.2 (branch
// design/pokemon-ecosystem-1 @ dd789eb). PROVISIONAL: these species, weights,
// groups and levels are a starting point for review, not approved balance.
// Do not add species here without a reviewed proposal.
//
// How the numbers read (see `queries.ts`):
//   1. `rarityShares` picks the tier: 70 % of appearances are common, etc.
//   2. `weight` splits that tier among its entries. Pidgey 28 and Rattata 28
//      and Bidoof 14 split the common 70 % as 28:28:14 — i.e. 28 %, 28 % and
//      14 % of all appearances. A weight is never "per species, per tier".
//
// Not connected to the world: no room, roster or component imports this yet.

import { ENCOUNTER_FAMILIES } from './families'
import { SPECIES_CATEGORIES } from './speciesCategories'
import type {
  EncounterCatalog, EncounterEntry, EncounterHabitat, EncounterRarity, EncounterRestrictions, EncounterZone,
  EncounterZoneId,
} from './types'

const STANDARD_SHARES = { common: 70, uncommon: 24, rare: 5.5, very_rare: 0.5 } as const

export const ENCOUNTER_ZONES: readonly EncounterZone[] = [
  { id: 'pradera.abierta', kind: 'surface', areaId: 'pradera', subzoneId: null, levelRange: { min: 2, max: 5 }, maxStage: 2, rarityShares: STANDARD_SHARES },
  { id: 'pradera.bosque', kind: 'surface', areaId: 'pradera', subzoneId: 'bosque', levelRange: { min: 3, max: 7 }, maxStage: 2, rarityShares: STANDARD_SHARES },
  { id: 'cueva-inicial', kind: 'cave', areaId: 'cueva-inicial', subzoneId: null, levelRange: { min: 5, max: 8 }, maxStage: 2, rarityShares: STANDARD_SHARES },
]

const entry = (
  zoneId: EncounterZoneId, speciesId: number, speciesName: string, familyId: number,
  rarity: EncounterRarity, weight: number, group: [number, number], habitat: EncounterHabitat,
  restrictions: EncounterRestrictions = {},
): EncounterEntry => ({
  id: `${zoneId}:${speciesName}`, zoneId, speciesId, speciesName, familyId, rarity, weight,
  group: { min: group[0], max: group[1] }, habitat, restrictions,
})

const COCOON: EncounterRestrictions = {
  exception: { rule: 'intermediate-below-rare', reason: 'cocoon: canonical forest encounter with very low power' },
}

export const ENCOUNTER_ENTRIES: readonly EncounterEntry[] = [
  // ── pradera.abierta ─────────────────────────────────────────────────────
  entry('pradera.abierta', 16, 'pidgey', 16, 'common', 28, [1, 3], 'open-grass'),
  entry('pradera.abierta', 19, 'rattata', 19, 'common', 28, [1, 2], 'open-grass'),
  entry('pradera.abierta', 399, 'bidoof', 399, 'common', 14, [1, 2], 'grass-near-water'),
  entry('pradera.abierta', 29, 'nidoran-f', 29, 'uncommon', 6, [1, 1], 'tall-grass'),
  entry('pradera.abierta', 32, 'nidoran-m', 32, 'uncommon', 6, [1, 1], 'tall-grass'),
  entry('pradera.abierta', 187, 'hoppip', 187, 'uncommon', 6, [1, 2], 'open-grass'),
  entry('pradera.abierta', 403, 'shinx', 403, 'uncommon', 6, [1, 1], 'open-grass'),
  entry('pradera.abierta', 17, 'pidgeotto', 16, 'rare', 2, [1, 1], 'open-grass'),
  entry('pradera.abierta', 20, 'raticate', 19, 'rare', 1.5, [1, 1], 'open-grass'),
  entry('pradera.abierta', 25, 'pikachu', 172, 'rare', 2, [1, 1], 'open-grass', { note: 'in demand: never common' }),
  entry('pradera.abierta', 30, 'nidorina', 29, 'very_rare', 0.25, [1, 1], 'tall-grass'),
  entry('pradera.abierta', 33, 'nidorino', 32, 'very_rare', 0.25, [1, 1], 'tall-grass'),

  // ── pradera.bosque ──────────────────────────────────────────────────────
  entry('pradera.bosque', 10, 'caterpie', 10, 'common', 26, [1, 3], 'undergrowth'),
  entry('pradera.bosque', 13, 'weedle', 13, 'common', 26, [1, 3], 'undergrowth'),
  entry('pradera.bosque', 43, 'oddish', 43, 'common', 18, [1, 2], 'damp-clearing'),
  entry('pradera.bosque', 11, 'metapod', 10, 'uncommon', 6, [1, 2], 'branches', COCOON),
  entry('pradera.bosque', 14, 'kakuna', 13, 'uncommon', 6, [1, 2], 'branches', COCOON),
  entry('pradera.bosque', 204, 'pineco', 204, 'uncommon', 6, [1, 1], 'conifers'),
  entry('pradera.bosque', 165, 'ledyba', 165, 'uncommon', 6, [1, 2], 'foliage'),
  entry('pradera.bosque', 44, 'gloom', 43, 'rare', 2, [1, 1], 'damp-clearing'),
  entry('pradera.bosque', 17, 'pidgeotto', 16, 'rare', 1.5, [1, 1], 'clearing'),
  entry('pradera.bosque', 166, 'ledian', 165, 'rare', 1, [1, 1], 'foliage'),
  entry('pradera.bosque', 25, 'pikachu', 172, 'rare', 1, [1, 1], 'clearing', { note: 'in demand: never common' }),
  entry('pradera.bosque', 205, 'forretress', 204, 'very_rare', 0.5, [1, 1], 'conifers', { note: 'only steel source of the initial tables' }),

  // ── cueva-inicial ───────────────────────────────────────────────────────
  entry('cueva-inicial', 41, 'zubat', 41, 'common', 30, [2, 3], 'cave-ceiling', { placement: ['away-from-arrival', 'away-from-exit'], note: 'colony' }),
  entry('cueva-inicial', 74, 'geodude', 74, 'common', 28, [1, 2], 'cave-rocky-floor'),
  entry('cueva-inicial', 293, 'whismur', 293, 'common', 12, [1, 1], 'cave-nook'),
  entry('cueva-inicial', 50, 'diglett', 50, 'uncommon', 9, [1, 1], 'cave-floor'),
  entry('cueva-inicial', 46, 'paras', 46, 'uncommon', 8, [1, 1], 'cave-damp-corner'),
  entry('cueva-inicial', 27, 'sandshrew', 27, 'uncommon', 7, [1, 1], 'cave-dry-floor'),
  entry('cueva-inicial', 75, 'graveler', 74, 'rare', 2, [1, 1], 'cave-rocky-floor'),
  entry('cueva-inicial', 42, 'golbat', 41, 'rare', 1.5, [1, 1], 'cave-ceiling', { sizeClass: 'L', placement: ['central-area-only'] }),
  entry('cueva-inicial', 185, 'sudowoodo', 438, 'rare', 1, [1, 1], 'cave-nook', { note: 'family without its baby (Bonsly)' }),
  entry('cueva-inicial', 294, 'loudred', 293, 'rare', 1, [1, 1], 'cave-nook'),
  entry('cueva-inicial', 206, 'dunsparce', 206, 'very_rare', 0.5, [1, 1], 'cave-nook', { sizeClass: 'L', placement: ['central-area-only'] }),
]

export const ECO_1_ENCOUNTER_CATALOG: EncounterCatalog = {
  version: 'eco-1/provisional/2026-10-05',
  status: 'provisional',
  zones: ENCOUNTER_ZONES,
  entries: ENCOUNTER_ENTRIES,
  families: ENCOUNTER_FAMILIES,
  categories: SPECIES_CATEGORIES,
}
