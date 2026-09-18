// The Battle Catalog, seen from the rules (R32.3).
//
// The rules never import the generated files: they ask questions through this
// narrow, synchronous view. Same reason as the Pokémon model's own view — a
// test builds one over four species instead of loading 493, and the day the
// catalog changes shape one file moves.
//
// It is read-only by construction. Nothing here decides anything; it answers
// what a move, a form, a nature or a type *is*.

import type {
  BattleCatalogIndex, CatalogForm, CatalogMove, TypeName,
} from '../catalog'
import type { NatureEffect, StatValues } from '../../pokemon/model'
import { statsFromTuple } from '../../pokemon/model'

export interface BattleRulesCatalog {
  readonly catalogVersion: string
  move(id: number): CatalogMove | null
  moveNamed(name: string): CatalogMove | null
  form(id: number): CatalogForm | null
  baseStats(formId: number): StatValues | null
  typesOf(formId: number): readonly TypeName[] | null
  natureEffect(id: number): NatureEffect | null
  /** Catch rate of a species, 3…255. The capture contract reads it. */
  catchRate(speciesId: number): number | null
  /** Product of the multipliers of one attacking type against a typing. */
  effectiveness(attacking: TypeName, defending: readonly TypeName[]): number
  /** Every move of the ruleset, for a coverage report over the whole catalog. */
  allMoves(): readonly CatalogMove[]
}

export function createBattleRulesCatalog(index: BattleCatalogIndex): BattleRulesCatalog {
  return {
    catalogVersion: index.catalogVersion,
    move: id => index.move(id),
    moveNamed: name => index.moveNamed(name),
    form: id => index.form(id),
    baseStats: formId => {
      const form = index.form(formId)
      return form ? statsFromTuple(form.baseStats) : null
    },
    typesOf: formId => index.form(formId)?.types ?? null,
    natureEffect: id => {
      const nature = index.nature(id)
      return nature ? { increased: nature.increased, decreased: nature.decreased } : null
    },
    catchRate: speciesId => index.species(speciesId)?.catchRate ?? null,
    allMoves: () => index.catalog.moves,
    effectiveness: (attacking, defending) => index.effectivenessAgainst(attacking, defending),
  }
}
