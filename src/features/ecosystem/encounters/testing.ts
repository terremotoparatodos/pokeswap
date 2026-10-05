// Test helpers for the encounter catalog: a species lookup over the real
// battle catalog data, built from the JSON the tests already import.

import type { EncounterSpeciesLookup } from './types'

export function lookupFromSpeciesList(species: readonly { readonly id: number; readonly name: string }[]): EncounterSpeciesLookup {
  const byId = new Map(species.map(entry => [entry.id, entry]))
  return id => byId.get(id) ?? null
}
