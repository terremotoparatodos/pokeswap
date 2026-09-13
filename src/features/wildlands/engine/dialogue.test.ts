import { describe, expect, it } from 'vitest'
import { createActor } from './actors'
import { actorLine } from './dialogue'

const pokemon = (shiny: boolean) => createActor({
  id: 'p', kind: 'pokemon', habitat: 'land', tx: 0, ty: 0,
  pokemon: { name: 'Eevee', shiny } as never,
})

describe('actorLine', () => {
  it('greets town Pokémon and announces wild ones, shiny included', () => {
    expect(actorLine(pokemon(false), true, 0, 0)).toBe('Eevee te saluda contento.')
    expect(actorLine(pokemon(false), false, 0, 0)).toBe('¡Un Eevee salvaje te mira fijo!')
    expect(actorLine(pokemon(true), false, 0, 0)).toContain('shiny')
  })

  it('prefers a resident’s own lines and picks stock lines by tile otherwise', () => {
    const resident = createActor({ id: 'r', kind: 'npc', habitat: 'land', tx: 0, ty: 0, lines: ['«Hola»'] })
    expect(actorLine(resident, true, 3, 4)).toBe('«Hola»')
    const walker = createActor({ id: 'n', kind: 'npc', habitat: 'land', tx: 0, ty: 0 })
    expect(actorLine(walker, true, 1, 0)).toBe(actorLine(walker, true, 1, 0))
    expect(actorLine(walker, true, 0, 0)).not.toBe(actorLine(walker, false, 0, 0))
  })

  it('has nothing to say for the player', () => {
    expect(actorLine(createActor({ id: 'me', kind: 'player', habitat: 'any', tx: 0, ty: 0 }), true, 0, 0)).toBeNull()
  })
})
