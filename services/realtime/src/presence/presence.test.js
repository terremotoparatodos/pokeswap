import test from 'node:test'
import assert from 'node:assert/strict'
import { hasCapacity, CONNECTION_LIMIT } from './capacity.js'
import { acceptMove, MOVE_MIN_INTERVAL_MS, RUN_INTERVAL_MS } from './movement.js'
import { isVisible, sectorFor } from './interest.js'

test('capacity includes spectators and stops at 100 connections', () => {
  assert.equal(hasCapacity(CONNECTION_LIMIT - 1), true)
  assert.equal(hasCapacity(CONNECTION_LIMIT), false)
})

test('movement derives facing and visual pace while rejecting malformed direction, speed and spam', () => {
  const actor = { tx: 0, ty: 0, lastMoveAt: 0, moves: [] }
  assert.equal(acceptMove(actor, 'north', 1000, false), null)
  assert.equal(acceptMove(actor, 'right', 1000, 'fast'), null)
  assert.equal(acceptMove(actor, 'right', 1000, true), actor)
  assert.equal(actor.dir, 'right')
  assert.equal(actor.speed, 7.5)
  assert.equal(acceptMove(actor, 'right', 1000 + MOVE_MIN_INTERVAL_MS - 1, true), null)
  for (let i = 1; i <= 7; i++) assert.ok(acceptMove(actor, 'right', 1000 + i * 125, true))
  assert.ok(acceptMove(actor, 'right', 2000, true))
  const spam = { tx: 0, ty: 0, lastMoveAt: 0, moves: [] }
  for (let i = 0; i < 10; i++) assert.ok(acceptMove(spam, 'right', 3_000 + i * RUN_INTERVAL_MS, true))
  assert.equal(acceptMove(spam, 'right', 3_000 + 9 * RUN_INTERVAL_MS + 50, true), null)
})

test('movement rejects replayed client sequences', () => {
  const actor = { tx: 0, ty: 0, lastMoveAt: 0, moves: [], moveSequence: 0 }

  assert.equal(acceptMove(actor, 'right', 1_000, true, 1), actor)
  assert.equal(actor.moveSequence, 1)
  assert.equal(acceptMove(actor, 'right', 1_200, true, 1), null)
  assert.equal(actor.moveSequence, 1)
})

test('town is fully visible while wild is bounded to neighbor sectors', () => {
  assert.equal(isVisible({ areaId: 'ciudad-corazon', tx: 0, ty: 0 }, { areaId: 'ciudad-corazon', tx: 900, ty: -900 }), true)
  assert.equal(isVisible({ areaId: 'pradera', tx: 0, ty: 0 }, { areaId: 'pradera', tx: 13, ty: 0 }), true)
  assert.equal(isVisible({ areaId: 'pradera', tx: 0, ty: 0 }, { areaId: 'pradera', tx: 25, ty: 0 }), false)
  assert.deepEqual(sectorFor(-1, -1), { x: -1, y: -1 })
})
