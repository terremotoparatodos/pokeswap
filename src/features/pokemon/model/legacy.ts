// What PokeSwap has today, seen as Pokémon (R32.2).
//
// The audit's finding, first, because everything here follows from it:
// **PokeSwap has no per-individual Pokémon.** It has
//
//   `slots`       one row per *species* (`pokemon_id`), with a single global
//                 owner, a price, an aura and an energy. Two players cannot own
//                 Pikachu; there is one Pikachu.
//   `pokemon_xp`  one row per (user, species): xp, a level recomputed from it
//                 by `grant_pokemon_xp`, and a `moves` JSON blob.
//   `swap_history.was_shiny`  the only place shininess is ever recorded, and it
//                 describes an event, not a Pokémon.
//
// So there is nothing to migrate in the usual sense: nature, IVs, EVs, gender,
// form and PP **do not exist** in production and cannot be recovered from it.
//
// This file therefore does one honest thing: it *projects* a legacy row into
// the part of a `PokemonInstance` that is genuinely known — species, level and
// experience, owner, and the moves that can be resolved — and reports
// everything that is missing instead of inventing it. Nothing here writes, and
// nothing here is wired to production: the backfill strategy is a proposal in
// `docs/wildlands/POKEMON_SPECIES_INSTANCE_MODEL.md` awaiting approval.

import type { PokemonCatalogView } from './catalogView'
import { levelForExperience } from './experience'
import type { MoveSlot, PokemonInstanceDraft, SpeciesId } from './instance'
import { INSTANCE_SCHEMA_VERSION } from './instance'
import { ZERO_STATS } from './stats'

/** The legacy rows this adapter reads, narrowed to what it actually needs. */
export interface LegacySlotRow {
  readonly pokemon_id: number
  readonly owner_id: string | null
  readonly first_owner_id?: string | null
  readonly owned_since?: string | null
}

export interface LegacyXpRow {
  readonly user_id: string
  readonly pokemon_id: number
  readonly xp: number
  readonly level: number
  readonly moves: Record<string, unknown> | null
}

/** A field the legacy data cannot answer, and how the projection filled it. */
export interface LegacyGap {
  readonly field: 'natureId' | 'abilityId' | 'ivs' | 'evs' | 'gender' | 'shiny' | 'moves' | 'formId'
  readonly reason: string
}

export interface LegacyProjection {
  /**
   * The instance as far as the data supports it, **minus** every field the
   * legacy rows cannot answer. It is deliberately not a `PokemonInstanceDraft`:
   * a partial record cannot be mistaken for a Pokémon that is ready to persist.
   */
  readonly known: LegacyKnown
  /** Everything a backfill would have to decide, in the words of the doc. */
  readonly gaps: readonly LegacyGap[]
  /** Rows that do not line up with the catalog at all. */
  readonly problems: readonly string[]
}

export type LegacyKnown = Pick<
  PokemonInstanceDraft,
  'schemaVersion' | 'speciesId' | 'experience' | 'ownership' | 'state' | 'nickname'
> & {
  /** Derived from `experience`, exposed because the legacy row also stores it. */
  readonly level: number
  /** Only the moves that resolve against the catalog by name or id. */
  readonly moves: readonly MoveSlot[]
  /** True when the row's stored level disagrees with its own xp. */
  readonly levelDisagrees: boolean
}

const ALWAYS_MISSING: readonly LegacyGap[] = [
  { field: 'natureId', reason: 'production has never stored a nature' },
  { field: 'abilityId', reason: 'production has never stored an ability' },
  { field: 'ivs', reason: 'production has never stored IVs' },
  { field: 'evs', reason: 'production has never stored EVs' },
  { field: 'gender', reason: 'production has never stored a gender' },
  { field: 'shiny', reason: 'shininess exists only on swap_history rows, per event' },
]

/**
 * Projects one `pokemon_xp` row (plus the species' slot, when it is at hand).
 *
 * It never guesses. Where the legacy data is silent the field is absent from
 * `known` and named in `gaps`, so a caller cannot accidentally persist a
 * Pokémon whose nature was made up by an adapter.
 */
export function projectLegacyPokemon(
  xp: LegacyXpRow,
  catalog: PokemonCatalogView,
  options: { readonly slot?: LegacySlotRow | null } = {},
): LegacyProjection {
  const problems: string[] = []
  const speciesId: SpeciesId = xp.pokemon_id
  const species = catalog.speciesOf(speciesId)
  if (!species) problems.push(`species ${speciesId} is not in the Battle Catalog`)

  const level = levelForExperience(xp.xp)
  const levelDisagrees = Number.isFinite(xp.level) && xp.level !== level
  if (levelDisagrees) problems.push(`stored level ${xp.level} but ${xp.xp} xp is level ${level}`)

  const { moves, unresolved } = readLegacyMoves(xp.moves, catalog)
  for (const name of unresolved) problems.push(`move ${name} does not resolve in the catalog`)

  const gaps: LegacyGap[] = [...ALWAYS_MISSING]
  const defaultForm = catalog.defaultForm(speciesId)
  if (!defaultForm) {
    gaps.push({ field: 'formId', reason: 'the species has no default form in the catalog' })
  }
  if (moves.length === 0) {
    gaps.push({ field: 'moves', reason: 'the row carries no move this catalog recognises' })
  }

  const ownerId = xp.user_id
  const known: LegacyKnown = {
    schemaVersion: INSTANCE_SCHEMA_VERSION,
    speciesId,
    experience: Math.max(0, Math.floor(xp.xp)),
    level,
    moves,
    // The legacy owner is the `pokemon_xp` row's user: the player who trained
    // it. `slots.owner_id` is who holds the *species* in the market, which is a
    // different thing and must not become the Pokémon's owner.
    ownership: {
      ownerId,
      originalTrainerId: options.slot?.first_owner_id ?? null,
    },
    state: 'owned',
    nickname: null,
    levelDisagrees,
  }
  return { known, gaps, problems }
}

/**
 * Reads the legacy `moves` blob.
 *
 * Its shape is not guaranteed — it has been written by more than one version of
 * the game — so this accepts the two forms seen in the data (a list, or an
 * object keyed by slot) and resolves each entry by catalog name or numeric id.
 * Anything else is reported rather than dropped silently.
 */
export function readLegacyMoves(
  blob: Record<string, unknown> | null,
  catalog: PokemonCatalogView,
): { moves: readonly MoveSlot[]; unresolved: readonly string[] } {
  if (!blob) return { moves: [], unresolved: [] }
  const raw: unknown[] = Array.isArray(blob) ? blob : Object.values(blob)
  const moves: MoveSlot[] = []
  const unresolved: string[] = []
  for (const entry of raw) {
    const id = resolveMoveId(entry, catalog)
    if (id === null) { unresolved.push(String(describe(entry))); continue }
    if (moves.some(slot => slot.moveId === id)) continue
    moves.push({ moveId: id, ppUps: 0 })
  }
  return { moves: moves.slice(0, 4), unresolved }
}

function resolveMoveId(entry: unknown, catalog: PokemonCatalogView): number | null {
  const value = typeof entry === 'object' && entry !== null
    ? ((entry as Record<string, unknown>).id ?? (entry as Record<string, unknown>).name)
    : entry
  if (typeof value === 'number' && catalog.move(value)) return value
  if (typeof value === 'string') {
    const slug = value.trim().toLowerCase().replace(/[\s_]+/g, '-')
    const move = catalog.moveNamed(slug)
    if (move) return move.id
    const numeric = Number(value)
    if (Number.isInteger(numeric) && catalog.move(numeric)) return numeric
  }
  return null
}

const describe = (entry: unknown): string =>
  typeof entry === 'object' && entry !== null ? JSON.stringify(entry) : String(entry)

/** The EVs a migrated Pokémon starts with under every proposal: none. */
export const MIGRATION_EVS = ZERO_STATS
