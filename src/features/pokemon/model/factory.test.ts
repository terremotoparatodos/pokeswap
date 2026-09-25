// The factory and the legacy adapter, against the **real** Battle Catalog.
//
// Fixtures are not used here on purpose: the point of these tests is that a
// Pokémon built from R32.1's generated data is a legal Pokémon, so they load
// the same files the game loads.

import { beforeAll, describe, expect, it } from 'vitest'

import { loadBattleCatalog, loadLearnsets } from '../../battle/catalog'
import { createSeededRandom } from '../../skills/domain/rng'
import { createPokemonCatalogView } from './catalogView'
import type { PokemonCatalogView } from './catalogView'
import { experienceForLevel, levelForExperience } from './experience'
import {
  PokemonFactoryError, createExpeditionCapture, createPokemonInstance,
  createPokemonInstanceDraft, defaultMoveIds, rollGender, rollIvs,
} from './factory'
import { validateInstance } from './instance'
import type { Acquisition } from './instance'
import { projectLegacyPokemon, readLegacyMoves } from './legacy'
import { PERFECT_IVS, deriveStats, statsFromTuple } from './stats'

const PIKACHU = 25
const CHARIZARD = 6
const SHUCKLE = 213
const SHEDINJA = 292
const MAGNEMITE = 81

let catalog: PokemonCatalogView
let acquisition: Acquisition

beforeAll(async () => {
  const [index, learnsets] = await Promise.all([loadBattleCatalog(), loadLearnsets()])
  catalog = createPokemonCatalogView(index, learnsets)
  acquisition = { source: 'dungeon_capture', at: '2026-03-01T12:00:00.000Z', catalogVersion: index.catalogVersion }
})

const draft = (spec: Parameters<typeof createPokemonInstanceDraft>[0], seed = 1): ReturnType<typeof createPokemonInstanceDraft> =>
  createPokemonInstanceDraft(spec, catalog, createSeededRandom(seed))

describe('createPokemonInstance', () => {
  it('builds a Pokémon the validator accepts', () => {
    const instance = createPokemonInstance(
      { speciesId: PIKACHU, level: 12, acquisition, ownerId: 'p1' },
      catalog,
      createSeededRandom(7),
      'inst-a',
    )
    expect(validateInstance(instance, catalog)).toEqual([])
    expect(instance.speciesId).toBe(PIKACHU)
    expect(instance.moves.length).toBeGreaterThan(0)
    expect(instance.moves.length).toBeLessThanOrEqual(4)
    expect(levelForExperience(instance.experience)).toBe(12)
    expect(instance.ownership).toEqual({ ownerId: 'p1', originalTrainerId: 'p1' })
  })

  it('is deterministic: the same seed builds the same individual', () => {
    const spec = { speciesId: CHARIZARD, level: 36, acquisition }
    const a = draft(spec, 424242)
    const b = draft(spec, 424242)
    expect(a).toEqual(b)
    expect(draft(spec, 424243)).not.toEqual(a)
  })

  it('spends every roll even when the caller pinned one, so the rest do not shift', () => {
    const spec = { speciesId: CHARIZARD, level: 36, acquisition }
    const rolled = draft(spec, 99)
    const pinned = draft({ ...spec, natureId: rolled.natureId }, 99)
    // The nature was decided by the caller, and its roll was spent anyway, so
    // every later roll — ability, gender, shiny — lands where it did before.
    expect(pinned.ivs).toEqual(rolled.ivs)
    expect(pinned.gender).toBe(rolled.gender)
    expect(pinned.abilityId).toBe(rolled.abilityId)
  })

  it('keeps everything the caller decides', () => {
    const instance = draft({
      speciesId: PIKACHU,
      level: 50,
      acquisition,
      ivs: PERFECT_IVS,
      evs: { hp: 252, atk: 252, def: 6, spa: 0, spd: 0, spe: 0 },
      gender: 'female',
      shiny: true,
      nickname: 'Chispa',
    })
    expect(instance.ivs).toEqual(PERFECT_IVS)
    expect(instance.gender).toBe('female')
    expect(instance.shiny).toBe(true)
    expect(instance.nickname).toBe('Chispa')
    expect(instance.experience).toBe(experienceForLevel(50))
  })

  it('starts with no EVs and no wear', () => {
    const instance = draft({ speciesId: SHUCKLE, level: 20, acquisition })
    expect(instance.evs).toEqual({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 })
    expect(instance.condition).toEqual({ currentHp: null, pp: {}, majorStatus: 'none' })
  })

  it('refuses a Mega: that is a form a Pokémon becomes, not one it is', () => {
    const mega = catalog.formsOf(CHARIZARD).find(form => form.isMega)
    expect(mega).toBeTruthy()
    expect(() => draft({ speciesId: CHARIZARD, formId: mega!.id, level: 60, acquisition }))
      .toThrow(PokemonFactoryError)
  })

  it('refuses an impossible level, an unknown species and a mismatched form', () => {
    expect(() => draft({ speciesId: PIKACHU, level: 0, acquisition })).toThrow(PokemonFactoryError)
    expect(() => draft({ speciesId: PIKACHU, level: 101, acquisition })).toThrow(PokemonFactoryError)
    expect(() => draft({ speciesId: 9999, level: 5, acquisition })).toThrow(PokemonFactoryError)
    const pikachuForm = catalog.defaultForm(PIKACHU)!
    expect(() => draft({ speciesId: CHARIZARD, formId: pikachuForm.id, level: 5, acquisition }))
      .toThrow(PokemonFactoryError)
  })

  it('gives a genderless species no gender and a Pikachu one', () => {
    expect(draft({ speciesId: MAGNEMITE, level: 10, acquisition }).gender).toBe('genderless')
    expect(['male', 'female']).toContain(draft({ speciesId: PIKACHU, level: 10, acquisition }).gender)
  })

  it('only ever picks an ability the form can have', () => {
    const form = catalog.defaultForm(PIKACHU)!
    const allowed = [form.abilities.slot1, form.abilities.slot2].filter(id => id !== null)
    for (let seed = 1; seed <= 25; seed++) {
      expect(allowed).toContain(draft({ speciesId: PIKACHU, level: 10, acquisition }, seed).abilityId)
    }
  })

  it('rolls the hidden ability only when asked', () => {
    const form = catalog.defaultForm(PIKACHU)!
    expect(form.abilities.hidden).not.toBeNull()
    const hidden = [...Array(30).keys()]
      .map(seed => draft({ speciesId: PIKACHU, level: 10, acquisition, allowHiddenAbility: true }, seed + 1).abilityId)
    expect(hidden).toContain(form.abilities.hidden)
  })

  it('rolls IVs inside 0…31', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const ivs = rollIvs(createSeededRandom(seed))
      for (const value of Object.values(ivs)) {
        expect(Number.isInteger(value)).toBe(true)
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(31)
      }
    }
  })

  it('honours the gender ratio at its edges', () => {
    const always = createSeededRandom(3)
    expect(rollGender(-1, always)).toBe('genderless')
    expect(rollGender(0, always)).toBe('male')
    expect(rollGender(8, always)).toBe('female')
  })

  it('derives the stats of a known individual', () => {
    const instance = draft({ speciesId: SHUCKLE, level: 50, acquisition, ivs: PERFECT_IVS })
    const base = statsFromTuple(catalog.formById(instance.formId)!.baseStats)
    const stats = deriveStats({ base, level: 50, ivs: instance.ivs, evs: instance.evs, nature: null })
    // Shuckle's 230 base Defense at level 50 with perfect IVs and no EVs.
    expect(stats.def).toBe(250)
  })

  it('gives Shedinja its single hit point through the alwaysOneHp flag', () => {
    const instance = draft({ speciesId: SHEDINJA, level: 40, acquisition })
    const base = statsFromTuple(catalog.formById(instance.formId)!.baseStats)
    expect(base.hp).toBe(1)
    expect(deriveStats({ base, level: 40, ivs: instance.ivs, evs: instance.evs, nature: null }, true).hp).toBe(1)
  })
})

describe('moves from the ORAS learnset', () => {
  it('takes the last four a Pokémon of that level would know', () => {
    const learnset = { level: [[1, 1], [2, 5], [3, 9], [4, 13], [5, 17]] as const, machine: [], egg: [], tutor: [] }
    expect(defaultMoveIds(learnset, 13)).toEqual([1, 2, 3, 4])
    expect(defaultMoveIds(learnset, 17)).toEqual([2, 3, 4, 5])
    expect(defaultMoveIds(learnset, 1)).toEqual([1])
  })

  it('never leaves a Pokémon without a move, even below its first level', () => {
    const learnset = { level: [[42, 20]] as const, machine: [], egg: [], tutor: [] }
    expect(defaultMoveIds(learnset, 5)).toEqual([42])
    expect(defaultMoveIds(null, 50)).toEqual([])
  })

  it('does not put the same move in two slots', () => {
    const learnset = { level: [[1, 1], [1, 10], [2, 12]] as const, machine: [], egg: [], tutor: [] }
    expect(defaultMoveIds(learnset, 12)).toEqual([1, 2])
  })

  it('starts every slot at full PP, which is what an empty condition means', () => {
    const instance = draft({ speciesId: CHARIZARD, level: 40, acquisition })
    for (const slot of instance.moves) {
      expect(slot.ppUps).toBe(0)
      expect(instance.condition.pp[slot.moveId]).toBeUndefined()
    }
  })
})

describe('a capture inside a dungeon (I-1)', () => {
  it('belongs to nobody until it is extracted', () => {
    const capture = createExpeditionCapture(
      { speciesId: PIKACHU, level: 8, acquisition },
      catalog,
      createSeededRandom(5),
    )
    expect(capture.state).toBe('expeditionPending')
    expect(capture.ownership.ownerId).toBeNull()
    expect(validateInstance({ ...capture, instanceId: 'x' }, catalog)).toEqual([])
  })

  it('refuses to be created with an owner', () => {
    expect(() => draft({ speciesId: PIKACHU, level: 8, acquisition, state: 'expeditionPending', ownerId: 'p1' }))
      .toThrow(PokemonFactoryError)
  })
})

describe('the legacy projection', () => {
  const row = { user_id: 'p1', pokemon_id: PIKACHU, xp: 8000, level: 20, moves: null }

  it('keeps what production knows and never invents the rest', () => {
    const { known, gaps } = projectLegacyPokemon(row, catalog, {
      slot: { pokemon_id: PIKACHU, owner_id: 'p1' },
    })
    expect(known.speciesId).toBe(PIKACHU)
    expect(known.experience).toBe(8000)
    expect(known.level).toBe(levelForExperience(8000))
    expect(known.ownership.ownerId).toBe('p1')
    const missing = gaps.map(gap => gap.field)
    expect(missing).toEqual(expect.arrayContaining(['natureId', 'abilityId', 'ivs', 'evs', 'gender', 'shiny']))
    expect(known).not.toHaveProperty('natureId')
    expect(known).not.toHaveProperty('ivs')
  })

  it('reports a stored level that disagrees with its own xp', () => {
    const { known, problems } = projectLegacyPokemon({ ...row, level: 99 }, catalog)
    expect(known.levelDisagrees).toBe(true)
    expect(problems.join(' ')).toContain('stored level 99')
  })

  it('reports a species the catalog does not have', () => {
    const { problems } = projectLegacyPokemon({ ...row, pokemon_id: 905 }, catalog)
    expect(problems.join(' ')).toContain('905')
  })

  it('takes ownership from the slot, and the trainer of the row only as metadata', () => {
    const { known, problems } = projectLegacyPokemon(row, catalog, {
      slot: { pokemon_id: PIKACHU, owner_id: 'current-owner', first_owner_id: 'p0' },
    })
    expect(known.ownership.ownerId).toBe('current-owner')
    expect(known.ownership.originalTrainerId).toBe('p0')
    expect(known.progressionTrainerId).toBe('p1')
    expect(problems.join(' ')).toContain('no longer owns this slot')
  })

  it('leaves a projection without a slot ownerless rather than guessing', () => {
    expect(projectLegacyPokemon(row, catalog).known.ownership.ownerId).toBeNull()
  })

  it('resolves the moves blob by name or id, and says what it could not read', () => {
    const byName = readLegacyMoves({ a: 'thunder-wave', b: 'Thunder Shock' }, catalog)
    expect(byName.moves).toHaveLength(2)
    expect(byName.unresolved).toEqual([])
    const broken = readLegacyMoves({ a: 'not-a-move', b: { id: 85 } }, catalog)
    expect(broken.moves).toHaveLength(1)
    expect(broken.unresolved).toEqual([{ slug: 'not-a-move', kind: 'unknown' }])
    expect(readLegacyMoves(null, catalog).moves).toEqual([])
  })

  it('keeps at most four moves and no duplicates', () => {
    const many = readLegacyMoves(
      { a: 'tackle', b: 'growl', c: 'thunder-shock', d: 'thunder-wave', e: 'thunderbolt', f: 'tackle' },
      catalog,
    )
    expect(many.moves).toHaveLength(4)
    expect(new Set(many.moves.map(slot => slot.moveId)).size).toBe(4)
  })
})
