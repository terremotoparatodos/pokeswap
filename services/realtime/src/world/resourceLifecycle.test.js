import test from 'node:test'
import assert from 'node:assert/strict'
import { DueQueue } from './dueQueue.js'
import { SIMPLE_LIFECYCLE, afterTimer, afterWork, canStartWork, lifecycleFor } from './resourceLifecycle.js'

test('trees and rocks: available → (work) → depleted → (timer) → available', () => {
  for (const kind of ['tree', 'rock']) assert.equal(lifecycleFor(kind), SIMPLE_LIFECYCLE)
  assert.equal(canStartWork(SIMPLE_LIFECYCLE, 'available'), true)
  assert.equal(canStartWork(SIMPLE_LIFECYCLE, 'depleted'), false)
  assert.equal(canStartWork(SIMPLE_LIFECYCLE, 'working'), false)
  assert.equal(afterWork(SIMPLE_LIFECYCLE, 'available'), 'depleted')
  assert.equal(afterTimer(SIMPLE_LIFECYCLE, 'depleted'), 'available')
  assert.equal(afterTimer(SIMPLE_LIFECYCLE, 'available'), null)
  assert.equal(lifecycleFor('constructor'), null)
})

test('a farming plot fits the same model without a new state machine', () => {
  // Not placed in any world: this only proves the shape does not need rebuilding.
  const plot = { initial: 'empty', work: { empty: 'planted', ready: 'empty' }, timed: { planted: 'growing', growing: 'ready' } }
  let state = plot.initial
  assert.equal(canStartWork(plot, state), true)
  state = afterWork(plot, state)
  assert.equal(state, 'planted')
  assert.equal(canStartWork(plot, state), false)
  state = afterTimer(plot, afterTimer(plot, state))
  assert.equal(state, 'ready')
  assert.equal(afterWork(plot, state), 'empty')
})

test('the due queue drains in time order and only what is due', () => {
  const queue = new DueQueue()
  for (const at of [50, 10, 40, 20, 30, 10]) queue.push(at, at)
  assert.deepEqual(queue.drain(25), [10, 10, 20])
  assert.deepEqual(queue.drain(25), [])
  assert.deepEqual(queue.drain(100), [30, 40, 50])
  assert.equal(queue.size, 0)
})
