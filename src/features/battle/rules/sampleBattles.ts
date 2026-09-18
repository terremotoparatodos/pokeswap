// Reproducible battles built from the real catalog (R32.3).
//
// One builder, used by the tests and by `npm run battle:sample`, so the thing
// a human reads and the thing CI asserts on are literally the same battle. A
// sample that drifts from the suite is worse than no sample.
//
// Everything is pinned: species, level, moves, IVs, EVs, nature and seed. A
// fixture that rolled its own Pokémon would change what it proves every time
// the factory changed, and then a red test would not mean a broken rule.

import { createPokemonInstance, createPokemonCatalogView, PERFECT_IVS, ZERO_STATS } from '../../pokemon/model'
import type { PokemonInstance } from '../../pokemon/model'
import { loadBattleCatalog, loadLearnsets } from '../catalog'
import { createBattleRulesCatalog } from './catalogView'
import type { BattleRulesCatalog } from './catalogView'
import type { BattleRulesConfig } from './config'
import { createBattleState } from './setup'
import type { BattleState } from './state'
import type { BattleContext } from './reduce'

export interface SampleFighter {
  readonly speciesId: number
  readonly level: number
  /** Catalog move slugs, e.g. `quick-attack`. Four at most. */
  readonly moves: readonly string[]
  /** Fixed so a fixture proves a rule and not a nature roll. `hardy` is neutral. */
  readonly natureName?: string
  readonly wild?: boolean
}

export interface SampleBattleInput {
  readonly battleId: string
  readonly seed: number
  readonly ally: SampleFighter
  readonly enemy: SampleFighter
  /** Extra allies on the bench, for the switch fixtures. */
  readonly bench?: readonly SampleFighter[]
  readonly config?: BattleRulesConfig
}

export interface SampleBattle {
  readonly state: BattleState
  readonly context: BattleContext
  readonly catalog: BattleRulesCatalog
  /** Move slug → catalog id, for a caller that wants to send commands by name. */
  moveId(name: string): number
}

let loading: Promise<{ catalog: BattleRulesCatalog; build: (fighter: SampleFighter, id: string) => PokemonInstance }> | null = null

async function loadBuilders(): Promise<{
  catalog: BattleRulesCatalog
  build: (fighter: SampleFighter, id: string) => PokemonInstance
}> {
  const [index, learnsets] = await Promise.all([loadBattleCatalog(), loadLearnsets()])
  const modelView = createPokemonCatalogView(index, learnsets)
  const rulesCatalog = createBattleRulesCatalog(index)
  const natureIdByName = new Map(index.catalog.natures.map(nature => [nature.name, nature.id]))

  const build = (fighter: SampleFighter, instanceId: string): PokemonInstance => {
    const moveIds = fighter.moves.map(name => {
      const move = index.moveNamed(name)
      if (!move) throw new Error(`move ${name} is not in catalog ${index.catalogVersion}`)
      return move.id
    })
    const natureId = natureIdByName.get(fighter.natureName ?? 'hardy')
    if (natureId === undefined) throw new Error(`nature ${String(fighter.natureName)} is not in the catalog`)
    return createPokemonInstance(
      {
        speciesId: fighter.speciesId,
        level: fighter.level,
        moveIds,
        natureId,
        ivs: PERFECT_IVS,
        evs: ZERO_STATS,
        shiny: false,
        gender: 'genderless',
        ownerId: fighter.wild ? null : 'sample-trainer',
        acquisition: { source: 'event', at: '2026-01-01T00:00:00.000Z', catalogVersion: index.catalogVersion },
      },
      modelView,
      // The factory's rolls are all pinned above, but it still consumes them;
      // a constant keeps the fixture from depending on any generator at all.
      () => 0.5,
      instanceId,
    )
  }

  return { catalog: rulesCatalog, build }
}

/** A 1-vs-1 battle from the real catalog, ready for `reduceBattle`. */
export async function buildSampleBattle(input: SampleBattleInput): Promise<SampleBattle> {
  const { catalog, build } = await (loading ??= loadBuilders())

  const allies = [build(input.ally, 'ally-lead'), ...(input.bench ?? []).map((f, i) => build(f, `ally-bench-${i}`))]
  const enemies = [build(input.enemy, 'enemy-lead')]

  const state = createBattleState({
    battleId: input.battleId,
    seed: input.seed,
    config: input.config,
    catalog,
    sides: [
      { sideId: 'ally', controllerId: 'sample-trainer', party: allies },
      { sideId: 'enemy', controllerId: null, party: enemies, wild: input.enemy.wild ?? true },
    ],
  })

  return {
    state,
    context: { catalog },
    catalog,
    moveId: (name: string) => {
      const move = catalog.moveNamed(name)
      if (!move) throw new Error(`move ${name} is not in the catalog`)
      return move.id
    },
  }
}

/** The two headline fixtures of R32.3, so every reader sees the same fight. */
export const PIKACHU_VS_GENGAR: SampleBattleInput = {
  battleId: 'sample-pikachu-gengar',
  seed: 20260318,
  ally: {
    speciesId: 25, level: 50, natureName: 'hardy',
    moves: ['thunderbolt', 'quick-attack', 'thunder-wave', 'double-slap'],
  },
  enemy: {
    speciesId: 94, level: 50, natureName: 'hardy', wild: true,
    moves: ['shadow-ball', 'confuse-ray', 'sludge-bomb', 'protect'],
  },
}

export const CHARIZARD_VS_AZUMARILL: SampleBattleInput = {
  battleId: 'sample-charizard-azumarill',
  seed: 991,
  ally: {
    speciesId: 6, level: 50, natureName: 'hardy',
    moves: ['flamethrower', 'double-edge', 'protect', 'giga-drain'],
  },
  enemy: {
    speciesId: 184, level: 50, natureName: 'hardy', wild: true,
    moves: ['waterfall', 'body-slam', 'toxic', 'fury-swipes'],
  },
}
