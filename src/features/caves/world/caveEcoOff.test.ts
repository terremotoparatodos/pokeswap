// @vitest-environment node
// ECO-GAMEPLAY-1: outside the experiment (every production build; here VITE_ECO_EXPERIMENT is unset)
// a cave interior keeps its previous populace — empty, inert — whatever it is offered.

import { describe, expect, it } from 'vitest'
import { Atlas } from '../../wildlands/areas/atlas'
import { ECO_EXPERIMENT } from '../../world/domain/ecoExperiment'
import { CaveArea } from './caveArea'

describe('a cave without the ECO experiment', () => {
  it('has no wanderers and ignores an ECO area', () => {
    expect(ECO_EXPERIMENT).toBe(false)
    const cave = new Atlas().get('cueva-inicial')
    expect(cave).toBeInstanceOf(CaveArea)
    const populace = cave.createPopulace({ pokedex: [], npcSprites: [] })
    expect(populace.share).toBeUndefined()
    populace.update(10, 11)
    expect(populace.actors).toEqual([])
    expect(cave.createPopulace({ pokedex: [], npcSprites: [] })).toBe(populace) // the same shared empty populace as before
  })
})
