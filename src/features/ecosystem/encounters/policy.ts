// Who may appear as an ordinary encounter (ECO-1).
//
// Ordinary = any table without an event. Owner decision (2026-10-05):
// legendaries are for events only; the proposal also leaves out mythicals,
// pseudo-legendaries, starters, fossils, the Eevee line and babies.
//
// Ownership is deliberately absent: owning one Pidgey never stops another
// from appearing (owner decision 1). Nothing here reads who owns what.

import type { EncounterCatalog, SpeciesCategory } from './types'

export const ORDINARY_ENCOUNTER_EXCLUDED: readonly SpeciesCategory[] = [
  'legendary', 'mythical', 'pseudo_legendary', 'starter', 'fossil', 'eevee_line', 'baby',
]

/** The category that keeps this species out of ordinary encounters, or null if it may appear. */
export function ordinaryEncounterExclusion(catalog: EncounterCatalog, speciesId: number): SpeciesCategory | null {
  for (const list of catalog.categories) {
    if (ORDINARY_ENCOUNTER_EXCLUDED.includes(list.category) && list.speciesIds.includes(speciesId)) return list.category
  }
  return null
}
