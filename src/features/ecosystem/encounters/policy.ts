// Who may appear as an ordinary encounter (ECO-1).
//
// Two layers, on purpose:
//   - EVENT_ONLY_CATEGORIES: a product rule for every ordinary table, now and
//     later. Owner decisions (2026-10-05): legendaries and mythicals are
//     events, never ordinary encounters.
//   - `catalog.excludedCategories`: the scope a given catalog chose. ECO-1
//     leaves out pseudo-legendaries, starters, fossils, the Eevee line and
//     babies for its starting zones only; a later catalog (or an egg pool,
//     which this module does not model) may decide otherwise.
//
// Ownership is deliberately absent: owning one Pidgey never stops another
// from appearing (owner decision 1). Nothing here reads who owns what.

import type { EncounterCatalog, SpeciesCategory } from './types'
import { eventCategoryOf } from './eventClassification'

export const EVENT_ONLY_CATEGORIES: readonly SpeciesCategory[] = ['legendary', 'mythical']

/** The category that keeps this species out of this catalog's encounters, or null if it may appear. */
export function ordinaryEncounterExclusion(catalog: EncounterCatalog, speciesId: number): SpeciesCategory | 'unclassified' | null {
  const event = eventCategoryOf(speciesId)
  if (event === undefined) return 'unclassified'
  if (event !== null) return event // independent of optional/malformed catalog lists
  for (const list of catalog.categories) {
    const excluded = EVENT_ONLY_CATEGORIES.includes(list.category) || catalog.excludedCategories.includes(list.category)
    if (excluded && list.speciesIds.includes(speciesId)) return list.category
  }
  return null
}
