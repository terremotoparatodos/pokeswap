import test from 'node:test'
import assert from 'node:assert/strict'
import { DETECTS, judgeRun, outcomeOf } from './judge.mjs'
import { MUTANTS, ORDERING_MIGRATION, migrationFor, migrationText } from './localDatabase.mjs'
import { SCENARIOS } from './scenarios.mjs'

// WORLD LOCATION-4 F2 — the battery's verdict, without a database.

const ALL = Object.keys(SCENARIOS)
const run = (rounds, outcomeFor) => {
  const results = []
  for (let round = 1; round <= rounds; round++) for (const scenario of ALL) results.push({ round, scenario, outcome: outcomeFor(scenario, round) })
  return results
}

test('only an assertion failure is a violation; any other error is a harness_error', () => {
  assert.equal(outcomeOf(null, assert.AssertionError), 'pass')
  assert.equal(outcomeOf(new assert.AssertionError({ message: 'x' }), assert.AssertionError), 'violation')
  for (const e of [new Error('timeout'), new TypeError('x'), new RangeError('deadlock detected')])
    assert.equal(outcomeOf(e, assert.AssertionError), 'harness_error')
})

test('original: PASS only when every round of every scenario passes', () => {
  assert.equal(judgeRun('original', run(10, () => 'pass'), ALL).verdict, 'PASS')
  const one = judgeRun('original', run(10, (s, r) => (s === 'A5' && r === 7 ? 'violation' : 'pass')), ALL)
  assert.equal(one.verdict, 'FAIL'); assert.match(one.reasons.join(), /A5: 1 violation/)
})

test('a mutant is caught only by its detecting scenarios, in every round', () => {
  for (const build of ['rv1', 'rv2']) {
    const caught = run(10, s => (DETECTS[build].includes(s) ? 'violation' : 'pass'))
    assert.equal(judgeRun(build, caught, ALL).verdict, 'PASS', build)
    const survivedOnce = run(10, (s, r) => (DETECTS[build].includes(s) && !(s === DETECTS[build][0] && r === 3) ? 'violation' : 'pass'))
    assert.equal(judgeRun(build, survivedOnce, ALL).verdict, 'FAIL', `${build}: survived a round`)
    const elsewhere = run(10, s => (DETECTS[build].includes(s) || s === 'A3' ? 'violation' : 'pass'))
    assert.equal(judgeRun(build, elsewhere, ALL).verdict, 'FAIL', `${build}: a control detected it`)
  }
  assert.deepEqual(DETECTS, { original: [], rv1: ['A1', 'A2', 'A4'], rv2: ['A5', 'A6'] })
})

test('a harness_error blocks the run, even when the mutant would otherwise be caught', () => {
  const results = run(10, (s, r) => (s === 'A1' && r === 2 ? 'harness_error' : DETECTS.rv1.includes(s) ? 'violation' : 'pass'))
  const judged = judgeRun('rv1', results, ALL)
  assert.equal(judged.verdict, 'BLOCKED'); assert.match(judged.reasons.join(), /never a detection/)
  assert.equal(judgeRun('original', run(1, s => (s === 'A4b' ? 'harness_error' : 'pass')), ALL).verdict, 'BLOCKED')
})

test('nothing ran, or a selected scenario did not run: BLOCKED, never PASS', () => {
  assert.equal(judgeRun('original', [], ALL).verdict, 'BLOCKED')
  assert.equal(judgeRun('original', [{ scenario: 'A1', outcome: 'pass' }], ['A1', 'A2']).verdict, 'BLOCKED')
})

test('a mutant run without its detecting scenarios fails', () => {
  const judged = judgeRun('rv2', [{ scenario: 'A1', outcome: 'pass' }], ['A1'])
  assert.equal(judged.verdict, 'FAIL'); assert.match(judged.reasons.join(), /A5: a detecting scenario was not selected/)
})

test('each mutant is one exact replacement of the ordering migration, in memory only', () => {
  const original = migrationText(ORDERING_MIGRATION)
  assert.ok(!original.includes('\r'), 'LF text whatever the checkout')
  for (const [name, m] of Object.entries(MUTANTS)) {
    const mutated = migrationFor(ORDERING_MIGRATION, name)
    assert.equal(original.split(m.from).length - 1, 1, `${name} matches once`)
    assert.ok(!mutated.includes(m.from), `${name} removed its protection`)
    assert.equal(mutated.length, original.length - m.from.length + m.to.length, `${name} changes nothing else`)
  }
  assert.equal(migrationText(ORDERING_MIGRATION), original, 'the file is untouched')
  assert.equal(migrationFor(ORDERING_MIGRATION, 'original'), original)
})
