import { describe, expect, it } from 'vitest'
import { createActor } from './actors'
import type { Area } from './area'
import { wildHitAt, wildHitFacing } from './wildTaps'

const world = { kind: 'wild' } as Area
const town = { kind: 'town' } as Area
const wild = createActor({ id: 'wild:25', kind: 'pokemon', habitat: 'land', tx: 1, ty: 1, pokemon: { id: 25, name: 'Pikachu', shiny: false, frames: {} as never }, wild: true })
const companion = createActor({ id: 'companion:25', kind: 'pokemon', habitat: 'any', tx: 1, ty: 1, pokemon: wild.pokemon })

describe('wild taps', () => {
  it('selects only marked wild actors in worlds', () => {
    expect(wildHitAt(world, { tile: null, actor: wild })).toEqual({ kind: 'wild', pokemonId: 25 })
    expect(wildHitAt(world, { tile: null, actor: companion })).toBeNull()
    expect(wildHitAt(town, { tile: null, actor: wild })).toBeNull()
  })
  it('supports the action key facing a wild actor', () => {
    expect(wildHitFacing(world, wild)).toEqual({ kind: 'wild', pokemonId: 25 })
    expect(wildHitFacing(world, companion)).toBeNull()
  })
})
