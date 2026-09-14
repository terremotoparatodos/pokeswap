import { describe, expect, it, vi } from 'vitest'
import type { Actor, PokemonInfo } from './actors'
import { createActor } from './actors'
import type { BuildingDoor } from './doors'
import {
  assignHome, DOOR_CLEARANCE, HOME_SPACING, PlazaPokemon, plazaCandidates, PORTAL_CLEARANCE,
  type Home, type LoadPokemonInfo, type PlazaGround,
} from './plazaPokemon'

const info = (id: number, name = `P${id}`): PokemonInfo => ({ id, name, shiny: false, frames: {} as PokemonInfo['frames'] })
const flush = () => new Promise(r => setTimeout(r, 0))
const distance = (a: { tx: number; ty: number }, b: { tx: number; ty: number }) => Math.max(Math.abs(a.tx - b.tx), Math.abs(a.ty - b.ty))

function ground(overrides: Partial<PlazaGround> = {}): PlazaGround {
  return { isSolid: () => false, portals: [], doors: [], ...overrides }
}

function door(tx: number, ty: number): BuildingDoor {
  return { buildingId: 'b', feature: 'mercado', door: { tx, ty }, exit: { tx, ty: ty + 1, dir: 'down' }, footprint: { x: tx, y: ty, w: 1, d: 1 } }
}

describe('plazaCandidates', () => {
  it('skips solid tiles, reserved tiles and tiles near doors or gates', () => {
    const [tiles] = plazaCandidates(
      ground({
        isSolid: (tx, ty) => tx === 0 && ty === 0,
        doors: [door(20, 0)],
        portals: [{ to: 'x', label: '', tiles: [{ tx: 0, ty: 19 }] }],
      }),
      [{ x0: 0, y0: 0, x1: 20, y1: 19 }],
      [{ tx: 1, ty: 0 }],
    )
    const has = (tx: number, ty: number) => tiles.some(t => t.tx === tx && t.ty === ty)
    expect(has(0, 0)).toBe(false)
    expect(has(1, 0)).toBe(false)
    expect(has(2, 0)).toBe(true)
    for (const t of tiles) {
      expect(distance(t, { tx: 20, ty: 0 })).toBeGreaterThanOrEqual(DOOR_CLEARANCE)
      expect(distance(t, { tx: 0, ty: 19 })).toBeGreaterThanOrEqual(PORTAL_CLEARANCE)
    }
  })
})

describe('assignHome', () => {
  const zone = (x0: number) => plazaCandidates(ground(), [{ x0, y0: 0, x1: x0 + 9, y1: 9 }], [])[0]
  const candidates = [zone(0), zone(20), zone(40)]

  it('is deterministic for the same id and taken homes', () => {
    expect(assignHome(25, candidates, [])).toEqual(assignHome(25, candidates, []))
  })

  it('spreads ten Pokémon over the zones, spaced apart', () => {
    const taken: Home[] = []
    for (let id = 1; id <= 10; id++) taken.push(assignHome(id, candidates, taken)!)
    const perZone = [0, 1, 2].map(z => taken.filter(h => h.zone === z).length)
    expect(Math.max(...perZone) - Math.min(...perZone)).toBeLessThanOrEqual(1)
    for (const a of taken) for (const b of taken) if (a !== b) expect(distance(a, b)).toBeGreaterThanOrEqual(HOME_SPACING)
  })

  it('returns null when there is no room left', () => {
    const tiny = [[{ tx: 0, ty: 0 }, { tx: 1, ty: 0 }]]
    const first = assignHome(1, tiny, [])!
    expect(assignHome(2, tiny, [first])).toBeNull()
    expect(assignHome(1, [], [])).toBeNull()
  })
})

describe('PlazaPokemon', () => {
  const candidates = [plazaCandidates(ground(), [{ x0: 0, y0: 0, x1: 29, y1: 29 }], [])[0]]
  const pokedex = [{ id: 25, name_es: 'Pikachu', type1: 'electric', type2: null, sprite_url: null }]

  function setup(load: LoadPokemonInfo = entry => Promise.resolve(info(entry.id, entry.name_es))) {
    const resident = createActor({ id: 'town:r0', kind: 'npc', habitat: 'land', tx: 99, ty: 99 })
    const actors: Actor[] = [resident]
    const fallback = vi.fn((entry: { id: number; name_es: string }) => info(entry.id, 'ball'))
    const plaza = new PlazaPokemon(actors, candidates, pokedex, load, fallback)
    const owned = () => actors.filter(a => a.owned).map(a => a.pokemon!.id).sort((a, b) => a - b)
    return { actors, plaza, owned, fallback, resident }
  }

  it('adds entering Pokémon once their art loads, with their Pokédex name', async () => {
    const { plaza, owned, actors } = setup()
    plaza.sync([{ pokemonId: 25, mine: false }, { pokemonId: 7, mine: true }])
    expect(owned()).toEqual([])
    await flush()
    expect(owned()).toEqual([7, 25])
    expect(actors.find(a => a.pokemon?.id === 25)!.pokemon!.name).toBe('Pikachu')
    expect(actors.find(a => a.pokemon?.id === 7)!.owned).toEqual({ mine: true })
  })

  it('removes Pokémon that leave and keeps everyone else untouched', async () => {
    const { plaza, owned, actors, resident } = setup()
    plaza.sync([{ pokemonId: 1, mine: false }, { pokemonId: 2, mine: false }])
    await flush()
    const two = actors.find(a => a.pokemon?.id === 2)!
    plaza.sync([{ pokemonId: 2, mine: false }, { pokemonId: 3, mine: false }])
    await flush()
    expect(owned()).toEqual([2, 3])
    expect(actors.find(a => a.pokemon?.id === 2)).toBe(two)
    expect(actors[0]).toBe(resident)
  })

  it('updates the marker in place when ownership by the viewer changes', async () => {
    const { plaza, actors } = setup()
    plaza.sync([{ pokemonId: 4, mine: false }])
    await flush()
    const actor = actors.find(a => a.pokemon?.id === 4)!
    plaza.sync([{ pokemonId: 4, mine: true }])
    expect(actor.owned).toEqual({ mine: true })
  })

  it('never adds a Pokémon that left while its art was loading', async () => {
    let release!: (value: PokemonInfo) => void
    const { plaza, owned } = setup(() => new Promise(r => { release = r }))
    plaza.sync([{ pokemonId: 9, mine: false }])
    plaza.sync([])
    release(info(9))
    await flush()
    expect(owned()).toEqual([])
    expect(plaza.ids).toEqual([])
  })

  it('uses the Poké Ball when a species has no art, or loading fails', async () => {
    const { plaza, owned, fallback } = setup(entry => (entry.id === 600 ? Promise.resolve(null) : Promise.reject(new Error('x'))))
    plaza.sync([{ pokemonId: 600, mine: false }, { pokemonId: 601, mine: false }])
    await flush()
    expect(owned()).toEqual([600, 601])
    expect(fallback).toHaveBeenCalledTimes(2)
  })

  it('gives returning Pokémon the same home', async () => {
    const { plaza, actors } = setup()
    plaza.sync([{ pokemonId: 12, mine: false }])
    await flush()
    const first = actors.find(a => a.pokemon?.id === 12)!
    plaza.sync([])
    plaza.sync([{ pokemonId: 12, mine: false }])
    await flush()
    const again = actors.find(a => a.pokemon?.id === 12)!
    expect([again.homeTx, again.homeTy]).toEqual([first.homeTx, first.homeTy])
  })
})
