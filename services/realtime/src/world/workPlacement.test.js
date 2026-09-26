import test from 'node:test'
import assert from 'node:assert/strict'
import { standableTile, workPlacement } from './workPlacement.js'
import { praderaNodesNearSpawn } from './testing.js'

const NODE = { tx: 10, ty: 10 }
const open = () => true
const blocked = (...tiles) => (tx, ty) => !tiles.some(([x, y]) => x === tx && y === ty)
const TRAINER = { south: { tx: 10, ty: 11 }, north: { tx: 10, ty: 9 }, east: { tx: 11, ty: 10 }, west: { tx: 9, ty: 10 } }

test('the Pokémon takes exactly the trainer’s validated tile, facing the node', () => {
  const facing = { south: 'up', north: 'down', east: 'left', west: 'right' }
  for (const [side, trainer] of Object.entries(TRAINER)) {
    assert.deepEqual(workPlacement(NODE, trainer, open).stand, { ...trainer, dir: facing[side] })
  }
})

test('the trainer steps straight back, away from the node, when that tile is free', () => {
  assert.deepEqual(workPlacement(NODE, TRAINER.south, open).wait, { tx: 10, ty: 12, dir: 'up' })
  assert.deepEqual(workPlacement(NODE, TRAINER.north, open).wait, { tx: 10, ty: 8, dir: 'down' })
  assert.deepEqual(workPlacement(NODE, TRAINER.east, open).wait, { tx: 12, ty: 10, dir: 'left' })
  assert.deepEqual(workPlacement(NODE, TRAINER.west, open).wait, { tx: 8, ty: 10, dir: 'right' })
})

test('back blocked: a side of the trainer’s tile, in a fixed order (east before west, south before north)', () => {
  assert.deepEqual(workPlacement(NODE, TRAINER.south, blocked([10, 12])).wait, { tx: 11, ty: 11, dir: 'up' })
  assert.deepEqual(workPlacement(NODE, TRAINER.south, blocked([10, 12], [11, 11])).wait, { tx: 9, ty: 11, dir: 'up' })
  assert.deepEqual(workPlacement(NODE, TRAINER.east, blocked([12, 10])).wait, { tx: 11, ty: 11, dir: 'left' })
  assert.deepEqual(workPlacement(NODE, TRAINER.east, blocked([12, 10], [11, 11])).wait, { tx: 11, ty: 9, dir: 'left' })
})

test('no free tile: no placement (the attempt is refused), and never an overlap', () => {
  assert.equal(workPlacement(NODE, TRAINER.south, blocked([10, 12], [11, 11], [9, 11])), null)
  for (const trainer of Object.values(TRAINER)) {
    const { stand, wait } = workPlacement(NODE, trainer, open)
    const tiles = new Set([`${NODE.tx},${NODE.ty}`, `${stand.tx},${stand.ty}`, `${wait.tx},${wait.ty}`])
    assert.equal(tiles.size, 3)
  }
  // A trainer that is not beside the node never gets a placement.
  assert.equal(workPlacement(NODE, { tx: 12, ty: 10 }, open), null)
})

test('same facts, same placement', () => {
  const isOpen = blocked([10, 12])
  assert.deepEqual(workPlacement(NODE, TRAINER.south, isOpen), workPlacement({ ...NODE }, { ...TRAINER.south }, isOpen))
})

test('on real Pradera terrain the waiting tile is dry, walkable and not a node', () => {
  const isOpen = standableTile('pradera')
  let placed = 0
  for (const { node, stands } of praderaNodesNearSpawn(40)) {
    for (const trainer of stands) {
      const placement = workPlacement(node, trainer, isOpen)
      if (!placement) continue
      assert.ok(isOpen(placement.wait.tx, placement.wait.ty), node.id)
      placed++
    }
  }
  assert.ok(placed > 20)
  assert.equal(standableTile('ciudad-corazon')(0, 0), false)
})
