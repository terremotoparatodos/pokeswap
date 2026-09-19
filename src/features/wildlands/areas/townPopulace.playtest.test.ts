import { describe, expect, it } from 'vitest'

const files = import.meta.glob('./townPopulace.ts', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>
const source = Object.values(files)[0]

describe('town populace in the community playtest', () => {
  it('compile-gates every trainer NPC while preserving the plaza Pokémon path', () => {
    expect(source).toContain("const SHOW_TOWN_NPCS = import.meta.env.VITE_PLAYTEST !== 'on'")
    expect(source).toContain('if (SHOW_TOWN_NPCS)')
    expect(source).toContain('this.plaza = new PlazaPokemon')
  })
})
