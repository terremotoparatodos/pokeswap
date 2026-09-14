import { describe, expect, it } from 'vitest'
import { createActor } from './actors'
import type { Area } from './area'
import { plazaHitAt, plazaHitFacing } from './plazaTaps'

const town = { noticeBoardAt: (tx: number, ty: number) => tx === 5 && ty === 5 } as unknown as Area
const world = {} as Area
const owned = createActor({ id: 'plaza:25', kind: 'pokemon', habitat: 'land', tx: 1, ty: 1, pokemon: { id: 25, name: 'Pikachu', shiny: false, frames: {} as never }, owned: { mine: false } })
const decorative = createActor({ id: 'w', kind: 'pokemon', habitat: 'land', tx: 1, ty: 1, pokemon: { id: 16, name: 'Pidgey', shiny: false, frames: {} as never } })

describe('plazaHitAt', () => {
  it('resolves owned Pokémon and ignores wild ones and NPCs', () => {
    expect(plazaHitAt(town, { tile: { tx: 1, ty: 1 }, actor: owned })).toEqual({ kind: 'pokemon', pokemonId: 25 })
    expect(plazaHitAt(town, { tile: { tx: 1, ty: 1 }, actor: decorative })).toBeNull()
  })

  it('opens the board from its tile or the post above it, never through an actor', () => {
    expect(plazaHitAt(town, { tile: { tx: 5, ty: 5 }, actor: null })).toEqual({ kind: 'board' })
    expect(plazaHitAt(town, { tile: { tx: 5, ty: 4 }, actor: null })).toEqual({ kind: 'board' })
    expect(plazaHitAt(town, { tile: { tx: 5, ty: 6 }, actor: null })).toBeNull()
    expect(plazaHitAt(town, { tile: { tx: 5, ty: 5 }, actor: decorative })).toBeNull()
    expect(plazaHitAt(world, { tile: { tx: 5, ty: 5 }, actor: null })).toBeNull()
  })
})

describe('plazaHitFacing', () => {
  it('prefers the actor on the faced tile, else the board', () => {
    expect(plazaHitFacing(town, owned, 5, 5)).toEqual({ kind: 'pokemon', pokemonId: 25 })
    expect(plazaHitFacing(town, undefined, 5, 5)).toEqual({ kind: 'board' })
    expect(plazaHitFacing(town, undefined, 4, 5)).toBeNull()
  })
})
