import test from 'node:test'
import assert from 'node:assert/strict'
import { hasCapacity, CONNECTION_LIMIT } from './capacity.js'
import { MOVE_BURST_CAPACITY, MOVE_TOKENS_PER_SECOND, acceptMove, applyMove } from './movement.js'
import { isVisible, sectorFor, TOWN_RADIUS_TILES } from './interest.js'

test('capacity includes spectators and stops at 100 connections', () => {
  assert.equal(hasCapacity(CONNECTION_LIMIT - 1), true)
  assert.equal(hasCapacity(CONNECTION_LIMIT), false)
})

test('movement derives facing and visual pace while rejecting malformed direction, speed and sustained spam', () => {
  const actor = { tx: 0, ty: 0, lastMoveAt: 0, moves: [] }
  assert.equal(acceptMove(actor, 'north', 1000, false), null)
  assert.equal(acceptMove(actor, 'right', 1000, 'fast'), null)
  assert.equal(acceptMove(actor, 'right', 1000, true), actor)
  assert.equal(actor.dir, 'right')
  assert.equal(actor.speed, 7.5)
  // Network jitter may deliver legitimate tile arrivals together. They must
  // not be discarded merely because their receive timestamps are close.
  for (let i = 1; i <= 7; i++) assert.ok(acceptMove(actor, 'right', 1000, true))
  assert.ok(acceptMove(actor, 'right', 2000, true))
  const spam = { tx: 0, ty: 0, lastMoveAt: 0, moves: [] }
  for (let i = 0; i < MOVE_BURST_CAPACITY; i++) assert.ok(acceptMove(spam, 'right', 3_000, true))
  assert.equal(acceptMove(spam, 'right', 3_000, true), null)
  // Sustained: one token per 100 ms, never faster.
  assert.ok(acceptMove(spam, 'right', 3_100, true))
  assert.equal(acceptMove(spam, 'right', 3_150, true), null)
})

test('a network stall at run speed does not reject the legitimate moves queued behind it', () => {
  // 7.5 tiles/s for 20 s; everything sent during a 1.5 s stall arrives at once, in order.
  const actor = { tx: 0, ty: 0, lastMoveAt: 0, moves: [], moveSequence: 0 }
  const period = 1000 / 7.5
  let rejected = 0
  for (let seq = 1; seq * period < 20_000; seq++) {
    const sent = seq * period
    const at = sent >= 8_000 && sent < 9_500 ? 9_560 : sent + 60
    if (applyMove(actor, 'right', Math.round(at), true, seq) !== null) rejected++
  }
  assert.equal(rejected, 0)
  assert.equal(actor.tx, actor.moveSequence)
})

test('a scripted client cannot sustain more than ten tiles per second', () => {
  const actor = { tx: 0, ty: 0, lastMoveAt: 0, moves: [], moveSequence: 0 }
  let seq = 0
  for (let t = 0; t < 10_000; t++) applyMove(actor, 'right', t, true, ++seq)
  assert.ok(actor.tx <= MOVE_BURST_CAPACITY + 10 * MOVE_TOKENS_PER_SECOND, `moved ${actor.tx}`)
})

test('a rate-refused sequenced move is consumed without moving, so its ack reconciles the client', () => {
  const actor = { tx: 0, ty: 0, lastMoveAt: 0, moves: [], moveSequence: 0 }
  for (let seq = 1; seq <= MOVE_BURST_CAPACITY; seq++) assert.equal(applyMove(actor, 'right', 0, true, seq), null)
  assert.equal(applyMove(actor, 'right', 0, true, MOVE_BURST_CAPACITY + 1), 'rate')
  assert.equal(actor.tx, MOVE_BURST_CAPACITY)
  assert.equal(actor.moveSequence, MOVE_BURST_CAPACITY + 1)
  // The consumed sequence cannot be replayed to sneak the step in later.
  assert.equal(applyMove(actor, 'right', 1_000, true, MOVE_BURST_CAPACITY + 1), 'replay')
})

test('rejections carry a reason so replays are not reported as rate limiting', () => {
  const actor = { tx: 0, ty: 0, lastMoveAt: 0, moves: [], moveSequence: 4 }
  assert.equal(applyMove(actor, 'north', 0, true, 5), 'invalid')
  assert.equal(applyMove(actor, 'right', 0, true, 4), 'replay')
  assert.equal(applyMove(actor, 'right', 0, true, 5), null)
})

test('movement rejects replayed client sequences', () => {
  const actor = { tx: 0, ty: 0, lastMoveAt: 0, moves: [], moveSequence: 0 }

  assert.equal(acceptMove(actor, 'right', 1_000, true, 1), actor)
  assert.equal(actor.moveSequence, 1)
  assert.equal(acceptMove(actor, 'right', 1_200, true, 1), null)
  assert.equal(actor.moveSequence, 1)
})

test('town is viewport-bounded while wild is bounded to neighbor sectors', () => {
  assert.equal(isVisible({ areaId: 'ciudad-corazon', tx: 0, ty: 0 }, { areaId: 'ciudad-corazon', tx: TOWN_RADIUS_TILES, ty: 0 }), true)
  assert.equal(isVisible({ areaId: 'ciudad-corazon', tx: 0, ty: 0 }, { areaId: 'ciudad-corazon', tx: TOWN_RADIUS_TILES + 1, ty: 0 }), false)
  assert.equal(isVisible({ areaId: 'pradera', tx: 0, ty: 0 }, { areaId: 'pradera', tx: 13, ty: 0 }), true)
  assert.equal(isVisible({ areaId: 'pradera', tx: 0, ty: 0 }, { areaId: 'pradera', tx: 25, ty: 0 }), false)
  assert.deepEqual(sectorFor(-1, -1), { x: -1, y: -1 })
})
