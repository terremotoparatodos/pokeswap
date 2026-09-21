import { describe, expect, it } from 'vitest'

const files = import.meta.glob('./townPopulace.ts', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>
const source = Object.values(files)[0]

describe('town populace in the community playtest', () => {
  it('keeps ambient trainers and the plaza Pokémon path alive', () => {
    expect(source).not.toContain('SHOW_TOWN_NPCS')
    expect(source).toContain('def.residents.forEach')
    expect(source).toContain('def.wanderers.forEach')
    expect(source).toContain('this.plaza = new PlazaPokemon')
  })
})
