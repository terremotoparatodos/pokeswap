import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SlotWithPokemon } from '../../pokemon/api/pokemonApi'
import { useMyBox } from './useMyBox'

const mockListOwned = vi.hoisted(() => vi.fn())

vi.mock('../../pokemon/api/pokemonApi', () => ({
  listOwnedSlotsWithPokemon: (...args: unknown[]) => mockListOwned(...args),
}))

const item = (id: number, ownerId: string): SlotWithPokemon => ({
  slot: { pokemon_id: id, owner_id: ownerId } as SlotWithPokemon['slot'],
  pokemon: { id, name_es: `P${id}` } as SlotWithPokemon['pokemon'],
})

describe('useMyBox shared ownership state', () => {
  const box = useMyBox()

  beforeEach(() => {
    box.clear()
    mockListOwned.mockReset()
  })

  it('shares the server-filtered result for the active user', async () => {
    mockListOwned.mockResolvedValue([item(25, 'u1')])
    await box.load('u1')
    expect(mockListOwned).toHaveBeenCalledWith('u1')
    expect(box.activeUserId.value).toBe('u1')
    expect(box.items.value.map(entry => entry.pokemon.id)).toEqual([25])
  })

  it('does not let a previous user request overwrite a newer session', async () => {
    let resolveFirst!: (items: SlotWithPokemon[]) => void
    let resolveSecond!: (items: SlotWithPokemon[]) => void
    mockListOwned
      .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveSecond = resolve }))
    const first = box.load('u1')
    const second = box.load('u2')
    resolveFirst([item(1, 'u1')])
    resolveSecond([item(2, 'u2')])
    await Promise.all([first, second])
    expect(box.activeUserId.value).toBe('u2')
    expect(box.items.value.map(entry => entry.pokemon.id)).toEqual([2])
  })

  it('clears user data immediately on logout', async () => {
    mockListOwned.mockResolvedValue([item(25, 'u1')])
    await box.load('u1')
    box.clear()
    expect(box.activeUserId.value).toBeNull()
    expect(box.items.value).toEqual([])
  })
})
