// The Battle Catalog, seen from the Pokémon model (R32.2).
//
// The model never imports the catalog's files: it asks questions through this
// narrow view. Two reasons, and both matter more than the indirection costs:
//
//   - A test builds a view over five species instead of loading 493.
//   - The day the catalog is regenerated with a different shape, one file
//     changes here and nothing else in the model does.
//
// Everything is synchronous. Loading the catalog is the caller's problem
// (`loadBattleCatalog()`), and by the time a Pokémon is being created the data
// is already in memory.

import type { BattleCatalogIndex, CatalogForm, CatalogLearnset, CatalogSpecies } from '../../battle/catalog'
import type { FormId, InstanceCatalogView, MoveId, SpeciesId } from './instance'
import { statsFromTuple } from './stats'
import type { NatureEffect, StatValues } from './stats'

/** What building and reading a Pokémon needs from the catalog. */
export interface PokemonCatalogView extends InstanceCatalogView {
  speciesOf(id: SpeciesId): CatalogSpecies | null
  formById(id: FormId): CatalogForm | null
  /** The form a Pokémon of this species gets when nothing says otherwise. */
  defaultForm(speciesId: SpeciesId): CatalogForm | null
  /** Every form of a species, including the Megas a battle may turn it into. */
  formsOf(speciesId: SpeciesId): readonly CatalogForm[]
  baseStats(formId: FormId): StatValues | null
  /** Every nature id, in catalog order — the roll picks from this list. */
  natureIds(): readonly number[]
  natureEffect(id: number): NatureEffect | null
  /** Base PP of a move, before PP Ups. */
  movePP(id: MoveId): number | null
  /** A move by its catalog slug, e.g. `thunder-wave`; the legacy adapter needs it. */
  moveNamed(name: string): { id: number } | null
  /** The ORAS learnset of a form, when learnsets were loaded; null otherwise. */
  learnset(formId: FormId): CatalogLearnset | null
}

/**
 * The view over a real catalog index.
 *
 * `learnsets` is optional because the catalog loads them apart: a caller that
 * only reads or validates Pokémon never pays for that table, and one that
 * creates them passes it in.
 */
export function createPokemonCatalogView(
  index: BattleCatalogIndex,
  learnsets?: ReadonlyMap<number, CatalogLearnset> | null,
): PokemonCatalogView {
  const natureIds = index.catalog.natures.map(nature => nature.id)
  return {
    species: id => index.species(id),
    speciesOf: id => index.species(id),
    form: id => index.form(id),
    formById: id => index.form(id),
    defaultForm: speciesId => index.formOf(speciesId),
    formsOf: speciesId => index.formsOf(speciesId),
    baseStats: formId => {
      const form = index.form(formId)
      return form ? statsFromTuple(form.baseStats) : null
    },
    move: id => index.move(id),
    movePP: id => index.move(id)?.pp ?? null,
    moveNamed: name => index.moveNamed(name),
    nature: id => index.nature(id),
    natureIds: () => natureIds,
    natureEffect: id => {
      const nature = index.nature(id)
      return nature ? { increased: nature.increased, decreased: nature.decreased } : null
    },
    ability: id => index.ability(id),
    learnset: formId => learnsets?.get(formId) ?? null,
  }
}
