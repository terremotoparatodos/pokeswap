// Creating a Pokémon (R32.2).
//
// Pure functions with an injected RNG. Nothing here calls `Math.random()`,
// reads a clock, generates an id or touches storage:
//
//   - `random` is a parameter, so the same seed builds the same Pokémon and a
//     test can assert on an exact individual (AGENTS.md §11: persistent
//     randomness is server-owned).
//   - The **draft** carries no `instanceId`. Assigning ids is a separate step
//     (`assignInstanceId`) because whoever persists the record decides what an
//     id is — a uuid here, a database default there.
//   - `at` is passed in through the acquisition, never read from a clock.
//
// Anything the caller wants to decide it passes explicitly; everything it
// leaves out is rolled. That is what makes one function serve a wild dungeon
// encounter, a starter, a gift and a test fixture.

import type { CatalogLearnset } from '../../battle/catalog'
import type { PokemonCatalogView } from './catalogView'
import { experienceForLevel } from './experience'
import { INSTANCE_SCHEMA_VERSION, MAX_MOVE_SLOTS, maxPPOf } from './instance'
import type {
  Acquisition, FormId, Gender, InstanceState, MoveSlot, PokemonInstance, PokemonInstanceDraft,
  SpeciesId,
} from './instance'
import { MAX_IV, ZERO_STATS, isValidLevel } from './stats'
import type { StatValues } from './stats'

/** Gen VI odds of a shiny without any charm: 1 in 4096. */
export const DEFAULT_SHINY_CHANCE = 1 / 4096

export interface CreateInstanceSpec {
  readonly speciesId: SpeciesId
  /** Defaults to the species' default form. A Mega is never created this way. */
  readonly formId?: FormId
  readonly level: number
  readonly acquisition: Acquisition
  /** `expeditionPending` for a dungeon capture that has not been extracted (I-1). */
  readonly state?: InstanceState
  readonly ownerId?: string | null
  readonly originalTrainerId?: string | null
  readonly nickname?: string | null
  // Everything below is rolled when it is not given.
  readonly natureId?: number
  readonly abilityId?: number
  readonly ivs?: StatValues
  readonly evs?: StatValues
  readonly gender?: Gender
  readonly shiny?: boolean
  readonly shinyChance?: number
  /** Move ids in slot order; otherwise the last four level-up moves are used. */
  readonly moveIds?: readonly number[]
  /** True to allow rolling the hidden ability; wild Pokémon do not (see the doc). */
  readonly allowHiddenAbility?: boolean
}

export class PokemonFactoryError extends Error {}

/**
 * A Pokémon, minus its id.
 *
 * The RNG is consumed in a fixed order — IVs (hp, atk, def, spa, spd, spe),
 * nature, ability, gender, shiny — and a value the caller pinned still spends
 * its roll. That is a deliberate contract: pinning the nature of a fixture
 * changes the nature and nothing else about the individual a seed produces.
 */
export function createPokemonInstanceDraft(
  spec: CreateInstanceSpec,
  catalog: PokemonCatalogView,
  random: () => number,
): PokemonInstanceDraft {
  if (!isValidLevel(spec.level)) throw new PokemonFactoryError(`level ${spec.level} is out of range`)

  const species = catalog.speciesOf(spec.speciesId)
  if (!species) throw new PokemonFactoryError(`species ${spec.speciesId} is not in the catalog`)

  const form = spec.formId === undefined ? catalog.defaultForm(spec.speciesId) : catalog.formById(spec.formId)
  if (!form) throw new PokemonFactoryError(`form ${String(spec.formId ?? 'default')} is not in the catalog`)
  if (form.speciesId !== spec.speciesId) {
    throw new PokemonFactoryError(`form ${form.id} does not belong to species ${spec.speciesId}`)
  }
  // A battle-only form (a Mega, a Primal) is something a Pokémon *becomes* in a
  // fight, so it is a runtime form and never what one permanently is.
  if (form.isBattleOnly || form.isMega) {
    throw new PokemonFactoryError(`form ${form.name} is battle-only; create the base form instead`)
  }

  // Every roll happens, in this order, **even when the caller pinned the value
  // it would have produced**. Skipping a roll would shift every later one, and
  // then pinning a nature would silently change the IVs a seed gives.
  const rolledIvs = rollIvs(random)
  const rolledNature = pickOne(catalog.natureIds(), random)
  const rolledAbility = rollAbility(form.abilities, random, spec.allowHiddenAbility === true)
  const rolledGender = rollGender(species.genderRate, random)
  const rolledShiny = random() < (spec.shinyChance ?? DEFAULT_SHINY_CHANCE)

  const ivs = spec.ivs ?? rolledIvs
  const natureId = spec.natureId ?? rolledNature
  const abilityId = spec.abilityId ?? rolledAbility
  const gender = spec.gender ?? rolledGender
  const shiny = spec.shiny ?? rolledShiny

  const moveIds = spec.moveIds ?? defaultMoveIds(catalog.learnset(form.id), spec.level)
  const moves: MoveSlot[] = moveIds.map(moveId => {
    const pp = catalog.movePP(moveId)
    if (pp === null) throw new PokemonFactoryError(`move ${moveId} is not in the catalog`)
    return { moveId, ppUps: 0, currentPP: maxPPOf(pp, 0) }
  })

  const state: InstanceState = spec.state ?? 'owned'
  // I-1: a capture inside a dungeon belongs to nobody until it is extracted, so
  // the factory refuses to stamp an owner on it rather than quietly producing a
  // record that `validateInstance` would reject.
  if (state === 'expeditionPending' && (spec.ownerId ?? null) !== null) {
    throw new PokemonFactoryError('a pending capture cannot have an owner yet (I-1)')
  }

  return {
    schemaVersion: INSTANCE_SCHEMA_VERSION,
    speciesId: species.id,
    formId: form.id,
    experience: experienceForLevel(spec.level),
    natureId,
    abilityId,
    ivs,
    evs: spec.evs ?? ZERO_STATS,
    moves,
    currentHp: null,
    state,
    ownership: {
      ownerId: spec.ownerId ?? null,
      originalTrainerId: spec.originalTrainerId ?? spec.ownerId ?? null,
    },
    acquisition: spec.acquisition,
    shiny,
    gender,
    nickname: spec.nickname ?? null,
  }
}

/** Gives a draft its identity. The id comes from the caller, never from here. */
export const assignInstanceId = (draft: PokemonInstanceDraft, instanceId: string): PokemonInstance =>
  ({ ...draft, instanceId })

/** The usual two steps at once, for callers that already have an id to give. */
export function createPokemonInstance(
  spec: CreateInstanceSpec,
  catalog: PokemonCatalogView,
  random: () => number,
  instanceId: string,
): PokemonInstance {
  return assignInstanceId(createPokemonInstanceDraft(spec, catalog, random), instanceId)
}

/** A dungeon capture: the same Pokémon, in the state I-1 says it starts in. */
export function createExpeditionCapture(
  spec: Omit<CreateInstanceSpec, 'state' | 'ownerId'>,
  catalog: PokemonCatalogView,
  random: () => number,
): PokemonInstanceDraft {
  return createPokemonInstanceDraft({ ...spec, state: 'expeditionPending', ownerId: null }, catalog, random)
}

// ── The rolls ───────────────────────────────────────────────────────────────

/** Six independent IVs in 0…31, in stat order. */
export function rollIvs(random: () => number): StatValues {
  const roll = (): number => Math.floor(random() * (MAX_IV + 1))
  return { hp: roll(), atk: roll(), def: roll(), spa: roll(), spd: roll(), spe: roll() }
}

function pickOne(values: readonly number[], random: () => number): number {
  if (values.length === 0) throw new PokemonFactoryError('nothing to pick from')
  return values[Math.floor(random() * values.length)]
}

/**
 * One of the form's regular abilities.
 *
 * The hidden ability is not rolled unless the caller asks: in the games it
 * needs a Hidden Grotto, a Friend Safari or a Dream World, and PokeSwap has not
 * decided which of those it has (see the model doc's open questions).
 */
export function rollAbility(
  abilities: { slot1: number | null; slot2: number | null; hidden: number | null },
  random: () => number,
  allowHidden = false,
): number {
  const pool = [abilities.slot1, abilities.slot2, ...(allowHidden ? [abilities.hidden] : [])]
    .filter((id): id is number => id !== null)
  if (pool.length === 0) {
    if (abilities.hidden !== null) return abilities.hidden
    throw new PokemonFactoryError('this form has no ability')
  }
  return pickOne(pool, random)
}

/** `genderRate` is the catalog's: -1 genderless, else eighths of female chance. */
export function rollGender(genderRate: number, random: () => number): Gender {
  if (genderRate < 0) return 'genderless'
  if (genderRate === 0) return 'male'
  if (genderRate >= 8) return 'female'
  return random() * 8 < genderRate ? 'female' : 'male'
}

/**
 * The four moves a Pokémon of this level knows: the last four it would have
 * learnt by levelling, exactly as a wild encounter works in the games.
 *
 * A form with no level-up entry at or below this level keeps its first one, so
 * a Pokémon is never created unable to act.
 */
export function defaultMoveIds(learnset: CatalogLearnset | null, level: number): readonly number[] {
  if (!learnset) return []
  const learnt: number[] = []
  for (const [moveId, at] of learnset.level) {
    if (at > level) continue
    const already = learnt.indexOf(moveId)
    if (already >= 0) learnt.splice(already, 1)
    learnt.push(moveId)
  }
  if (learnt.length === 0) {
    const first = learnset.level[0]
    return first ? [first[0]] : []
  }
  return learnt.slice(-MAX_MOVE_SLOTS)
}
