// The legacy migration contract (R32.2.1).
//
// Production never stored a nature, IVs, EVs, a gender, an ability or a form.
// Those attributes cannot be recovered, so a migration has to *decide* them —
// and the approved way to decide them (M-1) is a **deterministic hash
// backfill**:
//
//   - deterministic — the same legacy row always produces the same Pokémon;
//   - reproducible  — client, server and a script all compute the same thing;
//   - versioned     — `(salt, version)` is recorded inside the record;
//   - not rerollable — nothing here reads a clock, a counter or a random source,
//                      so a player cannot ask for a second roll.
//
// What this file does **not** do: it does not write, does not read Supabase and
// does not migrate anybody. It turns one legacy row into a draft, in memory, so
// the decision can be reviewed before it is ever applied.
//
// The rules it implements, all approved:
//   IVs      derived per stat, 0…31 — never a flat neutral value.
//   EVs      zero on all six: the old game never recorded EV training.
//   Nature   one of the 25, derived.
//   Ability  derived among the form's **normal** abilities; never hidden.
//   Shiny    only when unambiguous evidence is handed in; never inferred.
//   Moves    preserved when they resolve against R32.1; never replaced silently.

import type { PokemonCatalogView } from './catalogView'
import { HEALTHY } from './condition'
import { levelForExperience } from './experience'
import type {
  Acquisition, Gender, MoveSlot, PokemonInstanceDraft, SpeciesId,
} from './instance'
import { INSTANCE_SCHEMA_VERSION } from './instance'
import { projectLegacyPokemon } from './legacy'
import type { LegacyGap, LegacyMoveProblem, LegacySlotRow, LegacyXpRow } from './legacy'
import { MAX_IV, ZERO_STATS } from './stats'
import type { StatValues } from './stats'

/**
 * The run of the backfill. Bump it only to deliberately produce **different**
 * Pokémon from the same rows: every attribute below changes when it changes.
 */
export const LEGACY_MIGRATION_VERSION = 1

/**
 * The public label mixed into every hash. Not a secret — the backfill is meant
 * to be reproducible by anyone holding the same rows.
 */
export const LEGACY_MIGRATION_SALT = 'pokeswap-legacy-backfill'

export interface MigrationRuleset {
  readonly version: number
  readonly salt: string
}

export const DEFAULT_MIGRATION: MigrationRuleset = {
  version: LEGACY_MIGRATION_VERSION,
  salt: LEGACY_MIGRATION_SALT,
}

// ── The hash ────────────────────────────────────────────────────────────────

/**
 * FNV-1a, 32 bits.
 *
 * FNV-1a over the bytes, then Murmur3's finalizer to avalanche the result.
 *
 * Chosen because it is tiny, has no dependencies and is trivially portable to
 * SQL or to another language the day the backfill runs server-side. It is not
 * cryptographic and does not need to be: nothing here is a secret, and the
 * worst an attacker can do with it is predict a Pokémon they already own.
 */
export function hash32(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return mix32(hash)
}

/**
 * Murmur3's finalizer.
 *
 * FNV-1a alone is not enough here: the strings it hashes differ in one or two
 * characters near their end (`slot:25` vs `slot:26`), and its low bits barely
 * move between them — taking `% 32` off that gives visibly repeated IV spreads
 * across consecutive species. This mixes every bit into every other before
 * anything takes a remainder.
 */
export function mix32(value: number): number {
  let hash = value >>> 0
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x85ebca6b) >>> 0
  hash ^= hash >>> 13
  hash = Math.imul(hash, 0xc2b2ae35) >>> 0
  hash ^= hash >>> 16
  return hash >>> 0
}

/**
 * What identifies a legacy Pokémon — and **nothing about who owns it**.
 *
 * The key is the primary key of its `slots` row, `slots.pokemon_id`. Evidence
 * that it is immutable, from the migrations and the edge function in this repo:
 *
 *   - `slots` holds exactly one row per species: every write is an upsert
 *     `ON CONFLICT (pokemon_id)` (`20260907_003_buy_market_listing.sql`,
 *     `supabase/functions/pokeswap-swap/index.ts`), so `pokemon_id` is its
 *     primary key.
 *   - A change of owner is an `UPDATE` of `owner_id` on that same row. Releasing
 *     a Pokémon sets `owner_id = null`; it never deletes the row. No code path
 *     in the repo deletes from `slots`.
 *   - Therefore the row — the legacy Pokémon's identity — outlives every swap,
 *     every market sale and every release.
 *
 * What is deliberately **not** in the key: `user_id` / `owner_id` (ownership
 * changes), xp, level, moves, aura, energy and every timestamp. A Pokémon that
 * changes hands the day before the migration runs must come out of it as the
 * same Pokémon, so ownership cannot touch the RNG. It is preserved as metadata
 * of the migrated instance instead.
 */
export interface LegacyPokemonIdentityKey {
  /** `slots.pokemon_id` — the slot's primary key, stable for the life of the game. */
  readonly slotPokemonId: SpeciesId
}

/** The identity of the Pokémon a `pokemon_xp` row is about: its slot, not its trainer. */
export const legacyIdentityOf = (row: { readonly pokemon_id: number }): LegacyPokemonIdentityKey =>
  ({ slotPokemonId: row.pokemon_id })

/**
 * The hash of one **field** of one Pokémon.
 *
 * Every attribute gets its own independent hash rather than consecutive draws
 * from one stream, so adding an attribute later cannot shift the ones already
 * assigned. That is what makes this contract extensible without re-rolling
 * anybody's Pokémon.
 */
export const migrationHash = (
  rules: MigrationRuleset,
  key: LegacyPokemonIdentityKey,
  field: string,
): number => hash32(`${rules.salt}|v${rules.version}|slot:${key.slotPokemonId}|${field}`)

// ── The derivations ─────────────────────────────────────────────────────────

/** Six IVs, each derived on its own, spread over the full 0…31 range. */
export function migrationIvs(rules: MigrationRuleset, key: LegacyPokemonIdentityKey): StatValues {
  const of = (stat: string): number => migrationHash(rules, key, `iv:${stat}`) % (MAX_IV + 1)
  return { hp: of('hp'), atk: of('atk'), def: of('def'), spa: of('spa'), spd: of('spd'), spe: of('spe') }
}

/** One of the catalog's 25 natures. */
export function migrationNature(
  rules: MigrationRuleset,
  key: LegacyPokemonIdentityKey,
  natureIds: readonly number[],
): number {
  if (natureIds.length === 0) throw new LegacyMigrationError('the catalog has no natures')
  return natureIds[migrationHash(rules, key, 'nature') % natureIds.length]
}

/**
 * One of the form's **normal** abilities.
 *
 * The hidden ability is deliberately unreachable here: how a Pokémon gets one
 * is an open acquisition mechanic, and a migration must not hand out something
 * the game has not decided how to give.
 */
export function migrationAbility(
  rules: MigrationRuleset,
  key: LegacyPokemonIdentityKey,
  abilities: { slot1: number | null; slot2: number | null; hidden: number | null },
): number {
  const pool = [abilities.slot1, abilities.slot2].filter((id): id is number => id !== null)
  if (pool.length === 0) throw new LegacyMigrationError(`slot ${key.slotPokemonId} has no normal ability`)
  return pool[migrationHash(rules, key, 'ability') % pool.length]
}

/** Gender, following the species' own ratio; genderless species stay genderless. */
export function migrationGender(
  rules: MigrationRuleset,
  key: LegacyPokemonIdentityKey,
  genderRate: number,
): Gender {
  if (genderRate < 0) return 'genderless'
  if (genderRate === 0) return 'male'
  if (genderRate >= 8) return 'female'
  return migrationHash(rules, key, 'gender') % 8 < genderRate ? 'female' : 'male'
}

export class LegacyMigrationError extends Error {}

// ── One row → one draft ─────────────────────────────────────────────────────

export interface MigrateLegacyOptions {
  readonly rules?: MigrationRuleset
  /** The slot being migrated: the identity, and the only source of ownership. */
  readonly slot?: LegacySlotRow | null
  /**
   * Shiny **only** when the caller has unambiguous persisted evidence for this
   * exact Pokémon. There is none in `pokemon_xp`: `swap_history.was_shiny`
   * describes a swap event, not a Pokémon, so by default this stays false and
   * the loss is documented rather than guessed at.
   */
  readonly shiny?: boolean
  /** ISO-8601 UTC stamp of the migration run. No clock is read here. */
  readonly at: string
  readonly catalogVersion: string
  /** Set by `migrateLegacySlot`; see the report's fields of the same names. */
  readonly ignoredHistoricalProgressions?: number
  readonly missingCurrentOwnerProgression?: boolean
}

export interface MigrationReport {
  readonly identity: LegacyPokemonIdentityKey
  readonly rules: MigrationRuleset
  /** Fields that came from the legacy row itself. */
  readonly preserved: readonly string[]
  /** Fields the hash decided, because production could not answer them. */
  readonly derived: readonly string[]
  /** What the legacy row could not answer at all, from `legacy.ts`. */
  readonly gaps: readonly LegacyGap[]
  /** Rows that do not line up with the catalog, verbatim from the projection. */
  readonly problems: readonly string[]
  /**
   * True when no legacy move resolved. The Pokémon would arrive unable to act,
   * so the migration **stops** at reporting it: the proposed repair (species +
   * form + level + ORAS learnset) is written down in the model doc and is not
   * implemented here.
   */
  readonly needsMoveBackfill: boolean
  /**
   * Legacy move slugs that did not become a move, each with its reason: a real
   * ruleset incompatibility, or a slug nobody can identify. A move written in
   * Spanish is **not** here — it is canonicalized and preserved.
   */
  readonly unresolvedMoves: readonly LegacyMoveProblem[]
  /**
   * The level the legacy row stored, when it disagrees with its own xp.
   *
   * The contract is settled: experience is the source of truth and the level is
   * derived from it, so the stored level never overwrites anything. It is
   * reported for the audit and nothing else.
   */
  readonly ignoredStoredLevel: number | null
  /**
   * `pokemon_xp` rows for this species that belong to somebody who no longer
   * owns the slot. They are **historical trainer progression**, not Pokémon:
   * they are counted here and produce nothing.
   */
  readonly ignoredHistoricalProgressions: number
  /**
   * The slot has an owner but that owner has no `pokemon_xp` row.
   *
   * Legacy already answers what that is worth — `useProgression` reads
   * `raw?.xp ?? 0` and `raw?.moves ?? null`, and `grant_pokemon_xp` starts a
   * row at xp 0 / level 1 — so the Pokémon is migrated at 0 xp with no move.
   * Flagged all the same, for the dry-run: a Pokémon with no move cannot act.
   */
  readonly missingCurrentOwnerProgression: boolean
}

export interface MigrationResult {
  /** Still a draft: assigning `instanceId` belongs to whoever persists it. */
  readonly draft: PokemonInstanceDraft
  readonly report: MigrationReport
}

/**
 * Turns one `pokemon_xp` row into the Pokémon it would become.
 *
 * Nothing is written, nothing is applied and no row is read from a database:
 * the caller hands in the row. Running it twice on the same row gives the same
 * Pokémon, byte for byte.
 */
export function migrateLegacyPokemon(
  row: LegacyXpRow,
  catalog: PokemonCatalogView,
  options: MigrateLegacyOptions,
): MigrationResult {
  const rules = options.rules ?? DEFAULT_MIGRATION
  // Identity, deliberately without the owner: see `LegacyPokemonIdentityKey`.
  const key = legacyIdentityOf(row)

  const projection = projectLegacyPokemon(row, catalog, { slot: options.slot })
  const species = catalog.speciesOf(row.pokemon_id)
  if (!species) throw new LegacyMigrationError(`species ${row.pokemon_id} is not in the Battle Catalog`)
  const form = catalog.defaultForm(row.pokemon_id)
  if (!form) throw new LegacyMigrationError(`species ${row.pokemon_id} has no default form`)

  const moves: readonly MoveSlot[] = projection.known.moves
  const acquisition: Acquisition = {
    source: 'legacy_migration',
    at: options.at,
    catalogVersion: options.catalogVersion,
    migration: { version: rules.version, salt: rules.salt },
  }

  // XP wins over the stored level, always: experience is the source of truth
  // and the level is derived from it (§ del doc). A row whose stored level
  // disagrees is migrated on its xp and the disagreement is reported.
  const experience = projection.known.experience
  const draft: PokemonInstanceDraft = {
    schemaVersion: INSTANCE_SCHEMA_VERSION,
    speciesId: species.id,
    // The default form: production never stored one, and the alternate forms of
    // Gen VI are all either battle-only or earned in ways the old game had not.
    formId: form.id,
    experience,
    natureId: migrationNature(rules, key, catalog.natureIds()),
    abilityId: migrationAbility(rules, key, form.abilities),
    ivs: migrationIvs(rules, key),
    // Approved: the old game never recorded EV training, so nobody starts with
    // an advantage they never earned.
    evs: ZERO_STATS,
    moves,
    // A migrated Pokémon arrives rested. Condition is wear, and the old game
    // had none to carry over.
    condition: HEALTHY,
    state: 'owned',
    ownership: projection.known.ownership,
    acquisition,
    shiny: options.shiny === true,
    gender: migrationGender(rules, key, species.genderRate),
    nickname: null,
  }

  const report: MigrationReport = {
    identity: key,
    rules,
    preserved: ['speciesId', 'experience', 'ownership', ...(moves.length > 0 ? ['moves'] : [])],
    derived: ['natureId', 'abilityId', 'ivs', 'gender'],
    gaps: projection.gaps,
    problems: projection.problems,
    needsMoveBackfill: moves.length === 0,
    unresolvedMoves: projection.unresolvedMoves,
    ignoredStoredLevel: projection.known.levelDisagrees ? row.level : null,
    ignoredHistoricalProgressions: options.ignoredHistoricalProgressions ?? 0,
    missingCurrentOwnerProgression: options.missingCurrentOwnerProgression === true,
  }

  // A sanity check on our own arithmetic: the level the draft derives from the
  // preserved experience must be the level the projection read.
  if (levelForExperience(draft.experience) !== projection.known.level) {
    throw new LegacyMigrationError('experience and level disagree after migration')
  }

  return { draft, report }
}

// ── The migration unit: one slot ────────────────────────────────────────────

/**
 * **One `slots` row is one legacy Pokémon.** Not one per `pokemon_xp` row.
 *
 * The legacy game never had two individuals of a species: `slots` holds exactly
 * one row per species and it is the Pokémon. `pokemon_xp` is *training*, keyed
 * by (user, species), and a row of a former owner is that player's history, not
 * another Pokémon.
 *
 * So the cardinality is **0 or 1 instance per slot**, whatever the number of
 * progression rows that mention the species.
 */
export interface LegacySlotMigrationInput {
  readonly slot: LegacySlotRow
  /**
   * Every `pokemon_xp` row for this species, from any user. The one belonging
   * to the slot's current owner is used; the rest are counted and ignored.
   */
  readonly progressions?: readonly LegacyXpRow[]
}

export type LegacySlotOutcome =
  | { readonly kind: 'migrated'; readonly draft: PokemonInstanceDraft; readonly report: MigrationReport }
  /**
   * No instance. `reason` is `unowned` when the slot has no current owner:
   * in the legacy game that species is not somebody's Pokémon but part of the
   * pool anybody can get (`wildPool.ts` treats a slot without `owner_id` as
   * available), so migrating it would hand out a Pokémon nobody had.
   */
  | { readonly kind: 'skipped'; readonly reason: 'unowned'; readonly identity: LegacyPokemonIdentityKey }

/**
 * Migrates one slot, in memory.
 *
 *   1. the slot is the identity (`slots.pokemon_id`);
 *   2. the species is that same id;
 *   3. the owner is `slots.owner_id` — the only source of truth for ownership;
 *   4. no owner, no instance;
 *   5. the progression is the current owner's `pokemon_xp` row, if any;
 *   6. that row's xp and moves are preserved, and nobody else's are.
 *
 * A slot listed on the market keeps its `owner_id` (publishing only sets
 * `is_locked`), so it migrates to its seller like any other.
 */
export function migrateLegacySlot(
  input: LegacySlotMigrationInput,
  catalog: PokemonCatalogView,
  options: MigrateLegacyOptions,
): LegacySlotOutcome {
  const { slot, progressions = [] } = input
  const identity = legacyIdentityOf(slot)
  const ownerId = slot.owner_id
  if (ownerId === null) return { kind: 'skipped', reason: 'unowned', identity }

  const forThisSpecies = progressions.filter(row => row.pokemon_id === slot.pokemon_id)
  const current = forThisSpecies.find(row => row.user_id === ownerId) ?? null
  const ignoredHistoricalProgressions = forThisSpecies.length - (current ? 1 : 0)

  // Legacy's own default for an owner who never trained this Pokémon: 0 xp
  // (level 1) and no moves. Taken from the code, not invented — but flagged,
  // because a Pokémon with no move cannot act.
  const row: LegacyXpRow = current ?? {
    user_id: ownerId,
    pokemon_id: slot.pokemon_id,
    xp: 0,
    level: 1,
    moves: null,
  }

  const { draft, report } = migrateLegacyPokemon(row, catalog, {
    ...options,
    slot,
    ignoredHistoricalProgressions,
    missingCurrentOwnerProgression: current === null,
  })
  return { kind: 'migrated', draft, report }
}
