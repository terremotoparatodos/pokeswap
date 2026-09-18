// Reading the Battle Catalog (R32.1).
//
// The data is generated, large and read-only, so it is loaded on demand and
// indexed once. Nothing here decides anything about a battle: it answers what
// a species, a form, a move or an ability *is* under Generation VI.
//
// Loading strategy:
//   - `CATALOG_VERSION` is a plain string, imported statically. Client and
//     server can compare it before trusting each other, and it costs nothing.
//   - Everything else arrives through `loadBattleCatalog()`, a dynamic import,
//     so the catalog is its own chunk and never weighs on the first paint.
//   - Learnsets are the biggest table and the least used, so they load apart.

import { CATALOG_VERSION } from './generated/version'
import type {
  BattleCatalog, CatalogAbility, CatalogForm, CatalogLearnset, CatalogMove, CatalogNature,
  CatalogSpecies, TypeName,
} from './types'

export { CATALOG_VERSION }
export type * from './types'

export interface BattleCatalogIndex {
  readonly catalogVersion: string
  readonly catalog: BattleCatalog
  species(id: number): CatalogSpecies | null
  /** A form by its own id; `formOf(speciesId)` gives the default one. */
  form(id: number): CatalogForm | null
  formOf(speciesId: number): CatalogForm | null
  formsOf(speciesId: number): readonly CatalogForm[]
  move(id: number): CatalogMove | null
  moveNamed(name: string): CatalogMove | null
  ability(id: number): CatalogAbility | null
  nature(id: number): CatalogNature | null
  /** Damage multiplier of one attacking type against one defending type. */
  effectiveness(attacking: TypeName, defending: TypeName): number
  /** The product of the multipliers against a form's typing. */
  effectivenessAgainst(attacking: TypeName, defending: readonly TypeName[]): number
}

let pending: Promise<BattleCatalogIndex> | null = null

/** Loads and indexes the catalog once; later calls reuse the same promise. */
export function loadBattleCatalog(): Promise<BattleCatalogIndex> {
  return (pending ??= build())
}

async function build(): Promise<BattleCatalogIndex> {
  const [core, moves] = await Promise.all([
    import('./generated/core.json'),
    import('./generated/moves.json'),
  ])
  const coreData = (core.default ?? core) as unknown as Omit<BattleCatalog, 'moves'>
  const moveData = (moves.default ?? moves) as unknown as { catalogVersion: string; moves: CatalogMove[] }

  if (coreData.catalogVersion !== moveData.catalogVersion) {
    throw new Error('Battle catalog files come from different builds; re-run scripts/battle-catalog/build.mjs')
  }

  const catalog: BattleCatalog = { ...coreData, moves: moveData.moves }
  const speciesById = new Map(catalog.species.map(entry => [entry.id, entry]))
  const formById = new Map(catalog.forms.map(entry => [entry.id, entry]))
  const formsBySpecies = new Map<number, CatalogForm[]>()
  for (const form of catalog.forms) {
    const list = formsBySpecies.get(form.speciesId)
    if (list) list.push(form)
    else formsBySpecies.set(form.speciesId, [form])
  }
  const moveById = new Map(catalog.moves.map(entry => [entry.id, entry]))
  const moveByName = new Map(catalog.moves.map(entry => [entry.name, entry]))
  const abilityById = new Map(catalog.abilities.map(entry => [entry.id, entry]))
  const natureById = new Map(catalog.natures.map(entry => [entry.id, entry]))

  const effectiveness = (attacking: TypeName, defending: TypeName): number =>
    catalog.typeChart[attacking]?.[defending] ?? 1

  return {
    catalogVersion: catalog.catalogVersion,
    catalog,
    species: id => speciesById.get(id) ?? null,
    form: id => formById.get(id) ?? null,
    formOf: speciesId => (formsBySpecies.get(speciesId) ?? []).find(form => form.isDefault) ?? null,
    formsOf: speciesId => formsBySpecies.get(speciesId) ?? [],
    move: id => moveById.get(id) ?? null,
    moveNamed: name => moveByName.get(name) ?? null,
    ability: id => abilityById.get(id) ?? null,
    nature: id => natureById.get(id) ?? null,
    effectiveness,
    effectivenessAgainst: (attacking, defending) =>
      defending.reduce((total, type) => total * effectiveness(attacking, type), 1),
  }
}

let pendingLearnsets: Promise<ReadonlyMap<number, CatalogLearnset>> | null = null

/**
 * ORAS learnsets, by form id. Loaded apart from the rest: it is the largest
 * table and only whoever builds a Pokémon needs it.
 */
export function loadLearnsets(): Promise<ReadonlyMap<number, CatalogLearnset>> {
  return (pendingLearnsets ??= import('./generated/learnsets.json').then(module => {
    const data = (module.default ?? module) as unknown as {
      catalogVersion: string
      learnsets: Record<string, CatalogLearnset>
    }
    if (data.catalogVersion !== CATALOG_VERSION) {
      throw new Error('Learnsets come from a different catalog build; re-run scripts/battle-catalog/build.mjs')
    }
    return new Map(Object.entries(data.learnsets).map(([id, learnset]) => [Number(id), learnset]))
  }))
}

/** Test seam: forgets what was loaded so a suite can start from nothing. */
export function resetBattleCatalog(): void {
  pending = null
  pendingLearnsets = null
}
