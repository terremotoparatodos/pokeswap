// The legacy migration contract, against the real Battle Catalog.
//
// Nothing here writes anything: every test builds drafts in memory from rows it
// makes up, which is exactly what the migration is allowed to do today.

import { beforeAll, describe, expect, it } from 'vitest'

import { loadBattleCatalog } from '../../battle/catalog'
import { createPokemonCatalogView } from './catalogView'
import type { PokemonCatalogView } from './catalogView'
import { HEALTHY } from './condition'
import { levelForExperience } from './experience'
import { validateInstance } from './instance'
import type { LegacyXpRow } from './legacy'
import {
  DEFAULT_MIGRATION, LEGACY_MIGRATION_SALT, LEGACY_MIGRATION_VERSION, LegacyMigrationError,
  hash32, migrateLegacyPokemon, migrationAbility, migrationGender, migrationIvs, migrationNature,
} from './migration'
import { MAX_EV_TOTAL, STAT_KEYS } from './stats'

const PIKACHU = 25
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

describe('determinism', () => {
  it('gives the same legacy row the same Pokémon, every time', () => {
    expect(migrate().draft).toEqual(migrate().draft)
  })

  it('gives two different trainers different Pokémon from the same species', () => {
    const a = migrate(row({ user_id: 'trainer-a' })).draft
    const b = migrate(row({ user_id: 'trainer-b' })).draft
    expect(a).not.toEqual(b)
  })

  it('does not depend on the row’s xp, only on who owns what species', () => {
    const young = migrate(row({ xp: 100, level: levelForExperience(100) })).draft
    const old = migrate(row({ xp: 900000, level: levelForExperience(900000) })).draft
    expect(young.ivs).toEqual(old.ivs)
    expect(young.natureId).toBe(old.natureId)
    expect(young.abilityId).toBe(old.abilityId)
    expect(young.gender).toBe(old.gender)
  })

  it('reads no clock and no random source: the run stamp is the only input that moves', () => {
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
    // The hash of a field depends on the field's name; nothing is drawn from a
    // shared stream, so adding `iv:foo` tomorrow leaves `nature` where it is.
    const key = { userId: 'trainer-a', speciesId: PIKACHU }
    const before = migrationNature(DEFAULT_MIGRATION, key, catalog.natureIds())
    void migrationIvs(DEFAULT_MIGRATION, key)
    expect(migrationNature(DEFAULT_MIGRATION, key, catalog.natureIds())).toBe(before)
  })

  it('hashes deterministically and stays inside 32 bits', () => {
    expect(hash32('pokeswap')).toBe(hash32('pokeswap'))
    expect(hash32('pokeswap')).not.toBe(hash32('pokeswap '))
    expect(hash32('')).toBe(0x811c9dc5)
    for (const text of ['a', 'trainer-a|25', 'ñ', '']) {
      const value = hash32(text)
      expect(Number.isInteger(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(0xffffffff)
    }
  })
})

describe('IVs', () => {
  it('derives one per stat, inside 0…31', () => {
    for (const user of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const ivs = migrationIvs(DEFAULT_MIGRATION, { userId: user, speciesId: PIKACHU })
      for (const key of STAT_KEYS) {
        expect(Number.isInteger(ivs[key])).toBe(true)
        expect(ivs[key]).toBeGreaterThanOrEqual(0)
        expect(ivs[key]).toBeLessThanOrEqual(31)
      }
    }
  })

  it('is not a flat neutral spread: the six stats differ across a population', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 60; i++) {
      const ivs = migrationIvs(DEFAULT_MIGRATION, { userId: `user-${i}`, speciesId: PIKACHU })
      for (const key of STAT_KEYS) seen.add(ivs[key])
    }
    // A flat rule would put one value in this set; a real spread fills it.
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

describe('nature', () => {
  it('always picks one the catalog has', () => {
    const ids = catalog.natureIds()
    expect(ids).toHaveLength(25)
    for (let i = 0; i < 40; i++) {
      expect(ids).toContain(migrationNature(DEFAULT_MIGRATION, { userId: `u${i}`, speciesId: PIKACHU }, ids))
    }
  })

  it('does not hand everybody the same one', () => {
    const picked = new Set(
      [...Array(40).keys()].map(i =>
        migrationNature(DEFAULT_MIGRATION, { userId: `u${i}`, speciesId: PIKACHU }, catalog.natureIds())),
    )
    expect(picked.size).toBeGreaterThan(5)
  })
})

describe('ability', () => {
  it('only ever picks a normal ability, never the hidden one', () => {
    const form = catalog.defaultForm(PIKACHU)!
    expect(form.abilities.hidden).not.toBeNull()
    const normal = [form.abilities.slot1, form.abilities.slot2].filter(id => id !== null)
    for (let i = 0; i < 60; i++) {
      const id = migrationAbility(DEFAULT_MIGRATION, { userId: `u${i}`, speciesId: PIKACHU }, form.abilities)
      expect(normal).toContain(id)
      expect(id).not.toBe(form.abilities.hidden)
    }
  })

  it('refuses a form with no normal ability rather than reaching for the hidden one', () => {
    expect(() => migrationAbility(
      DEFAULT_MIGRATION,
      { userId: 'u', speciesId: 1 },
      { slot1: null, slot2: null, hidden: 42 },
    )).toThrow(LegacyMigrationError)
  })
})

describe('gender and shiny', () => {
  it('follows the species ratio and keeps genderless species genderless', () => {
    expect(migrate(row({ pokemon_id: MAGNEMITE })).draft.gender).toBe('genderless')
    expect(['male', 'female']).toContain(migrate().draft.gender)
    expect(migrationGender(DEFAULT_MIGRATION, { userId: 'u', speciesId: 1 }, 0)).toBe('male')
    expect(migrationGender(DEFAULT_MIGRATION, { userId: 'u', speciesId: 1 }, 8)).toBe('female')
  })

  it('is never shiny unless the caller brings unambiguous evidence', () => {
    expect(migrate().draft.shiny).toBe(false)
    expect(migrate(row(), { shiny: true }).draft.shiny).toBe(true)
  })
})

describe('what the legacy row itself knew', () => {
  it('preserves species, experience, owner and the moves that resolve', () => {
    const { draft, report } = migrate()
    expect(draft.speciesId).toBe(PIKACHU)
    expect(draft.experience).toBe(8000)
    expect(levelForExperience(draft.experience)).toBe(levelForExperience(8000))
    expect(draft.ownership.ownerId).toBe('trainer-a')
    expect(draft.moves).toHaveLength(2)
    expect(report.preserved).toContain('moves')
    expect(report.derived).toEqual(['natureId', 'abilityId', 'ivs', 'gender'])
  })

  it('never replaces a move it could not read: it reports the repair instead', () => {
    const { draft, report } = migrate(row({ moves: { 1: 'latigo-cepa', 2: 'no-such-move' } }))
    expect(draft.moves).toEqual([])
    expect(report.needsMoveBackfill).toBe(true)
    expect(report.unresolvedMoves).toEqual(['latigo-cepa', 'no-such-move'])
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
