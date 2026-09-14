import { describe, expect, it, vi } from 'vitest'
import type { Pokemon, Slot } from '../../../shared/types/database'
import { useMapEntities } from './useMapEntities'

vi.mock('../data/mapConfig', () => ({
  getHearthomePoint: () => ({ x: 1, y: 1 }),
  getSpawnPoint: () => ({ x: 2, y: 2 }),
  WILD_POOL_SIZE: 0,
  WILD_ROTATE_MS: 3_600_000,
}))

function pokemon(id: number): Pokemon {
  return {
    id, name_es: `P${id}`, type1: 'normal', type2: null, sprite_url: null, is_legendary: false,
    region: 'kanto', generation: 1, base_price: 1, base_aura: 1, locked: false, created_at: null,
  } as Pokemon
}

function slot(id: number, price: number, owner: string | null = 'x'): Slot {
  return {
    pokemon_id: id, owner_id: owner, owner_username: owner, current_price: price, claim_count: null,
    is_locked: false, last_claimed_at: null, aura: null, aura_updated_at: null, owned_since: null,
    first_owner_id: null, first_owner_username: null, energy: null, energy_updated_at: null,
    link_url: null, link_text: null, created_at: null, updated_at: null,
  }
}

const POKEMON = Array.from({ length: 12 }, (_, i) => pokemon(i + 1))
/** Pokémon 1 is the cheapest, 12 the most expensive: 3..12 form the top 10. */
const SLOTS = Object.fromEntries(POKEMON.map(p => [p.id, slot(p.id, p.id * 100)])) as Record<number, Slot>
const ids = (list: readonly { id: number; isWild: boolean }[]) => list.filter(e => !e.isWild).map(e => e.id).sort((a, b) => a - b)

describe('useMapEntities', () => {
  it('spawns the top 10 plus the viewer’s own Pokémon', () => {
    const e = useMapEntities()
    e.spawnAll(POKEMON, { ...SLOTS, 1: slot(1, 100, 'me') }, 'me')
    expect(ids(e.entities.value)).toEqual([1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('updates price in place and keeps the position', () => {
    const e = useMapEntities()
    e.spawnAll(POKEMON, SLOTS, null)
    e.applySlotPatch({ pokemon_id: 12, owner_id: 'x', owner_username: 'x', current_price: 5000, is_locked: false, aura: null }, POKEMON, SLOTS, null)
    const top = e.entities.value.find(x => x.id === 12)!
    expect(top.slot?.current_price).toBe(5000)
    expect(top.x).toBe(1)
  })

  it('adds a Pokémon that climbs into the top 10 and removes the one pushed out', () => {
    const e = useMapEntities()
    e.spawnAll(POKEMON, SLOTS, null)
    e.applySlotPatch({ pokemon_id: 1, owner_id: 'x', owner_username: 'x', current_price: 9999, is_locked: false, aura: null }, POKEMON, SLOTS, null)
    expect(ids(e.entities.value)).toEqual([1, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('brings in the next Pokémon when a top one drops in price', () => {
    const e = useMapEntities()
    e.spawnAll(POKEMON, SLOTS, null)
    e.applySlotPatch({ pokemon_id: 12, owner_id: 'x', owner_username: 'x', current_price: 1, is_locked: false, aura: null }, POKEMON, SLOTS, null)
    expect(ids(e.entities.value)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  })

  it('turns a Pokémon that lost its owner into a wild one', () => {
    const e = useMapEntities()
    e.spawnAll(POKEMON, SLOTS, null)
    e.applySlotPatch({ pokemon_id: 5, owner_id: null, owner_username: null, current_price: 0, is_locked: false, aura: null }, POKEMON, SLOTS, null)
    const five = e.entities.value.find(x => x.id === 5)!
    expect(five.isWild).toBe(true)
    expect(five.slot).toBeNull()
    expect(ids(e.entities.value)).toContain(2)
  })

  it('ignores patches for unknown Pokémon', () => {
    const e = useMapEntities()
    e.spawnAll(POKEMON, SLOTS, null)
    const before = ids(e.entities.value)
    e.applySlotPatch({ pokemon_id: 999, owner_id: 'x', owner_username: 'x', current_price: 1e9, is_locked: false, aura: null }, POKEMON, SLOTS, null)
    expect(ids(e.entities.value)).toEqual(before)
  })
})
