import { describe, expect, it } from 'vitest'
import { CHUNK_TILES } from '../../wildlands/engine/chunks'
import { BIOME_TYPES, normaliseType } from '../../wildlands/engine/population'
import { normalisePokemonType } from './affinity'
import { TYPE_HOME_BIOMES } from './catalog/affinityProfiles'
import { SPECIES_BASE_STATS } from './catalog/speciesBaseStats'
import { validateCatalog } from './catalogValidation'
import type { Biome, PokemonType } from './types'

describe('profession catalog', () => {
  it('is structurally connected: references, faucets, sinks and recipes', () => {
    expect(validateCatalog()).toEqual([])
  })

  it('covers the full 493-species roster with six integer stats', () => {
    const ids = Object.keys(SPECIES_BASE_STATS).map(Number)
    expect(ids).toHaveLength(493)
    expect(Math.min(...ids)).toBe(1)
    expect(Math.max(...ids)).toBe(493)
    for (const stats of Object.values(SPECIES_BASE_STATS)) {
      expect(stats).toHaveLength(6)
      expect(stats.every(value => Number.isInteger(value) && value > 0)).toBe(true)
    }
  })

  it('keeps type home biomes aligned with the wild population rule', () => {
    for (const [biome, types] of Object.entries(BIOME_TYPES)) {
      for (const type of types) expect(TYPE_HOME_BIOMES[type as PokemonType]).toContain(biome)
    }
    for (const [type, biomes] of Object.entries(TYPE_HOME_BIOMES)) {
      for (const biome of biomes ?? []) expect(BIOME_TYPES[biome as Biome]).toContain(type)
    }
  })

  it('normalises database type names exactly like the wild population', () => {
    for (const name of ['Planta', 'fuego', 'Eléctrico', 'psiquico', 'Dragón', 'dragon', 'volador', 'steel', 'Normal', 'hada']) {
      expect(normalisePokemonType(name)).toBe(normaliseType(name))
    }
    expect(normalisePokemonType('desconocido')).toBeNull()
  })

  it('matches the engine chunk size used by nodesInChunk', () => {
    expect(CHUNK_TILES).toBe(32)
  })
})
