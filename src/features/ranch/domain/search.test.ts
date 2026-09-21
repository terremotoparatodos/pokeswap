import { describe, expect, it } from 'vitest'
import { buildSearchIndex, findByName, normalizeName, searchByName } from './search'

const people = ['JuanPerez', 'Juan Pérez 2', 'juanita_gamer', 'ElPibeDeMudkip', 'Ñandú_Veloz', 'Sofía Martínez', 'MudkipFan']
const index = buildSearchIndex(people, name => name)

describe('normalizeName', () => {
  it('ignores case, accents, spaces and separators', () => {
    expect(normalizeName('Juan Pérez')).toBe('juanperez')
    expect(normalizeName('juan_perez')).toBe('juanperez')
    expect(normalizeName('  Ñandú-Veloz ')).toBe('nanduveloz')
  })
})

describe('search', () => {
  it('ranks exact, then prefix, then substring', () => {
    expect(searchByName(index, 'juanperez')).toEqual(['JuanPerez', 'Juan Pérez 2'])
    expect(searchByName(index, 'juan')).toEqual(['JuanPerez', 'Juan Pérez 2', 'juanita_gamer'])
    expect(searchByName(index, 'mudkip')).toEqual(['MudkipFan', 'ElPibeDeMudkip'])
  })

  it('finds accented names without accents', () => {
    expect(searchByName(index, 'sofia martinez')).toEqual(['Sofía Martínez'])
    expect(searchByName(index, 'nandu')).toEqual(['Ñandú_Veloz'])
  })

  it('returns nothing for an empty query and respects the limit', () => {
    expect(searchByName(index, '  ')).toEqual([])
    expect(searchByName(index, 'a', 2)).toHaveLength(2)
  })

  it('resolves ?u= links by exact normalized name', () => {
    expect(findByName(index, 'juan perez')).toBe('JuanPerez')
    expect(findByName(index, 'juan')).toBeNull()
    expect(findByName(index, '')).toBeNull()
  })
})
