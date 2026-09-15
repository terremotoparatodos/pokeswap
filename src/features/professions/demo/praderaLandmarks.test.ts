import { describe, expect, it } from 'vitest'
import { WORLDS } from '../../wildlands/areas/atlas'
import { World } from '../../wildlands/engine/world'
import { GATHERING_NODES } from '../domain/catalog/nodes'
import { nodeAt, worldNodePort } from '../domain/nodePlacement'
import { PRADERA_LANDMARKS, PRADERA_SEED, PRADERA_SPAWN } from './praderaLandmarks'

describe('Pradera Brisa landmarks', () => {
  const world = new World(PRADERA_SEED)

  it('uses the real Pradera seed and spawn', () => {
    const pradera = WORLDS.find(definition => definition.id === 'pradera')!
    expect(pradera.seed).toBe(PRADERA_SEED)
    expect(world.findSpawn(pradera.prefer)).toEqual(PRADERA_SPAWN)
  })

  it('covers every node type with a position the world really derives', () => {
    expect(new Set(PRADERA_LANDMARKS.map(landmark => landmark.definitionId))).toEqual(new Set(GATHERING_NODES.map(node => node.id)))
    const port = worldNodePort(world)
    for (const landmark of PRADERA_LANDMARKS) {
      expect(nodeAt(port, landmark.tx, landmark.ty)?.definitionId, landmark.definitionId).toBe(landmark.definitionId)
    }
  })
})
