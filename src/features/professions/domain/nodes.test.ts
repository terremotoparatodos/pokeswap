import { describe, expect, it } from 'vitest'
import { World } from '../../wildlands/engine/world'
import { NODE_BY_ID } from './catalog/nodes'
import { chargeKey, consumeCharge, pruneLedger, remainingCharges, type ChargeLedger } from './nodeDepletion'
import { anchorAt, detectionRadius, nodeAt, nodesInChunk, worldNodePort, zoneAt } from './nodePlacement'

const SEEDS = [1234, 98_765]

describe('deterministic node placement', () => {
  it('derives identical nodes from the seed with no stored state', () => {
    for (const seed of SEEDS) {
      const first = nodesInChunk(worldNodePort(new World(seed)), 0, 0)
      const second = nodesInChunk(worldNodePort(new World(seed)), 0, 0)
      expect(second).toEqual(first)
    }
  })

  it('only places nodes whose definition accepts the anchor, biome and zone', () => {
    let total = 0
    for (const seed of SEEDS) {
      const world = worldNodePort(new World(seed))
      for (let cy = -2; cy <= 2; cy++) {
        for (let cx = -2; cx <= 2; cx++) {
          for (const placement of nodesInChunk(world, cx, cy)) {
            const definition = NODE_BY_ID.get(placement.definitionId)!
            expect(definition.anchors).toContain(anchorAt(world, placement.tx, placement.ty))
            expect(definition.biomes).toContain(placement.biome)
            expect(definition.minZone).toBeLessThanOrEqual(placement.zone)
            expect(nodeAt(world, placement.tx, placement.ty)).toEqual(placement)
            total++
          }
        }
      }
    }
    // Sparse enough to never need per-node synchronisation, dense enough to play.
    expect(total).toBeGreaterThan(20)
    expect(total).toBeLessThan(2 * 25 * 32 * 32 * 0.05)
  })

  it('assigns distance zones and detection radii', () => {
    expect(zoneAt(0, 0)).toBe(0)
    expect(zoneAt(96, 0)).toBe(1)
    expect(zoneAt(5_000, 5_000)).toBe(3)
    expect(detectionRadius(0)).toBe(8)
    expect(detectionRadius(0.5)).toBe(12)
    expect(detectionRadius(5)).toBe(16)
  })
})

describe('personal node charges', () => {
  const stone = NODE_BY_ID.get('stone_outcrop')!
  const T0 = 1_000_000

  it('depletes a node per player without denying it to others', () => {
    let ledger: ChargeLedger = new Map()
    for (let i = 0; i < stone.personalCharges; i++) {
      const next = consumeCharge(ledger, 'n1', 'alice', stone, T0 + i)
      expect(next?.remaining).toBe(stone.personalCharges - i - 1)
      ledger = next!.ledger
    }
    expect(consumeCharge(ledger, 'n1', 'alice', stone, T0 + 10)).toBeNull()
    expect(remainingCharges(ledger, 'n1', 'bob', stone, T0 + 10)).toBe(stone.personalCharges)
    expect(consumeCharge(ledger, 'n1', 'bob', stone, T0 + 10)).not.toBeNull()
  })

  it('restores charges after respawn and prunes expired windows', () => {
    const consumed = consumeCharge(new Map(), 'n1', 'alice', stone, T0)!.ledger
    const later = T0 + stone.respawnSeconds * 1000
    expect(remainingCharges(consumed, 'n1', 'alice', stone, later)).toBe(stone.personalCharges)
    expect(pruneLedger(consumed, later, stone.respawnSeconds).has(chargeKey('n1', 'alice'))).toBe(false)
    expect(pruneLedger(consumed, later - 1, stone.respawnSeconds).size).toBe(1)
  })
})
