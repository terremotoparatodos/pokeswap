// The Battle Catalog has to be *right*, not just present (R32.1).
//
// These are the checks that would catch a bad regeneration: a missing species,
// a duplicate id, a learnset pointing at a move that does not exist, a type
// that is not a type, a version that does not match across files. They run
// against the generated data, so a broken pipeline fails here and not in a
// battle three phases from now.

import { describe, expect, it } from 'vitest'
import core from './generated/core.json'
import moves from './generated/moves.json'
import learnsets from './generated/learnsets.json'
import report from './generated/report.json'
import { CATALOG_VERSION } from './generated/version'
import { loadBattleCatalog, loadLearnsets, resetBattleCatalog } from './index'
import type { TypeName } from './types'

const TYPE_NAMES = new Set<string>([
  'normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost', 'steel',
  'fire', 'water', 'grass', 'electric', 'psychic', 'ice', 'dragon', 'dark', 'fairy',
])
const SPECIES_IN_SCOPE = 493

describe('the catalog is versioned and consistent', () => {
  it('carries the same version everywhere', () => {
    expect(CATALOG_VERSION).toMatch(/^1\.oras\.[0-9a-f]{12}$/)
    expect(core.catalogVersion).toBe(CATALOG_VERSION)
    expect(moves.catalogVersion).toBe(CATALOG_VERSION)
    expect(learnsets.catalogVersion).toBe(CATALOG_VERSION)
    expect(report.catalogVersion).toBe(CATALOG_VERSION)
  })

  it('records where it came from, with commit and licence', () => {
    const veekun = core.provenance.sources.find(entry => entry.id === 'veekun')!
    expect(veekun.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(veekun.license).toBe('MIT')
    expect(core.provenance.ruleset).toContain('Generation VI')
    expect(Object.keys(core.provenance.generatedFrom).length).toBeGreaterThan(15)
    for (const file of Object.values(core.provenance.generatedFrom)) {
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('names both data sources, with commits and licences', () => {
    const ids = core.provenance.sources.map(entry => entry.id)
    expect(ids).toContain('veekun')
    expect(ids).toContain('pokemon-showdown')
    const showdown = core.provenance.sources.find(entry => entry.id === 'pokemon-showdown')!
    expect(showdown.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(showdown.license).toBe('MIT')
  })

  it('reports no build issues', () => {
    expect(report.issues).toEqual([])
    expect(report.species).toBe(SPECIES_IN_SCOPE)
    expect(report.formsWithoutLearnset).toBe(0)
  })
})

describe('species and forms', () => {
  it('covers every species in scope, exactly once', () => {
    expect(core.species).toHaveLength(SPECIES_IN_SCOPE)
    const ids = core.species.map(entry => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(Math.min(...ids)).toBe(1)
    expect(Math.max(...ids)).toBe(SPECIES_IN_SCOPE)
  })

  it('gives every species one default form and valid stats', () => {
    for (const species of core.species) {
      const forms = core.forms.filter(form => form.speciesId === species.id)
      const defaults = forms.filter(form => form.isDefault)
      expect(defaults, `species ${species.id}`).toHaveLength(1)
      expect(species.catchRate, `catch rate of ${species.name}`).toBeGreaterThanOrEqual(3)
      expect(species.catchRate).toBeLessThanOrEqual(255)
    }
  })

  it('never invents a type, a stat or an ability', () => {
    const abilityIds = new Set(core.abilities.map(entry => entry.id))
    const formIds = core.forms.map(entry => entry.id)
    expect(new Set(formIds).size).toBe(formIds.length)
    for (const form of core.forms) {
      expect(form.types.length, `types of ${form.name}`).toBeGreaterThanOrEqual(1)
      expect(form.types.length).toBeLessThanOrEqual(2)
      for (const type of form.types) expect(TYPE_NAMES.has(type), `${form.name}: ${type}`).toBe(true)
      expect(form.baseStats).toHaveLength(6)
      for (const stat of form.baseStats) {
        expect(stat, `stat of ${form.name}`).toBeGreaterThan(0)
        expect(stat).toBeLessThanOrEqual(255)
      }
      for (const slot of [form.abilities.slot1, form.abilities.slot2, form.abilities.hidden]) {
        if (slot !== null) expect(abilityIds.has(slot), `${form.name} ability ${slot}`).toBe(true)
      }
      expect(core.species.some(species => species.id === form.speciesId)).toBe(true)
    }
  })
})

// The tabular source ships today's values; these are the ones that moved after
// ORAS, so they prove the Gen VI correction layer actually ran.
describe('species are Generation VI, not current', () => {
  const form = (name: string) => core.forms.find(entry => entry.name === name)!
  const abilityName = (id: number | null) => core.abilities.find(entry => entry.id === id)?.name ?? null

  it('gives Gengar back Levitate', () => {
    expect(abilityName(form('gengar').abilities.slot1)).toBe('levitate')
    expect(abilityName(form('gengar').abilities.slot2)).toBeNull()
  })

  it('keeps the base stats the Gen VII buffs changed', () => {
    expect(form('arbok').baseStats).toEqual([60, 85, 69, 65, 79, 80])
    expect(form('pelipper').baseStats).toEqual([60, 50, 100, 85, 70, 65])
    expect(form('torkoal').baseStats).toEqual([70, 85, 140, 85, 70, 20])
  })

  it('records how many rows the correction touched', () => {
    expect(report.genSixCorrections.baseStats).toBeGreaterThan(15)
    expect(report.genSixCorrections.abilities).toBeGreaterThan(5)
  })
})

describe('moves', () => {
  it('has unique ids and valid columns', () => {
    const ids = moves.moves.map(entry => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const move of moves.moves) {
      expect(TYPE_NAMES.has(move.type), `${move.name}: ${move.type}`).toBe(true)
      expect(['physical', 'special', 'status']).toContain(move.category)
      expect(move.pp, move.name).toBeGreaterThan(0)
      if (move.category === 'status') expect(move.power, move.name).toBeNull()
      // A damaging move without power computes its own (Seismic Toss, Low Kick,
      // the counters); the catalog marks those unsupported rather than zero.
      else if (move.power === null) expect(move.supported, move.name).toBe(false)
      else expect(move.power, move.name).toBeGreaterThan(0)
      if (move.accuracy !== null) {
        expect(move.accuracy).toBeGreaterThan(0)
        expect(move.accuracy).toBeLessThanOrEqual(100)
      }
      expect(move.priority).toBeGreaterThanOrEqual(-7)
      expect(move.priority).toBeLessThanOrEqual(5)
    }
  })

  it('says what it cannot run yet, instead of pretending', () => {
    for (const move of moves.moves) {
      if (move.supported) expect(move.unsupportedReason, move.name).toBeUndefined()
      else expect(move.unsupportedReason, move.name).toBeTruthy()
    }
    expect(moves.moves.filter(move => move.supported).length).toBeGreaterThan(400)
  })

  // The values that changed after ORAS are the ones a wrong pipeline gets wrong.
  it('holds Generation VI values, not today\'s', () => {
    const find = (name: string) => moves.moves.find(move => move.name === name)!
    expect(find('thunder-wave').accuracy, 'Gen VII lowered it to 90').toBe(100)
    expect(find('dark-void').accuracy, 'Gen VII lowered it to 50').toBe(80)
    expect(find('tackle').power, 'Gen VII lowered it to 40').toBe(50)
    expect(find('fell-stinger').power, 'Gen VII raised it to 50').toBe(30)
    expect(find('knock-off').power, 'Gen VI raised it to 65').toBe(65)
  })

  it('keeps the shapes a battle needs', () => {
    const find = (name: string) => moves.moves.find(move => move.name === name)!
    expect(find('quick-attack').priority).toBe(1)
    expect(find('protect')).toMatchObject({ effectId: 'protect', priority: 4, supported: true })
    expect(find('bullet-seed')).toMatchObject({ effectId: 'damage.multiHit' })
    expect(find('bullet-seed').meta).toMatchObject({ minHits: 2, maxHits: 5 })
    expect(find('giga-drain')).toMatchObject({ effectId: 'damage.drain' })
    expect(find('giga-drain').meta.drain).toBe(50)
    expect(find('double-edge')).toMatchObject({ effectId: 'damage.recoil', supported: false })
    expect(find('hyper-beam')).toMatchObject({ effectId: 'damage.recharge', supported: false })
    expect(find('flamethrower')).toMatchObject({ effectId: 'damage.ailment' })
    expect(find('flamethrower').meta).toMatchObject({ ailment: 'burn', ailmentChance: 10 })
    expect(find('swords-dance')).toMatchObject({ effectId: 'statChange', category: 'status' })
  })
})

describe('learnsets', () => {
  it('only ever points at moves and forms that exist', () => {
    const moveIds = new Set(moves.moves.map(entry => entry.id))
    const formIds = new Set(core.forms.map(entry => entry.id))
    for (const [id, learnset] of Object.entries(learnsets.learnsets)) {
      expect(formIds.has(Number(id)), `learnset of form ${id}`).toBe(true)
      for (const [moveId, level] of learnset.level) {
        expect(moveIds.has(moveId), `form ${id} level move ${moveId}`).toBe(true)
        expect(level).toBeGreaterThanOrEqual(0)
        expect(level).toBeLessThanOrEqual(100)
      }
      for (const group of [learnset.machine, learnset.egg, learnset.tutor]) {
        for (const moveId of group) expect(moveIds.has(moveId), `form ${id} move ${moveId}`).toBe(true)
      }
    }
  })

  it('gives every default form something to learn', () => {
    for (const form of core.forms.filter(entry => entry.isDefault)) {
      const learnset = (learnsets.learnsets as Record<string, { level: unknown[] }>)[String(form.id)]
      expect(learnset, `form ${form.name}`).toBeDefined()
      expect(learnset.level.length, `level moves of ${form.name}`).toBeGreaterThan(0)
    }
  })
})

describe('type chart and natures', () => {
  it('has the eighteen Gen VI types and the Fairy row', () => {
    expect(core.types).toHaveLength(18)
    const chart = core.typeChart as Record<string, Record<string, number>>
    expect(Object.keys(chart).sort()).toEqual([...TYPE_NAMES].sort())
    expect(chart.fairy.dragon).toBe(2)
    expect(chart.dragon.fairy).toBe(0)
    expect(chart.fighting.fairy).toBe(0.5)
    // Gen VI removed Steel's resistance to Ghost and Dark.
    expect(chart.ghost.steel).toBeUndefined()
    expect(chart.dark.steel).toBeUndefined()
    expect(chart.water.fire).toBe(2)
    expect(chart.normal.ghost).toBe(0)
  })

  it('has the twenty-five natures, five of them neutral', () => {
    expect(core.natures).toHaveLength(25)
    const neutral = core.natures.filter(nature => nature.increased === nature.decreased)
    expect(neutral).toHaveLength(5)
    for (const nature of core.natures) {
      expect(nature.name).toMatch(/^[a-z]+$/)
    }
  })
})

describe('the reader', () => {
  it('indexes what it loads and answers effectiveness', async () => {
    resetBattleCatalog()
    const catalog = await loadBattleCatalog()
    expect(catalog.catalogVersion).toBe(CATALOG_VERSION)
    expect(catalog.species(25)?.name).toBe('pikachu')
    expect(catalog.formOf(6)?.types).toEqual(['fire', 'flying'])
    expect(catalog.formsOf(386).length).toBeGreaterThan(1)
    expect(catalog.moveNamed('thunderbolt')?.power).toBe(90)
    expect(catalog.ability(1)?.name).toBe('stench')
    expect(catalog.nature(1)?.name).toBe('hardy')

    expect(catalog.effectiveness('electric' as TypeName, 'water' as TypeName)).toBe(2)
    expect(catalog.effectiveness('electric' as TypeName, 'ground' as TypeName)).toBe(0)
    expect(catalog.effectiveness('normal' as TypeName, 'normal' as TypeName)).toBe(1)
    // Charizard: 4× against Rock, and immune to Ground.
    const charizard = catalog.formOf(6)!.types
    expect(catalog.effectivenessAgainst('rock' as TypeName, charizard)).toBe(4)
    expect(catalog.effectivenessAgainst('ground' as TypeName, charizard)).toBe(0)
  })

  it('loads learnsets apart and keyed by form', async () => {
    const byForm = await loadLearnsets()
    const pikachu = byForm.get(25)!
    expect(pikachu.level.length).toBeGreaterThan(0)
    expect(pikachu.machine.length).toBeGreaterThan(0)
    // Thunderbolt (85) is a TM in ORAS.
    expect(pikachu.machine).toContain(85)
  })
})
