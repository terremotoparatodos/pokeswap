// What Skills knows about a species: its types and base stats. Nothing else
// in the catalog is solid enough to reason about work (there is no anatomy or
// evolution data), so the aptitude rules read only these.

import { SPECIES_FACTS_ROWS } from './speciesFacts.generated'

export type BaseStats = readonly [hp: number, attack: number, defense: number, specialAttack: number, specialDefense: number, speed: number]

export type SpeciesFactsRow = readonly [speciesId: number, name: string, types: readonly string[], baseStats: BaseStats]

export interface SpeciesFacts {
  readonly speciesId: number
  /** Canonical catalog name, e.g. `mr-mime`. */
  readonly name: string
  readonly types: readonly string[]
  readonly baseStats: BaseStats
}

const BY_ID: ReadonlyMap<number, SpeciesFacts> = new Map(
  SPECIES_FACTS_ROWS.map(([speciesId, name, types, baseStats]) => [speciesId, { speciesId, name, types, baseStats }]),
)

export const SPECIES_COUNT = BY_ID.size

export function speciesFacts(speciesId: number): SpeciesFacts | null {
  return BY_ID.get(speciesId) ?? null
}

export function allSpeciesFacts(): Iterable<SpeciesFacts> {
  return BY_ID.values()
}

/** `mr-mime` → `Mr Mime`. Display only; the product has no localized name table. */
export function speciesDisplayName(speciesId: number): string {
  const facts = speciesFacts(speciesId)
  if (!facts) return `#${speciesId}`
  return facts.name.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}
