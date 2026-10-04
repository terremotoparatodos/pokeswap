import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { failuresIn, judge, tally, withMutation } from './mutationJudge.mjs'

// Reviews N2/N3: the mutation judge on REAL runner outputs (fixtures/judge/*.txt were captured
// from node:test and Vitest runs of tiny tests, local paths removed).

const fixture = name => readFileSync(new URL(`./fixtures/judge/${name}.txt`, import.meta.url), 'utf8')
const ran = (name, extra = {}) => ({ status: 1, signal: null, error: undefined, stdout: fixture(name), stderr: '', ...extra })

test('1. a real assertion failure of the expected test is caught (node:test and Vitest)', () => {
  assert.equal(judge({ expect: 'the real assertion' }, ran('fail')).verdict, 'caught')
  assert.equal(judge({ expect: 'a real vitest failure' }, ran('vfail')).verdict, 'caught')
  assert.equal(judge({ expect: 'another test' }, ran('fail')).verdict, 'missed', 'not the expected test')
  assert.equal(judge({ expect: 'the real assertion', cause: /expected cause/ }, ran('fail')).verdict, 'missed', 'not the expected cause')
})

test('2. the runner deadline (spawnSync timeout) is a timeout, never a catch', () => {
  const run = ran('fail', { status: null, signal: 'SIGTERM', error: Object.assign(new Error('spawnSync node ETIMEDOUT'), { code: 'ETIMEDOUT' }) })
  assert.equal(judge({ expect: 'the real assertion' }, run).verdict, 'timedOut')
})

test('3. node:test "test timed out after N ms" is a timeout, even next to a named failure', () => {
  const verdict = judge({ expect: 'hangs with the loop busy' }, ran('busytimeout'))
  assert.equal(verdict.verdict, 'timedOut')
  assert.equal(verdict.caught, false)
})

test('4. Vitest "Test timed out in N ms" is a timeout, not a catch', () => {
  assert.equal(judge({ expect: 'hangs past the vitest timeout' }, ran('vtimeout')).verdict, 'timedOut')
})

test('5. Vitest "Hook timed out in N ms" is a timeout, not a catch', () => {
  assert.equal(judge({}, ran('vhook')).verdict, 'timedOut')
})

test('6. node:test with cancelled > 0 is cancelled, not a catch', () => {
  assert.equal(judge({ expect: 'parent' }, ran('cancelled')).verdict, 'cancelled')
})

test('7. a promise left pending ("Promise resolution is still pending") is cancelled, not a catch', () => {
  assert.equal(judge({ expect: 'pending forever' }, ran('pending')).verdict, 'cancelled')
  assert.equal(judge({ expect: 'hangs past its timeout' }, ran('nodetimeout')).verdict, 'cancelled', "a node timeout on an idle loop reports the pending promise")
})

test('8. an infrastructure error (a module that cannot load) is an error, not a catch', () => {
  assert.equal(judge({}, ran('loaderr')).verdict, 'error')
  assert.equal(judge({}, { status: null, signal: null, error: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }), stdout: '', stderr: '' }).verdict, 'error')
  assert.equal(judge({}, { status: 1, signal: null, stdout: 'same-process: ERROR (TypeError)\n', stderr: '' }).verdict, 'error', 'a crashed harness scenario')
  // node:test given a test file that does not exist: "Could not find '…'", exit 1 (Node 22 and 24).
  const notFound = judge({ expect: 'anything' }, ran('notfound'))
  assert.equal(notFound.verdict, 'error')
  assert.equal(notFound.caught, false)
})

test('9. exit 1 without an identifiable test failure is not a catch (file-level failure, nothing named)', () => {
  assert.equal(judge({}, { status: 1, signal: null, stdout: 'something went wrong\n', stderr: '' }).verdict, 'missed')
  assert.equal(judge({}, { status: 1, signal: null, stdout: '✖ src\\rooms\\PresenceRoomClose.test.js (200015.6757ms)\n', stderr: '' }).verdict, 'missed', 'a file is not a test')
  assert.equal(judge({ expect: 'x' }, { status: 0, signal: null, stdout: '', stderr: '' }).verdict, 'missed', 'the tests passed')
})

test('harness and supervisor failures are identifiable by name', () => {
  assert.deepEqual(failuresIn('candidates: PASS\ndrain: FAIL\n'), ['drain'])
  assert.deepEqual(failuresIn('{\n  "name": "no restart",\n  "ok": false\n}'), ['no restart'])
  assert.equal(judge({ expect: ['drain', 'shutdown'] }, { status: 1, signal: null, stdout: 'drain: FAIL\n', stderr: '' }).verdict, 'caught')
})

test('10. the mutated file is restored byte for byte in every case (verdict, throw, crash)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'judge-'))
  const file = join(dir, 'target.js')
  const original = Buffer.from('const a = 1\r\nconst b = 2\r\n')
  writeFileSync(file, original)
  const mutation = { from: 'const b = 2', to: 'const b = 3' }
  for (const name of ['fail', 'busytimeout', 'vtimeout', 'vhook', 'cancelled', 'pending', 'loaderr', 'notfound']) {
    const verdict = withMutation(file, mutation, () => {
      assert.match(readFileSync(file, 'utf8'), /const b = 3/, 'mutated while the test runs')
      return judge({}, ran(name))
    })
    assert.ok(verdict.verdict)
    assert.deepEqual(readFileSync(file), original, `restored after ${name}`)
  }
  assert.throws(() => withMutation(file, mutation, () => { throw new Error('the run crashed') }), /the run crashed/)
  assert.deepEqual(readFileSync(file), original, 'restored after a throw')
  assert.deepEqual(withMutation(file, { from: 'absent', to: 'x' }, () => 'ran'), { pattern: 0, anchors: 1 }, 'a pattern not found changes nothing')
  assert.deepEqual(readFileSync(file), original)
})

test('11. a test NAMED after a timeout, a cancellation or a pending promise is judged by its result, not its name', () => {
  // The judge's own tests are named after those messages: a run of them must stay judgeable.
  const names = [
    '✔ a promise left pending ("Promise resolution is still pending") is cancelled (0.1ms)',
    '✔ node:test "test timed out after 300 ms" is a timeout (0.1ms)',
    '✔ Vitest "Test timed out in 300ms" / "Hook timed out in 300ms" (0.1ms)',
    '✔ "Could not find \'x.test.js\'" is infrastructure (0.1ms)',
    ' ✓ named "ℹ cancelled 1" 1ms',
  ].join('\n')
  const failing = `${names}\n✖ the real assertion (0.2ms)\n  AssertionError [ERR_ASSERTION]: expected cause\nℹ cancelled 0\n`
  assert.equal(judge({ expect: 'the real assertion' }, { status: 1, signal: null, stdout: failing, stderr: '' }).verdict, 'caught')
  assert.equal(judge({}, { status: 0, signal: null, stdout: `${names}\nℹ cancelled 0\n`, stderr: '' }).verdict, 'missed', 'all passed: missed, not cancelled or timed out')
  // The real markers, outside the name lines, still decide.
  assert.equal(judge({ expect: 'pending forever' }, ran('pending')).verdict, 'cancelled')
  assert.equal(judge({ expect: 'hangs past the vitest timeout' }, ran('vtimeout')).verdict, 'timedOut')
})

test('tally reports every category by id', () => {
  const summary = tally([{ id: 'A', verdict: 'caught' }, { id: 'B', verdict: 'timedOut' }, { id: 'C', verdict: 'cancelled' }, { id: 'D', verdict: 'error' }, { id: 'E', verdict: 'missed' }])
  assert.deepEqual(summary, { total: 5, caught: 1, missed: ['E'], timedOut: ['B'], cancelled: ['C'], error: ['D'], pattern: [] })
})
