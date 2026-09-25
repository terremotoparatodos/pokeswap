import { describe, expect, it } from 'vitest'
import { resourceAt, resourcesInChunk } from '../../../services/realtime/src/world/resourceLayout.js'
import { WORLD_AREAS } from '../../../services/realtime/src/world/areas.js'
import { skillsResourceFor } from './resourceMapping'

// INTEGRATION-1: WORLD's nodes mapped to SKILLS resources. Ported from the
// retired pre-WORLD placement tests (skills/localWorld), now on WORLD's real
// node ids — the ones the server validates.
const spawn = WORLD_AREAS.pradera.spawn!

function nodesAround(chunks = 3) {
  const cx = Math.floor(spawn.tx / 16)
  const cy = Math.floor(spawn.ty / 16)
  const nodes = []
  for (let y = cy - chunks; y <= cy + chunks; y++) for (let x = cx - chunks; x <= cx + chunks; x++) nodes.push(...resourcesInChunk('pradera', x, y))
  return nodes
}

describe('WORLD node → SKILLS resource', () => {
  it('is the same answer for the same node, every time (client and server share it)', () => {
    for (const node of nodesAround(1)) expect(skillsResourceFor(node)).toBe(skillsResourceFor(resourceAt('pradera', node.tx, node.ty)!))
  })

  it('only maps a node to a resource that accepts its prop, biome and ring', () => {
    let mapped = 0
    for (const node of nodesAround()) {
      const resource = skillsResourceFor(node)
      if (!resource) continue
      mapped++
      expect(resource.world.anchors).toContain(node.variantId)
      expect(resource.world.habitats as readonly string[]).toContain(node.biome)
      expect(resource.world.minRing).toBeLessThanOrEqual(Math.min(2, node.zone))
    }
    expect(mapped).toBeGreaterThan(20)
  })

  it('around the Pradera entrance, every workable grassland node is level 1: nobody arrives to a wall', () => {
    for (const node of nodesAround()) {
      const resource = skillsResourceFor(node)
      if (!resource || node.zone > 0 || node.biome !== 'grassland') continue
      expect(resource.requiredLevel, resource.id).toBe(1)
    }
  })

  it('never maps to a removed skill (fishing) or outside the procedural world', () => {
    for (const node of nodesAround()) expect(['woodcutting', 'mining', undefined]).toContain(skillsResourceFor(node)?.skill)
    expect(skillsResourceFor({ areaId: 'ciudad-corazon', tx: 31, ty: 20, variantId: 'tree', biome: 'grassland', zone: 0 })).toBeNull()
  })
})
