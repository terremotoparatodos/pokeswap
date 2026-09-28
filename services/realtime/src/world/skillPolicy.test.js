import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_ACTION_MS, readAuthorization, tickAligned } from './skillPolicy.js'
import { WORK_TICK_MS } from './worldProtocol.js'

// SKILLS PROB-2: an authorized duration is a whole number of work ticks.

test('the work tick is 600 ms, defined once in the wire contract', () => {
  assert.equal(WORK_TICK_MS, 600)
})

test('a duration becomes whole ticks, rounded up: the action never ends before SKILLS accepts it', () => {
  assert.equal(tickAligned(600), 600)
  assert.equal(tickAligned(1_800), 1_800)
  assert.equal(tickAligned(601), 1_200)
  assert.equal(tickAligned(1), 600, 'at least one tick')
  assert.equal(tickAligned(0), 600)
  assert.equal(tickAligned(-5), 600)
  assert.equal(tickAligned(10 * 60_000), MAX_ACTION_MS, 'never longer than MAX_ACTION_MS')
  assert.equal(MAX_ACTION_MS % WORK_TICK_MS, 0)
})

test('readAuthorization keeps SKILLS’ draw, tick-aligned, and refuses a malformed one', () => {
  assert.deepEqual(readAuthorization({ ok: true, durationMs: 3 * WORK_TICK_MS }), { ok: true, durationMs: 1_800 })
  assert.equal(readAuthorization({ ok: true, durationMs: 10 }).durationMs, 600)
  assert.equal(readAuthorization({ ok: true, durationMs: Number.NaN }).reason, 'skills-invalid')
  assert.equal(readAuthorization({ ok: true }).reason, 'skills-invalid')
})
