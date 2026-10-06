// Mechanical snapshot of explicit PokéAPI flags, scoped to the unchanged battle catalog.
// PokéAPI is a community dataset, not The Pokémon Company's official service.
// Source commit/hash, 493-species coverage and exact generation are checked offline.
import snapshot from './eventClassification.generated.json'

export type EventOnlyCategory = 'legendary' | 'mythical'
type Row = readonly [number, string, number, number]
const rows = snapshot.species as unknown as readonly Row[]
const byId = new Map(rows.map(row => [row[0], row]))
export const EVENT_CLASSIFICATION_SOURCE = `${snapshot.source.url} (sha256 ${snapshot.source.sha256})`
export const EVENT_SPECIES_IDS: Readonly<Record<EventOnlyCategory, readonly number[]>> = {
  legendary: rows.filter(row => row[2] === 1).map(row => row[0]),
  mythical: rows.filter(row => row[3] === 1).map(row => row[0]),
}

/** undefined means not covered by the source; never interpret that as ordinary. */
export function eventCategoryOf(speciesId: number): EventOnlyCategory | null | undefined {
  const row = byId.get(speciesId)
  if (!row) return undefined
  return row[2] === 1 ? 'legendary' : row[3] === 1 ? 'mythical' : null
}
