// WORLD LOCATION — the verdict on one mutant's test run, and the mutation itself (applied and
// always restored). Shared by scripts/world-location/mutations.mjs (WLOC-2) and
// scripts/world-location/ordering-mutations.mjs (WORLD LOCATION-4); unit tests:
// mutationJudge.test.mjs.
//
// A mutant is CAUGHT only by a real, identifiable test failure that matches the expected test
// (and cause, when given), with no timeout and no cancellation anywhere in the run (reviews
// N2/N3). Never a catch:
//   timedOut   the runner's own deadline; node:test "test timed out after N ms"; Vitest
//              "Test timed out in N ms" / "Hook timed out in N ms";
//   cancelled  node:test "cancelled N" with N > 0; "Promise resolution is still pending";
//   error      the process could not run, a test file was not found, or a module failed to load
//              or parse (infrastructure);
//              a harness scenario that crashed (reported as "<mode>: ERROR");
//   missed     the tests passed; or they failed without an identifiable test (a file-level
//              failure, an exit 1 with nothing named), or not the expected one.

import { readFileSync, writeFileSync } from 'node:fs'

const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g')
const TIMEOUT = [/test timed out after \d+\s*ms/i, /Test timed out in \d+\s*ms/, /Hook timed out in \d+\s*ms/]
const CANCELLED = [/^\s*ℹ cancelled (\d+)/m, /^# cancelled (\d+)/m]
const PENDING = /Promise resolution is still pending/
/** A module that could not be found, loaded or parsed: infrastructure, whatever else failed. */
const INFRASTRUCTURE = [
  /ERR_MODULE_NOT_FOUND/, /Cannot find module/, /Cannot find package/, /ERR_UNKNOWN_FILE_EXTENSION/, /Failed to load url/,
  /Failed to parse source/, /Transform failed/, /No test files? found/,
  // node:test given a test file that does not exist (Node 22 and 24: exit 1, nothing else printed).
  /^Could not find '[^']+'\s*$/m,
]
/** Infrastructure only when no test is named (a real test may legitimately report these). */
const INFRASTRUCTURE_UNNAMED = [/^\s*SyntaxError: /m, /ENOENT: no such file or directory/, /ERR_INVALID_ARG_TYPE/]
/**
 * The lines a reporter prints to NAME a test (node spec ✔/✖, Vitest ✓/×/FAIL). The markers of a
 * timeout, a cancellation or a pending promise are only read outside them: a test may be named
 * after the very message it is about (the judge's own tests are), and its name must never decide.
 */
const NAME_LINE = /^\s*(?:✔|✖|✓|×|FAIL\s)/
const outsideNames = text => text.split('\n').filter(line => !NAME_LINE.test(line)).join('\n')
const looksLikeFile = name => /\.(m?[jt]sx?|cjs)$/.test(name) || /[\\/]/.test(name) && /\.\w+$/.test(name)

/** Every test failure the output names, in order (node spec, Vitest, Deno, ordering harness, supervisor). */
export function failuresIn(text) {
  const names = [
    ...[...text.matchAll(/^\s*✖ (?!failing tests)(.+?) \(\d[\d.]*ms\)/gmu)].map(m => m[1].trim()),
    ...[...text.matchAll(/^\s*×\s+(.+?)(?:\s+\d+\s*ms)?$/gmu)].map(m => m[1].trim()),
    ...[...text.matchAll(/^\s*FAIL\s+\S+\s+>\s+(.+?)$/gmu)].map(m => m[1].trim()),
    ...[...text.matchAll(/^(.+?) \.\.\. .*FAILED/gmu)].map(m => m[1].trim()),
    ...[...text.matchAll(/^([a-z][a-z0-9-]*): FAIL$/gmu)].map(m => m[1]),
    ...[...text.matchAll(/"name": "([^"]+)",\s*"ok": false/gmu)].map(m => m[1]),
  ]
  return [...new Set(names)].filter(name => !looksLikeFile(name))
}

/**
 * The verdict on one test command of a mutant. `test`: { expect?: string | string[], first?,
 * cause?: RegExp }. `run`: what spawnSync returned ({ status, signal, error, stdout, stderr }).
 */
export function judge(test, run) {
  const text = `${run.stdout ?? ''}${run.stderr ?? ''}`.replace(ANSI, '')
  const failures = failuresIn(text)
  const base = { exit: run.status ?? null, signal: run.signal ?? null, failures, firstFailure: failures[0] ?? null }
  const verdict = (kind, why) => ({ ...base, verdict: kind, caught: kind === 'caught', timedOut: kind === 'timedOut', why })
  if (run.error?.code === 'ETIMEDOUT' || run.signal) return verdict('timedOut', 'killed at the runner deadline')
  if (run.error) return verdict('error', `could not run: ${run.error.code ?? run.error.message}`)
  const markers = outsideNames(text)
  const timeout = TIMEOUT.find(pattern => pattern.test(markers))
  if (timeout) return verdict('timedOut', `framework timeout (${markers.match(timeout)[0]})`)
  const cancelled = CANCELLED.map(pattern => markers.match(pattern)).find(match => match && Number(match[1]) > 0)
  if (cancelled) return verdict('cancelled', `cancelled tests (${cancelled[0].trim()})`)
  if (PENDING.test(markers)) return verdict('cancelled', 'a test left a promise pending')
  if (/^[a-z][a-z0-9-]*: ERROR/m.test(markers)) return verdict('error', 'a harness scenario crashed')
  const infrastructure = INFRASTRUCTURE.find(pattern => pattern.test(markers)) ?? (failures.length === 0 ? INFRASTRUCTURE_UNNAMED.find(pattern => pattern.test(markers)) : undefined)
  if (infrastructure) return verdict('error', `infrastructure (${markers.match(infrastructure)[0].trim().slice(0, 60)})`)
  if (run.status === 0) return verdict('missed', 'the tests passed')
  if (failures.length === 0) return verdict('missed', `exit ${run.status} without an identifiable test failure`)
  const expected = test.expect === undefined || test.expect === null ? null : [test.expect].flat()
  if (expected) {
    const matches = name => expected.some(e => (test.first ? name.startsWith(e) : name.includes(e)))
    if (test.first ? !matches(failures[0]) : !failures.some(matches)) return verdict('missed', `"${expected.join('" | "')}" did not fail (failures: ${failures.slice(0, 3).join(' | ')})`)
  }
  if (test.cause && !test.cause.test(text)) return verdict('missed', `cause ${test.cause} not in the output`)
  return verdict('caught', null)
}

/**
 * Applies `mutation` ({ from, to, after? }) to `path`, runs `body()`, and restores the file byte for
 * byte whatever happens (a verdict, a throw, a crash of the run). Resolves to body's value, or to
 * { pattern: count } when `from` is not found exactly once (nothing is changed then).
 */
export function withMutation(path, mutation, body) {
  const original = readFileSync(path)
  const text = original.toString('utf8').replace(/\r\n/g, '\n')
  const anchors = mutation.after ? text.split(mutation.after).length - 1 : 1
  const start = mutation.after ? text.indexOf(mutation.after) : 0
  const count = mutation.after ? (anchors === 1 && text.indexOf(mutation.from, start) >= 0 ? 1 : 0) : text.split(mutation.from).length - 1
  if (anchors !== 1 || count !== 1) return { pattern: count, anchors }
  const at = text.indexOf(mutation.from, start)
  writeFileSync(path, text.slice(0, at) + mutation.to + text.slice(at + mutation.from.length))
  try {
    return body()
  } finally {
    writeFileSync(path, original)
  }
}

const WORST = ['timedOut', 'cancelled', 'error', 'missed']

/**
 * Runs every mutant of `list` (each { id, what, file, from, to, after?, test | tests }), one at a
 * time: the file is mutated, every test command runs and is judged, the file is restored. A mutant
 * is caught only if EVERY command is a real catch; otherwise it takes the worst verdict
 * (timedOut > cancelled > error > missed). The tree under `cleanPaths` must be clean before and
 * after (git). Prints one line per mutant and a JSON summary; returns true only if all were caught
 * and the tree was restored.
 */
export function runMutationList(list, { root, cleanPaths, label, timeoutMs = 300_000, spawn }) {
  const git = (...args) => spawn('git', args, { cwd: root, encoding: 'utf8' })
  const clean = () => git('status', '--porcelain', '--untracked-files=no', '--', ...cleanPaths).stdout.trim() === ''
  if (!clean()) { console.error('the tree is not clean: commit or stash first'); process.exit(2) }
  const started = Date.now()
  const results = []
  for (const m of list) {
    const begun = Date.now()
    const outcome = withMutation(`${root}${m.file}`, m, () => (m.tests ?? [m.test]).map(test =>
      judge(test, spawn(test.cmd, test.args, { cwd: test.cwd, encoding: 'utf8', timeout: timeoutMs, shell: test.cmd === 'deno' || test.shell === true }))))
    if (!Array.isArray(outcome)) {
      results.push({ id: m.id, what: m.what, verdict: 'pattern', why: `pattern found ${outcome.pattern} times (anchor ${outcome.anchors})` })
      console.log(`${m.id} PATTERN ${outcome.pattern}x — ${m.what}`)
      continue
    }
    const verdict = outcome.every(r => r.verdict === 'caught') ? 'caught' : WORST.find(kind => outcome.some(r => r.verdict === kind))
    const ms = Date.now() - begun
    results.push({ id: m.id, what: m.what, verdict, runs: outcome, ms })
    const label = { caught: 'CAUGHT', missed: 'MISSED', timedOut: 'TIMED OUT', cancelled: 'CANCELLED', error: 'ERROR' }[verdict]
    console.log(`${m.id} ${label} (${Math.round(ms / 1000)} s) — ${m.what} → ${outcome.map(r => r.why ?? r.firstFailure ?? '?').join(' | ')}`)
  }
  const restored = clean()
  const summary = { label, ...tally(results), restored, seconds: Math.round((Date.now() - started) / 1000) }
  console.log(JSON.stringify(summary))
  return summary.caught === summary.total && restored
}

/** Counts by verdict for a list of results ({ verdict }), for the runners' summaries. */
export function tally(results) {
  const by = kind => results.filter(r => r.verdict === kind).map(r => r.id)
  return {
    total: results.length,
    caught: by('caught').length,
    missed: by('missed'), timedOut: by('timedOut'), cancelled: by('cancelled'), error: by('error'), pattern: by('pattern'),
  }
}
