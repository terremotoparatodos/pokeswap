// Shapes of the ordinary encounter catalog (ECO-1).
//
// Pure data types: no Vue, no Colyseus, no Supabase, no session, no I/O.
// The catalog says *what may appear where and how often*; it does not spawn,
// fight, capture, reward or own anything.
//
// Three different "rarities" exist in the design and only one lives here:
//   - EncounterRarity: how often an entry appears in ONE zone's table. The
//     same species can be `common` in one zone and `rare` in another.
//   - Species value (market, demand, power): not modelled here.
//   - Egg rarity (Común/Raro/Épico/"Legendario"): a future, separate system.
//     It is NOT derived from EncounterRarity.

/** Order matters: it is the order in which a ticket's tier roll is walked. */
export const ENCOUNTER_RARITIES = ['common', 'uncommon', 'rare', 'very_rare'] as const
export type EncounterRarity = (typeof ENCOUNTER_RARITIES)[number]

export type EncounterZoneId = 'pradera.abierta' | 'pradera.bosque' | 'cueva-inicial'
export type EncounterZoneKind = 'surface' | 'cave'

/** Micro-habitat inside a zone: where in the zone a nest of this entry belongs. */
export type EncounterHabitat =
  | 'open-grass' | 'tall-grass' | 'grass-near-water'
  | 'undergrowth' | 'branches' | 'conifers' | 'foliage' | 'clearing' | 'damp-clearing'
  | 'cave-ceiling' | 'cave-rocky-floor' | 'cave-nook' | 'cave-floor' | 'cave-damp-corner' | 'cave-dry-floor'

export type SizeClass = 'S' | 'M' | 'L' | 'XL'

/** Where a future nest of this entry may not, or must, be placed. Enforced by spawning, not here. */
export type EncounterPlacementRule = 'away-from-arrival' | 'away-from-exit' | 'central-area-only'

/** Structural rules an entry may be explicitly excused from, with a written reason. */
export type EncounterExceptionRule = 'intermediate-below-rare'

export interface EncounterRestrictions {
  readonly placement?: readonly EncounterPlacementRule[]
  readonly sizeClass?: SizeClass
  readonly exception?: { readonly rule: EncounterExceptionRule; readonly reason: string }
  readonly note?: string
}

/** How many individuals one appearance of this entry brings. Each will be its own encounter. */
export interface SpawnGroup {
  readonly min: number
  readonly max: number
}

export interface EncounterZone {
  readonly id: EncounterZoneId
  readonly kind: EncounterZoneKind
  /** Existing presence area id (`services/realtime/src/world/areas.js`, `caveLayouts.js`). */
  readonly areaId: string
  /** Existing resource subzone id (`resourceZones.js`), or null for "the area outside its subzones". */
  readonly subzoneId: string | null
  readonly levelRange: { readonly min: number; readonly max: number }
  /** Highest evolutionary stage any entry of this zone may have. */
  readonly maxStage: 1 | 2 | 3
  /**
   * Percent of appearances that go to each rarity tier. Must sum to 100.
   * Applied FIRST; an entry's `weight` only splits its tier's share.
   */
  readonly rarityShares: Readonly<Record<EncounterRarity, number>>
}

export interface EncounterEntry {
  /** Stable, unique across the catalog: `<zoneId>:<species slug>`. */
  readonly id: string
  readonly zoneId: EncounterZoneId
  readonly speciesId: number
  /** The battle catalog's canonical slug, repeated so a reviewer can read the table; validated. */
  readonly speciesName: string
  /** Evolutionary family (`EncounterFamily.id`). Never the spawn group. */
  readonly familyId: number
  readonly rarity: EncounterRarity
  /** Relative weight INSIDE its zone's rarity tier. Not a percentage of the zone. */
  readonly weight: number
  readonly group: SpawnGroup
  readonly habitat: EncounterHabitat
  readonly restrictions: EncounterRestrictions
}

export interface EncounterFamilyMember {
  readonly speciesId: number
  readonly speciesName: string
  /** 1 = first form (a baby counts as 1). Branches share a stage. */
  readonly stage: 1 | 2 | 3
  readonly baby?: true
}

/** An evolutionary line. `id` is the speciesId of its first form, baby included. */
export interface EncounterFamily {
  readonly id: number
  readonly members: readonly EncounterFamilyMember[]
}

export const SPECIES_CATEGORY_IDS = ['legendary', 'mythical', 'pseudo_legendary', 'starter', 'fossil', 'eevee_line', 'baby'] as const
export type SpeciesCategory = (typeof SPECIES_CATEGORY_IDS)[number]

export interface SpeciesCategoryList {
  readonly category: SpeciesCategory
  readonly speciesIds: readonly number[]
  /** Where the list comes from; the battle catalog has no such flags. */
  readonly source: string
}

export interface EncounterCatalog {
  readonly version: string
  /** Every number in ECO-1 is a reviewable starting configuration, not approved balance. */
  readonly status: 'provisional'
  readonly zones: readonly EncounterZone[]
  readonly entries: readonly EncounterEntry[]
  readonly families: readonly EncounterFamily[]
  readonly categories: readonly SpeciesCategoryList[]
  /**
   * Categories THIS catalog keeps out, on top of the event-only ones that no
   * ordinary table may hold (`policy.ts`). A scope decision, not a universal rule.
   */
  readonly excludedCategories: readonly SpeciesCategory[]
}

/** The only thing validation needs from the battle catalog. */
export type EncounterSpeciesLookup = (speciesId: number) => { readonly name: string } | null
