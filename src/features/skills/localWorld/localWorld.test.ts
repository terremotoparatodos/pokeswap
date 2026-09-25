import { describe, expect, it } from 'vitest'
import { World } from '../../wildlands/engine/world'
import { RESOURCE_BY_ID } from '../domain/resources'
import { capacityOf, consumeCharge, remainingCharges, respawnInSeconds, type ChargeLedger } from './nodeCharges'
import { nodeAt, nodesInChunk, ringAt, worldNodePort } from './nodePlacement'

const SEEDS = [1234, 98_765]

describe('pre-WORLD node placement', () => {
  it('derives identical nodes from the seed with no stored state', () => {
    for (const seed of SEEDS) {
      expect(nodesInChunk(worldNodePort(new World(seed)), 0, 0)).toEqual(nodesInChunk(worldNodePort(new World(seed)), 0, 0))
    }
  })

  it('only places resources whose hints accept the anchor, habitat and ring', () => {
    let total = 0
    for (const seed of SEEDS) {
      const world = worldNodePort(new World(seed))
      for (let cy = -2; cy <= 2; cy++) {
        for (let cx = -2; cx <= 2; cx++) {
          for (const placement of nodesInChunk(world, cx, cy)) {
            const resource = RESOURCE_BY_ID.get(placement.resourceId)!
            expect(resource.world.anchors).toContain(world.decorAt(placement.tx, placement.ty))
            expect(resource.world.habitats).toContain(placement.biome)
            expect(resource.world.minRing).toBeLessThanOrEqual(placement.ring)
            expect(nodeAt(world, placement.tx, placement.ty)).toEqual(placement)
            total++
          }
        }
      }
    }
    expect(total).toBeGreaterThan(20)
  })

  it('shows only level-1 resources in the ring around the entrance', () => {
    for (const seed of SEEDS) {
      const world = worldNodePort(new World(seed))
      for (let cy = -2; cy <= 1; cy++) {
        for (let cx = -2; cx <= 1; cx++) {
          for (const placement of nodesInChunk(world, cx, cy)) {
            if (placement.ring > 0 || placement.biome !== 'grassland') continue
            expect(RESOURCE_BY_ID.get(placement.resourceId)!.requiredLevel, placement.resourceId).toBe(1)
          }
        }
      }
    }
  })

  it('measures rings from the entrance', () => {
    expect(ringAt(0, 0)).toBe(0)
    expect(ringAt(96, 0)).toBe(1)
    expect(ringAt(5_000, 5_000)).toBe(2)
  })
})

describe('pre-WORLD node charges', () => {
  const stone = RESOURCE_BY_ID.get('stone_outcrop')!
  const T0 = 1_000_000

  it('empties after its capacity and comes back after the respawn time', () => {
    const capacity = capacityOf('n1', stone)
    expect(capacity).toBeGreaterThanOrEqual(stone.world.charges[0])
    expect(capacity).toBeLessThanOrEqual(stone.world.charges[1])
    let ledger: ChargeLedger = new Map()
    for (let i = 0; i < capacity; i++) ledger = consumeCharge(ledger, 'n1', stone, T0)!
    expect(remainingCharges(ledger, 'n1', stone, T0)).toBe(0)
    expect(consumeCharge(ledger, 'n1', stone, T0)).toBeNull()
    expect(respawnInSeconds(ledger, 'n1', stone, T0)).toBe(stone.world.respawnSeconds)
    const later = T0 + stone.world.respawnSeconds * 1000
    expect(remainingCharges(ledger, 'n1', stone, later)).toBe(capacity)
    expect(consumeCharge(ledger, 'n1', stone, later)).not.toBeNull()
  })
})
