// One Pokémon (R32.2).
//
// PokeSwap has two different things it calls a Pokémon, and until now they
// were the same thing:
//
//   - **Species and form** — shared, read-only, the same for everybody. That
//     lives in the Battle Catalog (R32.1) and is referenced, never copied.
//   - **Instance** — *this* Pokémon: its nature, its IVs, its moves, who owns
//     it and where it came from. That is this file.
//
// Everything a battle does to a Pokémon — current HP, PP spent, a burn, a stat
// stage, a Mega form — belongs to the runtime state (`runtime.ts`), not here.
// An instance is what survives when the battle ends.
//
// Plain data on purpose: JSON-safe, no classes, no hidden state, no `Date`
// objects, no functions. The same record travels from a server to a client and
// back without translation, which is what R32.4 will need.

import { HEALTHY, validateCondition } from './condition'
import type { PokemonConditionState } from './condition'
import { isWholeInRange, validateEvs, validateIvs } from './stats'
import type { StatValues } from './stats'

/**
 * Bumped when this record's shape changes in a way a reader must know about.
 *
 * 2 (R32.2.1) — the wear of a Pokémon moved into `condition`: `currentHp` and
 * the slots' `currentPP` became `condition.currentHp` and `condition.pp`, and
 * the major status joined them. A version 1 record read as a version 2 one
 * would lose its damage and its PP, so the reader refuses it instead.
 */
export const INSTANCE_SCHEMA_VERSION = 2

/** A species of the National Dex; the catalog's `species.id`. */
export type SpeciesId = number
/**
 * A form of that species; the catalog's `forms.id`. A species always has a
 * default form, and `charizard` and `charizard-mega-x` are two forms of the
 * same species — never two species.
 */
export type FormId = number

export type MoveId = number

/** Where a Pokémon came from. Extensible on purpose: new sources are new strings. */
export type AcquisitionSource =
  | 'starter'
  | 'adoption'
  | 'market'
  | 'trade'
  | 'swap'
  | 'dungeon_capture'
  | 'event'
  | 'legacy_migration'

export interface Acquisition {
  readonly source: AcquisitionSource
  /** ISO-8601 UTC. A string, so the record stays JSON-safe. */
  readonly at: string
  /** The catalog this Pokémon was rolled against, for traceability. */
  readonly catalogVersion: string
  /** Free-form pointer to the event that produced it: an expedition id, a listing id. */
  readonly ref?: string
  /**
   * Present only on `legacy_migration`: which run of the backfill produced the
   * attributes production never stored. Two Pokémon built by different runs are
   * different Pokémon, and this is what says so (`migration.ts`).
   */
  readonly migration?: {
    readonly version: number
    /** The public salt label, not a secret: the backfill is meant to be reproducible. */
    readonly salt: string
  }
}

/**
 * One of the four move slots: **which** move, not how worn it is.
 *
 * `maxPP` is not stored: it is the catalog's PP for that move plus the PP Ups
 * applied to it. Storing it would let the two disagree the day a move's PP
 * changes. `ppUps` is stored from the start so adding PP Ups later is a
 * feature, not a migration.
 *
 * Spent PP is **not** here either: it is wear, so it lives in `condition.pp`
 * (R32.2.1). It does survive a battle — it is restored at a Pokémon Center or
 * by an Ether, never by the clock.
 */
export interface MoveSlot {
  readonly moveId: MoveId
  /** 0–3, each adding 20 % of the move's base PP. */
  readonly ppUps: number
}

export const MAX_MOVE_SLOTS = 4
export const MAX_PP_UPS = 3

/** Max PP of a slot: base PP plus 20 % of it per PP Up, floored, as in the games. */
export const maxPPOf = (basePP: number, ppUps: number): number =>
  basePP + Math.floor((basePP * Math.min(ppUps, MAX_PP_UPS)) / 5)

/**
 * Who owns this Pokémon, and since when.
 *
 * `ownerId` is an opaque string to this layer: the domain never imports auth,
 * a Supabase client or a session. Whoever persists the record decides that it
 * is a profile id.
 */
export interface Ownership {
  /** Null while the Pokémon exists but belongs to nobody yet (see `state`). */
  readonly ownerId: string | null
  /** The trainer it was caught by; it does not change when the Pokémon does. */
  readonly originalTrainerId: string | null
}

/**
 * Whether this Pokémon is really the player's yet.
 *
 * `owned` — settled, persisted, safe.
 * `expeditionPending` — captured inside a dungeon and **not** the player's
 *   yet (I-1). A successful retreat or an auto-extract turns it into `owned`;
 *   a wipe destroys it. It is a state of the instance and not a separate kind
 *   of record, so the transition is a field change and never a re-creation.
 */
export type InstanceState = 'owned' | 'expeditionPending'

export interface PokemonInstance {
  readonly schemaVersion: number
  readonly instanceId: string
  readonly speciesId: SpeciesId
  /** The form it *is*, permanently. A Mega is a runtime form, never this. */
  readonly formId: FormId
  /**
   * Total accumulated experience. **The one source of truth for level**: the
   * level is derived from it (`levelOf`), never stored beside it.
   */
  readonly experience: number
  readonly natureId: number
  readonly abilityId: number
  readonly ivs: StatValues
  readonly evs: StatValues
  readonly moves: readonly MoveSlot[]
  /**
   * Everything a fight wore down and left behind: HP, PP, major status. It is
   * part of the record because it survives the battle, and separate from the
   * rest of the record because it is the only part a battle may write.
   */
  readonly condition: PokemonConditionState
  readonly state: InstanceState
  readonly ownership: Ownership
  readonly acquisition: Acquisition
  /** Cosmetic and rare; PokeSwap records shininess on swaps today (see the migration note). */
  readonly shiny: boolean
  /** `male`, `female` or `genderless`, decided at creation from the species' ratio. */
  readonly gender: Gender
  /** Player-given name. Never rendered as markup. */
  readonly nickname: string | null
}

export type Gender = 'male' | 'female' | 'genderless'

/** An instance before an id has been assigned to it (see `factory.ts`). */
export type PokemonInstanceDraft = Omit<PokemonInstance, 'instanceId'>

// ── Validation ──────────────────────────────────────────────────────────────

/** What the catalog must answer for an instance to be checkable. */
export interface InstanceCatalogView {
  form(id: FormId): { speciesId: number; abilities: { slot1: number | null; slot2: number | null; hidden: number | null } } | null
  species(id: SpeciesId): { id: number } | null
  move(id: MoveId): { pp: number } | null
  nature(id: number): { id: number } | null
  ability(id: number): { id: number } | null
}

/**
 * Everything wrong with this instance, in plain sentences. An empty array
 * means it is sound.
 *
 * Deliberately a list and not a throw: a migration wants to know *everything*
 * that is wrong with a record, not the first thing.
 */
export function validateInstance(instance: PokemonInstance, catalog: InstanceCatalogView): string[] {
  const issues: string[] = [...validateIvs(instance.ivs), ...validateEvs(instance.evs)]

  if (instance.schemaVersion !== INSTANCE_SCHEMA_VERSION) {
    issues.push(`schema version ${instance.schemaVersion}, expected ${INSTANCE_SCHEMA_VERSION}`)
  }
  if (!instance.instanceId) issues.push('instanceId is empty')
  if (!Number.isInteger(instance.experience) || instance.experience < 0) {
    issues.push('experience must be a whole number of zero or more')
  }

  const form = catalog.form(instance.formId)
  if (!form) issues.push(`form ${instance.formId} is not in the catalog`)
  else if (form.speciesId !== instance.speciesId) {
    issues.push(`form ${instance.formId} belongs to species ${form.speciesId}, not ${instance.speciesId}`)
  }
  if (!catalog.species(instance.speciesId)) issues.push(`species ${instance.speciesId} is not in the catalog`)
  if (!catalog.nature(instance.natureId)) issues.push(`nature ${instance.natureId} is not in the catalog`)

  if (!catalog.ability(instance.abilityId)) issues.push(`ability ${instance.abilityId} is not in the catalog`)
  else if (form) {
    const allowed = [form.abilities.slot1, form.abilities.slot2, form.abilities.hidden].filter(id => id !== null)
    // A Pokémon can only have an ability its form can have. The exception is
    // historic hidden abilities: see the model doc before relaxing this.
    if (!allowed.includes(instance.abilityId)) {
      issues.push(`ability ${instance.abilityId} is not one this form can have`)
    }
  }

  if (instance.moves.length === 0) issues.push('a Pokémon needs at least one move')
  if (instance.moves.length > MAX_MOVE_SLOTS) issues.push(`more than ${MAX_MOVE_SLOTS} move slots`)
  const seen = new Set<MoveId>()
  for (const slot of instance.moves) {
    const move = catalog.move(slot.moveId)
    if (!move) { issues.push(`move ${slot.moveId} is not in the catalog`); continue }
    if (seen.has(slot.moveId)) issues.push(`move ${slot.moveId} is in two slots`)
    seen.add(slot.moveId)
    if (!isWholeInRange(slot.ppUps, 0, MAX_PP_UPS)) issues.push(`PP Ups of move ${slot.moveId} must be 0–${MAX_PP_UPS}`)
  }

  issues.push(...validateCondition(instance.condition, moveId => maxPPOfInstance(instance, moveId, catalog)))
  if (instance.state === 'expeditionPending' && instance.ownership.ownerId !== null) {
    issues.push('a pending capture cannot have an owner yet (I-1)')
  }
  if (instance.nickname !== null && instance.nickname.trim() === '') issues.push('nickname is empty')

  return issues
}

/**
 * The real PP ceiling of one of this Pokémon's moves: the catalog's base PP
 * plus its PP Ups. `null` when the Pokémon does not know that move at all,
 * which is how a stale `condition.pp` entry is caught.
 */
export function maxPPOfInstance(
  instance: PokemonInstance,
  moveId: MoveId,
  catalog: InstanceCatalogView,
): number | null {
  const slot = instance.moves.find(entry => entry.moveId === moveId)
  if (!slot) return null
  const move = catalog.move(moveId)
  return move ? maxPPOf(move.pp, slot.ppUps) : null
}

/** True when nothing is wrong with the record. */
export const isValidInstance = (instance: PokemonInstance, catalog: InstanceCatalogView): boolean =>
  validateInstance(instance, catalog).length === 0

// ── The two transitions of I-1 ──────────────────────────────────────────────

/**
 * A capture that survived the dungeon: it becomes the player's.
 *
 * This is the only way an instance stops being pending, and it is a pure
 * function: the server calls it when a retreat or an auto-extract succeeds.
 */
export function secureCapture(instance: PokemonInstance, ownerId: string, at: string): PokemonInstance {
  if (instance.state !== 'expeditionPending') return instance
  return {
    ...instance,
    state: 'owned',
    ownership: { ownerId, originalTrainerId: instance.ownership.originalTrainerId ?? ownerId },
    acquisition: { ...instance.acquisition, at },
  }
}

/**
 * A capture lost to a wipe. There is no "deleted" state: the record simply
 * never crosses into persistence, and this says so out loud for the caller
 * that has it in memory.
 */
export const isLostOnWipe = (instance: PokemonInstance): boolean => instance.state === 'expeditionPending'

// ── Condition, applied to one Pokémon ───────────────────────────────────────

/** The same Pokémon with different wear. The only way a battle writes a record. */
export const withCondition = (
  instance: PokemonInstance,
  condition: PokemonConditionState,
): PokemonInstance => ({ ...instance, condition })

/** A fresh Pokémon's wear: none. Exported so a factory and a test agree on it. */
export const healthyCondition = (): PokemonConditionState => HEALTHY
