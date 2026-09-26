import test from 'node:test'
import assert from 'node:assert/strict'
import { PLOTS } from './plots.js'
import { hiddenBehindCanopy, standableTile, workerStand } from './workerStand.js'
import { praderaNodesNearSpawn } from './testing.js'

const NODE = { tx: 10, ty: 10 }
const open = () => true
const only = (...tiles) => (tx, ty) => tiles.some(([x, y]) => x === tx && y === ty)
const TRAINER = { south: { tx: 10, ty: 11 }, north: { tx: 10, ty: 9 }, east: { tx: 11, ty: 10 }, west: { tx: 9, ty: 10 } }
const adjacent = (spot, node) => Math.max(Math.abs(spot.tx - node.tx), Math.abs(spot.ty - node.ty)) === 1
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }

test('the same facts always give the same stand', () => {
  for (const trainer of Object.values(TRAINER)) {
    const blocked = (tx, ty) => (tx + ty) % 3 !== 0
    assert.deepEqual(workerStand(NODE, trainer, blocked), workerStand(NODE, trainer, blocked))
    assert.deepEqual(workerStand(NODE, trainer, open), workerStand({ ...NODE }, { ...trainer }, open))
  }
})

test('open ground: a cardinal neighbour flanking the trainer, never the trainer tile, facing the node', () => {
  // Trainer south → east/west flank it; east wins the fixed tie-break.
  assert.deepEqual(workerStand(NODE, TRAINER.south, open), { tx: 11, ty: 10, dir: 'left' })
  assert.deepEqual(workerStand(NODE, TRAINER.north, open), { tx: 11, ty: 10, dir: 'left' })
  // Trainer east/west → south flanks it and comes first.
  assert.deepEqual(workerStand(NODE, TRAINER.east, open), { tx: 10, ty: 11, dir: 'up' })
  assert.deepEqual(workerStand(NODE, TRAINER.west, open), { tx: 10, ty: 11, dir: 'up' })
  for (const trainer of Object.values(TRAINER)) {
    const stand = workerStand(NODE, trainer, open)
    assert.equal(Math.abs(stand.tx - NODE.tx) + Math.abs(stand.ty - NODE.ty), 1, 'cardinal neighbour')
    assert.notDeepEqual([stand.tx, stand.ty], [trainer.tx, trainer.ty])
    const [dx, dy] = DIRS[stand.dir]
    assert.deepEqual([stand.tx + dx, stand.ty + dy], [NODE.tx, NODE.ty], 'faces the node')
  }
})

test('blocked sides: flank, other flank, opposite side, then diagonals, then the trainer tile', () => {
  const t = TRAINER.south
  assert.deepEqual(workerStand(NODE, t, only([9, 10], [10, 9])), { tx: 9, ty: 10, dir: 'right' }, 'east blocked → west')
  assert.deepEqual(workerStand(NODE, t, only([10, 9])), { tx: 10, ty: 9, dir: 'down' }, 'both flanks blocked → opposite side')
  // Only diagonals: the ones on the trainer's side first, east before west.
  assert.deepEqual(workerStand(NODE, t, only([11, 11], [9, 11], [11, 9])), { tx: 11, ty: 11, dir: 'left' })
  assert.deepEqual(workerStand(NODE, t, only([9, 11], [11, 9])), { tx: 9, ty: 11, dir: 'right' })
  assert.deepEqual(workerStand(NODE, t, only([9, 9])), { tx: 9, ty: 9, dir: 'right' }, 'far diagonal as a last resort')
  // Nothing open at all: the trainer's own tile, facing the node.
  assert.deepEqual(workerStand(NODE, t, () => false), { tx: 10, ty: 11, dir: 'up' })
  assert.deepEqual(workerStand(NODE, TRAINER.west, () => false), { tx: 9, ty: 10, dir: 'right' })
  assert.deepEqual(workerStand(NODE, TRAINER.north, () => false), { tx: 10, ty: 9, dir: 'down' })
})

test('visible before hidden: a tile under a tree canopy only when nothing visible is open', () => {
  // Trainer west; south is hidden (a tree right below it), north is hidden by the node's own canopy.
  const hidden = (tx, ty) => (tx === 10 && ty === 11) || (tx === 10 && ty === 9)
  assert.deepEqual(workerStand(NODE, TRAINER.west, open, hidden), { tx: 11, ty: 10, dir: 'left' }, 'the opposite, visible side wins')
  // Among visible candidates the trainer side still decides.
  assert.deepEqual(workerStand(NODE, TRAINER.west, open, (tx, ty) => tx === 10 && ty === 9), { tx: 10, ty: 11, dir: 'up' })
  // Everything hidden: the plain rule (flank nearest the trainer, fixed order).
  assert.deepEqual(workerStand(NODE, TRAINER.west, open, () => true), workerStand(NODE, TRAINER.west, open))
})

test('canopy check reads the shared terrain: north of a tree node is hidden, a rock hides nothing', () => {
  const hidden = hiddenBehindCanopy('pradera')
  const nodes = praderaNodesNearSpawn(40).map(entry => entry.node)
  const tree = nodes.find(node => node.resourceKind === 'tree')
  const rock = nodes.find(node => node.resourceKind === 'rock')
  assert.equal(hidden(tree.tx, tree.ty - 1), true)
  assert.equal(hidden(rock.tx, rock.ty - 1), false)
  assert.equal(hiddenBehindCanopy('ciudad-corazon')(0, 0), false)
})

test('on real terrain every node with a visible open side gets a visible stand', () => {
  const isOpen = standableTile('pradera')
  const hidden = hiddenBehindCanopy('pradera')
  for (const { node, stands } of praderaNodesNearSpawn(40)) {
    const visibleSide = [[0, 1], [1, 0], [-1, 0], [0, -1]].some(([dx, dy]) => isOpen(node.tx + dx, node.ty + dy) && !hidden(node.tx + dx, node.ty + dy) && !stands.slice(0, 1).some(t => t.tx === node.tx + dx && t.ty === node.ty + dy))
    const stand = workerStand(node, stands[0], isOpen, hidden)
    if (visibleSide) assert.equal(hidden(stand.tx, stand.ty), false, node.id)
  }
})

test('the trainer tile is never picked while anything else is open, even if it is the only open cardinal', () => {
  const stand = workerStand(NODE, TRAINER.south, only([10, 11], [11, 11]))
  assert.deepEqual(stand, { tx: 11, ty: 11, dir: 'left' })
})

test('on real Pradera terrain the stand is dry, walkable, not a node and beside the node', () => {
  const isOpen = standableTile('pradera')
  const hidden = hiddenBehindCanopy('pradera')
  let checked = 0
  for (const { node, stands } of praderaNodesNearSpawn(40)) {
    for (const trainer of stands) {
      const stand = workerStand(node, trainer, isOpen, hidden)
      assert.ok(isOpen(stand.tx, stand.ty), `${node.id}: open`)
      assert.ok(adjacent(stand, node), `${node.id}: adjacent`)
      assert.notDeepEqual([stand.tx, stand.ty], [trainer.tx, trainer.ty])
      checked++
    }
  }
  assert.ok(checked > 20)
})

test('farm plots: never on another plot of the huerta', () => {
  const isOpen = standableTile('pradera')
  const plot = PLOTS[0]
  const stand = workerStand(plot, { tx: plot.tx - 1, ty: plot.ty }, isOpen)
  assert.ok(!PLOTS.some(p => p.tx === stand.tx && p.ty === stand.ty))
  assert.ok(isOpen(stand.tx, stand.ty))
  assert.ok(adjacent(stand, plot))
})

test('an area the world does not model offers no ground (the trainer-tile fallback applies)', () => {
  assert.equal(standableTile('ciudad-corazon')(0, 0), false)
  assert.equal(standableTile('nowhere')(0, 0), false)
})
