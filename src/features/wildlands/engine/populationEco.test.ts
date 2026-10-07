// ECO-GAMEPLAY-1 (experimental): the client draws exactly the server's ECO population, by encounter
// id. Several individuals of a species are several actors; the roster is never shown at the same
// time; the cosmetic pool's owner filter never touches an ECO encounter.

import { describe, expect, it, vi } from 'vitest'
import type { EcoArea, EcoEncounter, WildRoster } from '../../../../services/realtime/src/world/worldProtocol.js'

vi.mock('./characters', async importOriginal => ({
  ...(await importOriginal<typeof import('./characters')>()),
  // No image decoding in tests: a stand-in frame set per species.
  loadOverworldFrames: vi.fn(async (id: number) => ({ stand: id }) as never),
}))

const { Population } = await import('./population')
const { World } = await import('./world')
type SharedPopulace = import('./area').SharedPopulace

const settle = () => new Promise(resolve => setTimeout(resolve, 0))
const encounter = (id: string, speciesId: number, tx: number, ty = -69): EcoEncounter => ({ id, groupId: id.split(':').slice(0, 4).join(':'), speciesId, tx, ty })
const area = (encounters: EcoEncounter[]): EcoArea => ({ protocol: 1, areaId: 'pradera', status: 'active', encounters })
const roster: WildRoster = { areaId: 'pradera', epoch: 1, entities: [{ id: 'wild:pradera:1:25', pokemonId: 25, tx: -5, ty: -69, habitat: 'land', shiny: false }] }

function setup(state: { eco: EcoArea | null; roster: WildRoster | null }, pokedex: import('./population').PokedexEntry[] = []) {
  const population = new Population(new World(208), pokedex, [])
  const shared: SharedPopulace = { serverNow: () => 1_791_000_000_000, wildRoster: () => state.roster, ecoArea: () => state.eco, walkable: () => true }
  population.share(shared)
  const update = async () => { population.update(-5, -69); await settle(); population.update(-5, -69) }
  const wild = () => population.actors.filter(actor => actor.wild)
  return { population, update, wild }
}

const A1 = encounter('eco-n:pradera:pastizal:1:0', 19, -10)
const A2 = encounter('eco-n:pradera:pastizal:1:1', 19, -11)
const B1 = encounter('eco-n:pradera:bosque:3:0', 16, -20)

describe('the ECO population on screen', () => {
  it('draws one actor per encounter id — two of one species are two actors — and never the roster', async () => {
    const state = { eco: area([A1, A2, B1]), roster }
    const { update, wild } = setup(state)
    await update()
    expect(wild().map(actor => actor.id).sort()).toEqual([A1.id, A2.id, B1.id].sort())
    expect(wild().filter(actor => actor.pokemon?.id === 19)).toHaveLength(2)
    expect(wild().some(actor => actor.id === roster.entities[0].id)).toBe(false)
  })

  it('follows the server list: a retired id goes, a new one comes, the others stay the same actors', async () => {
    const state = { eco: area([A1, A2, B1]) as EcoArea | null, roster: null }
    const { update, wild } = setup(state)
    await update()
    const kept = wild().find(actor => actor.id === A2.id)
    const C1 = encounter('eco-n:pradera:pastizal:2:0', 21, -12)
    state.eco = area([A2, B1, C1])
    await update()
    expect(wild().map(actor => actor.id).sort()).toEqual([A2.id, B1.id, C1.id].sort())
    expect(wild().find(actor => actor.id === A2.id)).toBe(kept)
  })

  it('an encounter retired while its sprite loads never appears', async () => {
    const state = { eco: area([A1]) as EcoArea | null, roster: null }
    const { population, wild } = setup(state)
    population.update(-5, -69) // starts loading A1
    state.eco = area([])
    population.update(-5, -69) // A1 retired before its sprite arrived
    await settle()
    population.update(-5, -69)
    expect(wild()).toEqual([])
  })

  it('the cosmetic pool (unique, unowned Pokémon) never filters an ECO encounter', async () => {
    const { population, update, wild } = setup({ eco: area([A1, B1]), roster: null })
    await update()
    population.setWildPokemonIds([])
    expect(wild()).toHaveLength(2)
  })

  it('without the experiment (no ECO area) the roster path is unchanged', async () => {
    // The roster path needs the Pokédex entry of its unique Pokémon (existing behaviour).
    const { population, update, wild } = setup({ eco: null, roster }, [{ id: 25, name_es: 'Pikachu', type1: 'eléctrico', type2: null, sprite_url: null }])
    population.setWildPokemonIds([25])
    await update()
    expect(wild().map(actor => actor.id)).toEqual([roster.entities[0].id])
  })

  it('leaving the experiment (ECO area gone) clears the ECO actors', async () => {
    const state = { eco: area([A1, B1]) as EcoArea | null, roster: null }
    const { update, wild } = setup(state)
    await update()
    state.eco = null
    await update()
    expect(wild()).toEqual([])
  })
})
