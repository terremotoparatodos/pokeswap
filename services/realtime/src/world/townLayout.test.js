import test from 'node:test'
import assert from 'node:assert/strict'
import { ARRIVALS, TOWN_FROM_PRADERA } from '../protocol/arrival.js'
import {
  TOWN_BUILDINGS, TOWN_GATES, TOWN_HEIGHT, TOWN_PROPS, TOWN_SPAWN, TOWN_TERRAIN, TOWN_WIDTH,
  isTownDoor, isTownWalkable, townCollision, townGateAt,
} from './townLayout.js'

// CAVES-4: the guards of Ciudad Corazón's navigation facts. The browser's
// parity test (`townNavigation.test.ts`) proves its TownArea collides exactly
// like `isTownWalkable`; these prove the facts themselves are sane.

const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const k = (tx, ty) => `${tx},${ty}`

function reachFromSpawn() {
  const seen = new Set([k(TOWN_SPAWN.tx, TOWN_SPAWN.ty)])
  const queue = [TOWN_SPAWN]
  while (queue.length) {
    const at = queue.shift()
    for (const [dx, dy] of SIDES) {
      const tx = at.tx + dx, ty = at.ty + dy
      if (!isTownWalkable(tx, ty) || seen.has(k(tx, ty))) continue
      seen.add(k(tx, ty)); queue.push({ tx, ty })
    }
  }
  return seen
}

test('the terrain is a 64×51 grid of s, g, p and t, and frozen', () => {
  assert.equal(TOWN_WIDTH, 64)
  assert.equal(TOWN_HEIGHT, 51)
  for (const row of TOWN_TERRAIN) assert.match(row, /^[sgpt]{64}$/)
  assert.ok(Object.isFrozen(TOWN_TERRAIN) && Object.isFrozen(TOWN_BUILDINGS) && Object.isFrozen(TOWN_GATES) && Object.isFrozen(TOWN_PROPS))
})

test('outside the map, non-integers and forest are never walkable', () => {
  for (const [tx, ty] of [[-1, 20], [64, 20], [31, -1], [31, 51], [31.5, 20], [Number.NaN, 20], [Infinity, 0], [31, null]]) {
    assert.equal(isTownWalkable(tx, ty), false, `${tx},${ty}`)
  }
  for (let ty = 0; ty < TOWN_HEIGHT; ty++) {
    for (let tx = 0; tx < TOWN_WIDTH; tx++) if (TOWN_TERRAIN[ty][tx] === 't' && !townGateAt(tx, ty)) assert.equal(isTownWalkable(tx, ty), false, k(tx, ty))
  }
})

test('the spawn, every gate, gate arrival and door are walkable and reachable from the spawn', () => {
  const reach = reachFromSpawn()
  assert.ok(reach.has(k(TOWN_SPAWN.tx, TOWN_SPAWN.ty)))
  for (const gate of TOWN_GATES) {
    for (const t of gate.tiles) assert.ok(reach.has(k(t.tx, t.ty)), `${gate.to} gate ${k(t.tx, t.ty)}`)
    assert.ok(reach.has(k(gate.arrival.tx, gate.arrival.ty)), `${gate.to} arrival`)
    // Arriving never lands on a gate: no immediate loop back out.
    assert.equal(townGateAt(gate.arrival.tx, gate.arrival.ty), null, `${gate.to} arrival on a gate`)
  }
  for (const b of TOWN_BUILDINGS) if (b.door) {
    assert.ok(isTownDoor(b.door.tx, b.door.ty))
    assert.ok(reach.has(k(b.door.tx, b.door.ty)), `${b.id} door`)
  }
  assert.equal(townGateAt(TOWN_SPAWN.tx, TOWN_SPAWN.ty), null)
  assert.equal(isTownDoor(TOWN_SPAWN.tx, TOWN_SPAWN.ty), false)
})

test('building footprints are solid except their open tiles and doors, and their ids are unique', () => {
  assert.equal(new Set(TOWN_BUILDINGS.map(b => b.id)).size, TOWN_BUILDINGS.length)
  for (const b of TOWN_BUILDINGS) {
    const through = new Set([...(b.open ?? []), ...(b.door ? [b.door] : [])].map(t => k(t.tx, t.ty)))
    for (let ty = b.y; ty < b.y + b.d; ty++) {
      for (let tx = b.x; tx < b.x + b.w; tx++) {
        if (townGateAt(tx, ty)) continue
        assert.equal(isTownWalkable(tx, ty), through.has(k(tx, ty)), `${b.id} ${k(tx, ty)}`)
      }
    }
  }
})

test('solid props block every tile they cover, benches two of them', () => {
  for (const p of TOWN_PROPS) {
    assert.equal(isTownWalkable(p.tx, p.ty), false, `${p.kind} ${k(p.tx, p.ty)}`)
    if (p.kind === 'bench' || p.kind === 'benchLeft') assert.equal(isTownWalkable(p.tx, p.ty + 1), false)
  }
  assert.equal(TOWN_PROPS.filter(p => p.board).length, 1)
  assert.ok(TOWN_PROPS.filter(p => p.kind === 'sign').every(p => typeof p.key === 'string'))
})

test('the arrival contract reads the town from here', () => {
  assert.deepEqual(ARRIVALS['ciudad-corazon'], TOWN_SPAWN)
  assert.deepEqual(TOWN_FROM_PRADERA, TOWN_GATES.find(g => g.to === 'pradera').arrival)
  assert.deepEqual(TOWN_FROM_PRADERA, { tx: 8, ty: 41, dir: 'right' })
})

test('townCollision is the same rule for any town definition: a gate tile always opens', () => {
  const solid = townCollision({ terrain: ['ttt', 'tst', 'ttt'], buildings: [], fountains: [], props: [], gates: [{ tiles: [{ tx: 0, ty: 1 }] }] })
  assert.deepEqual([...solid], [1, 1, 1, 0, 0, 1, 1, 1, 1])
})
