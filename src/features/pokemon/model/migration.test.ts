// The legacy migration contract, against the real Battle Catalog.
//
// Nothing here writes anything: every test builds drafts in memory from rows it
// makes up, which is exactly what the migration is allowed to do today.

import { beforeAll, describe, expect, it } from 'vitest'

import { loadBattleCatalog } from '../../battle/catalog'
import { createPokemonCatalogView } from './catalogView'
import type { PokemonCatalogView } from './catalogView'
import { HEALTHY } from './condition'
import { experienceForLevel, levelForExperience } from './experience'
import { validateInstance } from './instance'
import { LEGACY_MOVE_TABLES, canonicalMoveId, readLegacyMoves } from './legacy'
import type { LegacyXpRow } from './legacy'
import {
  DEFAULT_MIGRATION, LEGACY_MIGRATION_SALT, LEGACY_MIGRATION_VERSION, LegacyMigrationError,
  hash32, legacyIdentityOf, mix32, migrateLegacyPokemon, migrationAbility, migrationGender, migrationIvs,
  migrationNature,
} from './migration'
import { MAX_EV_TOTAL, STAT_KEYS } from './stats'

const PIKACHU = 25
const BULBASAUR = 1
const MAGNEMITE = 81

let catalog: PokemonCatalogView
let options: { at: string; catalogVersion: string }

beforeAll(async () => {
  const index = await loadBattleCatalog()
  catalog = createPokemonCatalogView(index)
  options = { at: '2026-04-01T00:00:00.000Z', catalogVersion: index.catalogVersion }
})

const row = (over: Partial<LegacyXpRow> = {}): LegacyXpRow => ({
  user_id: 'trainer-a',
  pokemon_id: PIKACHU,
  xp: 8000,
  level: levelForExperience(8000),
  moves: { 1: 'thunder-shock', 2: 'quick-attack' },
  ...over,
})

const migrate = (r = row(), extra = {}): ReturnType<typeof migrateLegacyPokemon> =>
  migrateLegacyPokemon(r, catalog, { ...options, ...extra })

const identity = (speciesId: number): { slotPokemonId: number } => ({ slotPokemonId: speciesId })

describe('identity: the owner is not part of it', () => {
  it('gives the same Pokémon after a change of owner', () => {
    // The same slot, migrated before and after it changed hands.
    const before = migrate(row({ user_id: 'trainer-a' })).draft
    const after = migrate(row({ user_id: 'trainer-b' })).draft
    expect(after.ivs).toEqual(before.ivs)
    expect(after.natureId).toBe(before.natureId)
    expect(after.abilityId).toBe(before.abilityId)
    expect(after.gender).toBe(before.gender)
    expect(after.shiny).toBe(before.shiny)
    // Ownership is metadata of the migrated instance, and only that.
    expect(before.ownership.ownerId).toBe('trainer-a')
    expect(after.ownership.ownerId).toBe('trainer-b')
  })

  it('takes its key from the slot’s primary key and nothing else', () => {
    expect(legacyIdentityOf({ pokemon_id: PIKACHU })).toEqual({ slotPokemonId: PIKACHU })
    expect(Object.keys(legacyIdentityOf({ pokemon_id: PIKACHU }))).toEqual(['slotPokemonId'])
  })

  it('does not move when xp, level, moves or the run stamp change', () => {
    const base = migrate().draft
    const variants = [
      migrate(row({ xp: 100, level: 1 })).draft,
      migrate(row({ xp: 900000, level: 99 })).draft,
      migrate(row({ moves: null })).draft,
      migrate(row(), { at: '2031-12-31T23:59:59.000Z' }).draft,
    ]
    for (const variant of variants) {
      expect(variant.ivs).toEqual(base.ivs)
      expect(variant.natureId).toBe(base.natureId)
      expect(variant.abilityId).toBe(base.abilityId)
      expect(variant.gender).toBe(base.gender)
    }
  })

  it('derives different values for different legacy identities', () => {
    const pikachu = migrate(row({ pokemon_id: PIKACHU })).draft
    const bulbasaur = migrate(row({ pokemon_id: BULBASAUR })).draft
    expect(bulbasaur.ivs).not.toEqual(pikachu.ivs)
  })

  it('spreads those values across the dex instead of repeating one', () => {
    const natures = new Set<number>()
    const spreads = new Set<string>()
    for (let speciesId = 1; speciesId <= 120; speciesId++) {
      natures.add(migrationNature(DEFAULT_MIGRATION, identity(speciesId), catalog.natureIds()))
      spreads.add(JSON.stringify(migrationIvs(DEFAULT_MIGRATION, identity(speciesId))))
    }
    expect(natures.size).toBeGreaterThan(10)
    expect(spreads.size).toBe(120)
  })
})

describe('determinism', () => {
  it('gives the same legacy row the same Pokémon, every time', () => {
    expect(migrate().draft).toEqual(migrate().draft)
  })

  it('reads no clock and no random source', () => {
    const first = migrate(row(), { at: '2026-04-01T00:00:00.000Z' }).draft
    const later = migrate(row(), { at: '2030-01-01T00:00:00.000Z' }).draft
    expect({ ...first, acquisition: null }).toEqual({ ...later, acquisition: null })
  })
})

describe('version and salt', () => {
  it('records which run produced the attributes', () => {
    const { draft } = migrate()
    expect(draft.acquisition.source).toBe('legacy_migration')
    expect(draft.acquisition.migration).toEqual({
      version: LEGACY_MIGRATION_VERSION,
      salt: LEGACY_MIGRATION_SALT,
    })
  })

  it('changes the Pokémon in a controlled way when the version changes', () => {
    const v1 = migrate().draft
    const v2 = migrate(row(), { rules: { ...DEFAULT_MIGRATION, version: 2 } }).draft
    expect(v2.ivs).not.toEqual(v1.ivs)
    // Controlled: what the legacy row itself knew is untouched by the bump.
    expect(v2.speciesId).toBe(v1.speciesId)
    expect(v2.experience).toBe(v1.experience)
    expect(v2.ownership).toEqual(v1.ownership)
    expect(v2.moves).toEqual(v1.moves)
    expect(v2.evs).toEqual(v1.evs)
  })

  it('changes it the same way for a different salt', () => {
    const other = migrate(row(), { rules: { ...DEFAULT_MIGRATION, salt: 'other-salt' } }).draft
    expect(other.ivs).not.toEqual(migrate().draft.ivs)
  })

  it('keeps each attribute on its own hash, so a new one cannot shift the old ones', () => {
    const key = identity(PIKACHU)
    const before = migrationNature(DEFAULT_MIGRATION, key, catalog.natureIds())
    void migrationIvs(DEFAULT_MIGRATION, key)
    expect(migrationNature(DEFAULT_MIGRATION, key, catalog.natureIds())).toBe(before)
  })

  it('hashes deterministically and stays inside 32 bits', () => {
    expect(hash32('pokeswap')).toBe(hash32('pokeswap'))
    expect(hash32('pokeswap')).not.toBe(hash32('pokeswap '))
    expect(hash32('')).toBe(mix32(0x811c9dc5))
    for (const text of ['a', 'slot:25', 'ñ', '']) {
      const value = hash32(text)
      expect(Number.isInteger(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(0xffffffff)
    }
  })
})

describe('IVs', () => {
  it('derives one per stat, inside 0…31', () => {
    for (let speciesId = 1; speciesId <= 60; speciesId++) {
      const ivs = migrationIvs(DEFAULT_MIGRATION, identity(speciesId))
      for (const key of STAT_KEYS) {
        expect(Number.isInteger(ivs[key])).toBe(true)
        expect(ivs[key]).toBeGreaterThanOrEqual(0)
        expect(ivs[key]).toBeLessThanOrEqual(31)
      }
    }
  })

  it('is not a flat neutral spread', () => {
    const seen = new Set<number>()
    for (let speciesId = 1; speciesId <= 60; speciesId++) {
      const ivs = migrationIvs(DEFAULT_MIGRATION, identity(speciesId))
      for (const key of STAT_KEYS) seen.add(ivs[key])
    }
    expect(seen.size).toBeGreaterThan(20)
  })
})

describe('EVs', () => {
  it('starts every legacy Pokémon at zero on all six', () => {
    const { draft } = migrate()
    expect(draft.evs).toEqual({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 })
    expect(STAT_KEYS.reduce((sum, key) => sum + draft.evs[key], 0)).toBe(0)
    expect(MAX_EV_TOTAL).toBe(510)
  })
})

describe('nature and ability', () => {
  it('always picks a nature the catalog has', () => {
    const ids = catalog.natureIds()
    expect(ids).toHaveLength(25)
    for (let speciesId = 1; speciesId <= 60; speciesId++) {
      expect(ids).toContain(migrationNature(DEFAULT_MIGRATION, identity(speciesId), ids))
    }
  })

  it('only ever picks a normal ability, never the hidden one', () => {
    for (let speciesId = 1; speciesId <= 120; speciesId++) {
      const form = catalog.defaultForm(speciesId)
      if (!form || form.abilities.slot1 === null) continue
      const normal = [form.abilities.slot1, form.abilities.slot2].filter(id => id !== null)
      const id = migrationAbility(DEFAULT_MIGRATION, identity(speciesId), form.abilities)
      expect(normal).toContain(id)
      if (form.abilities.hidden !== null && !normal.includes(form.abilities.hidden)) {
        expect(id).not.toBe(form.abilities.hidden)
      }
    }
  })

  it('refuses a form with no normal ability rather than reaching for the hidden one', () => {
    expect(() => migrationAbility(
      DEFAULT_MIGRATION,
      identity(1),
      { slot1: null, slot2: null, hidden: 42 },
    )).toThrow(LegacyMigrationError)
  })
})

describe('gender and shiny', () => {
  it('follows the species ratio and keeps genderless species genderless', () => {
    expect(migrate(row({ pokemon_id: MAGNEMITE })).draft.gender).toBe('genderless')
    expect(['male', 'female']).toContain(migrate().draft.gender)
    expect(migrationGender(DEFAULT_MIGRATION, identity(1), 0)).toBe('male')
    expect(migrationGender(DEFAULT_MIGRATION, identity(1), 8)).toBe('female')
  })

  it('is never shiny unless the caller brings unambiguous evidence', () => {
    expect(migrate().draft.shiny).toBe(false)
    expect(migrate(row(), { shiny: true }).draft.shiny).toBe(true)
  })
})

describe('experience wins over the stored level', () => {
  it('migrates on xp and derives the level from it', () => {
    const xp = experienceForLevel(20) + 10
    const { draft, report } = migrate(row({ xp, level: 57 }))
    expect(draft.experience).toBe(xp)
    expect(levelForExperience(draft.experience)).toBe(20)
    expect(report.ignoredStoredLevel).toBe(57)
  })

  it('does not report a disagreement when there is none', () => {
    const xp = experienceForLevel(30)
    expect(migrate(row({ xp, level: 30 })).report.ignoredStoredLevel).toBeNull()
  })

  it('never lets the stored level change the experience', () => {
    const xp = experienceForLevel(12)
    for (const stored of [1, 12, 50, 100]) {
      expect(migrate(row({ xp, level: stored })).draft.experience).toBe(xp)
    }
  })
})

describe('moves: canonicalization is not backfill', () => {
  it('preserves a move written with its Spanish display name', () => {
    const vineWhip = catalog.moveNamed('vine-whip')!.id
    expect(canonicalMoveId('látigo-cepa', catalog)).toBe(vineWhip)
    const { draft, report } = migrate(row({ pokemon_id: BULBASAUR, moves: { 1: 'Látigo Cepa' } }))
    expect(draft.moves.map(slot => slot.moveId)).toEqual([vineWhip])
    expect(report.unresolvedMoves).toEqual([])
    expect(report.needsMoveBackfill).toBe(false)
  })

  it('preserves the historical rename vise-grip → vice-grip', () => {
    const viceGrip = catalog.moveNamed('vice-grip')!.id
    expect(canonicalMoveId('vise-grip', catalog)).toBe(viceGrip)
    expect(readLegacyMoves({ 1: 'vise-grip' }, catalog).moves.map(slot => slot.moveId)).toEqual([viceGrip])
  })

  it('leaves an exact identifier exactly as it is', () => {
    const thunderbolt = catalog.moveNamed('thunderbolt')!.id
    expect(canonicalMoveId('thunderbolt', catalog)).toBe(thunderbolt)
  })

  it('keeps a real post-Gen VI move as an explicit incompatibility', () => {
    expect(canonicalMoveId('body-press', catalog)).toBeNull()
    const { report } = migrate(row({ moves: { 1: 'body-press' } }))
    expect(report.unresolvedMoves).toEqual([{ slug: 'body-press', kind: 'incompatible', generation: 8 }])
    expect(report.needsMoveBackfill).toBe(true)
  })

  it('separates a slug nobody can identify from a real incompatibility', () => {
    const { report } = migrate(row({ moves: { 1: 'not-a-move-at-all' } }))
    expect(report.unresolvedMoves).toEqual([{ slug: 'not-a-move-at-all', kind: 'unknown' }])
  })

  it('never invents a replacement for what it could not read', () => {
    const { draft, report } = migrate(row({ moves: { 1: 'body-press', 2: 'nonsense' } }))
    expect(draft.moves).toEqual([])
    expect(report.needsMoveBackfill).toBe(true)
    expect(report.unresolvedMoves.map(problem => problem.kind)).toEqual(['incompatible', 'unknown'])
  })

  it('reads the canonicalization tables from the generated audit', () => {
    expect(LEGACY_MOVE_TABLES.legacyTag).toBe('v0-legacy-baseline')
    expect(LEGACY_MOVE_TABLES.canonicalCount).toBeGreaterThan(300)
    expect(LEGACY_MOVE_TABLES.incompatibleCount).toBeGreaterThan(0)
    expect(LEGACY_MOVE_TABLES.catalogVersion).toBe(options.catalogVersion)
  })
})

describe('what the legacy row itself knew', () => {
  it('preserves species, experience, owner and the moves that resolve', () => {
    const { draft, report } = migrate()
    expect(draft.speciesId).toBe(PIKACHU)
    expect(draft.experience).toBe(8000)
    expect(draft.ownership.ownerId).toBe('trainer-a')
    expect(draft.moves).toHaveLength(2)
    expect(report.preserved).toContain('moves')
    expect(report.derived).toEqual(['natureId', 'abilityId', 'ivs', 'gender'])
  })

  it('arrives rested: a migrated Pokémon has no wear to carry over', () => {
    expect(migrate().draft.condition).toEqual(HEALTHY)
  })

  it('produces a record the validator accepts', () => {
    const { draft } = migrate()
    expect(validateInstance({ ...draft, instanceId: 'inst-x' }, catalog)).toEqual([])
  })

  it('refuses a species the catalog does not have', () => {
    expect(() => migrate(row({ pokemon_id: 905 }))).toThrow(LegacyMigrationError)
  })

  it('stays JSON-safe', () => {
    const { draft } = migrate()
    expect(JSON.parse(JSON.stringify(draft))).toEqual(draft)
  })
})
