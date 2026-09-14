import { describe, expect, it, vi } from 'vitest'
import { createActor, type PokemonInfo } from './actors'
import { CompanionFollower } from './companion'

const info = (id: number, name = `P${id}`): PokemonInfo => ({ id, name, shiny: false, frames: {} as PokemonInfo['frames'] })
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('CompanionFollower', () => {
  it('follows completed player tiles with one tile of lag', async () => {
    const player = createActor({ id: 'player', kind: 'player', habitat: 'any', tx: 0, ty: 0, speed: 4 })
    const follower = new CompanionFollower(pokemon => Promise.resolve(info(pokemon.id)), pokemon => info(pokemon.id, 'ball'))
    follower.set({ id: 25, name_es: 'Pikachu', sprite_url: null }, player)
    await flush()

    player.tx = 1
    follower.playerArrived(player)
    player.tx = 2
    follower.playerArrived(player)
    follower.update(player, 0.01)

    expect(follower.actor?.fromTx).toBe(0)
    expect(follower.actor?.tx).toBe(1)
    expect(follower.actor?.dir).toBe('right')
  })

  it('snaps safely on area changes and never participates in movement rules', async () => {
    const player = createActor({ id: 'player', kind: 'player', habitat: 'any', tx: 5, ty: 7 })
    const follower = new CompanionFollower(pokemon => Promise.resolve(info(pokemon.id)), pokemon => info(pokemon.id))
    follower.set({ id: 7, name_es: 'Squirtle', sprite_url: null }, player)
    await flush()
    player.tx = 100
    player.ty = -20
    player.dir = 'up'
    follower.reset(player)
    expect(follower.actor).toMatchObject({ tx: 100, ty: -20, fromTx: 100, fromTy: -20, dir: 'up' })
  })

  it('uses fallback art and ignores a stale asynchronous selection', async () => {
    let release!: (value: PokemonInfo | null) => void
    const load = vi.fn((pokemon: { id: number }) => pokemon.id === 1
      ? new Promise<PokemonInfo | null>(resolve => { release = resolve })
      : Promise.resolve(null))
    const fallback = vi.fn(pokemon => info(pokemon.id, 'ball'))
    const player = createActor({ id: 'player', kind: 'player', habitat: 'any', tx: 0, ty: 0 })
    const follower = new CompanionFollower(load, fallback)
    follower.set({ id: 1, name_es: 'Old', sprite_url: null }, player)
    follower.set({ id: 2, name_es: 'New', sprite_url: null }, player)
    release(info(1))
    await flush()
    expect(follower.actor?.pokemon).toMatchObject({ id: 2, name: 'ball' })
    expect(fallback).toHaveBeenCalledOnce()
  })
})
