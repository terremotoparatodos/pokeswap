// CLOUD JOIN-ORDER-2 — negative controls for the realtime, the client and the Edge handler. Each mutant removes
// ONE protection from the committed code (exact replacements in the working copy), runs the test that must catch
// it, and restores the files with `git checkout`. DETECTED only if that test FAILS on an assertion; a timeout, a
// crash before any test or a harness error is BLOCKED, never a detection. Requires a clean working copy.
// `expect: 'SURVIVED'` marks ONE layer of a two-layer protection (the other layer holds on its own).
// The SQL mutants run on real Postgres: scripts/world-location/join-order-concurrency/run.mjs.
//   node docs/design/cloud-join-order-2/evidence/joinOrderMutants.mjs <node binary>
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const NODE = process.argv[2] ?? process.execPath
const RT = 'services/realtime/'
const IN = `${RT}src/rooms/PresenceRoomJoinOrder.test.js`
const CROSS = `${RT}src/rooms/PresenceRoomJoinOrderClaims.test.js`
const CAP = `${RT}src/presence/joinOrderCapability.test.js`
const CLIENT = 'src/features/wildlands/multiplayer/api/joinAttempt.test.ts'
const EDGE = 'supabase/functions/world-authority/handler.joinOrder.test.ts'
const MUTANTS = [
  // ── realtime, one process ──
  { id: 'admission-order-removed', edits: [[`${RT}src/rooms/presenceHosting.js`, '    const verdict = order.observe(auth.userId, tabId, attempt)', "    const verdict = 'admit'"]], run: 'node', test: IN, pattern: '^1 — R1 with attempts' },
  { id: 'duplicate-admitted', edits: [[`${RT}src/presence/joinOrder.js`, '    if (known && attempt <= known.highest) {', '    if (known && attempt < known.highest) {']], run: 'node', test: IN, pattern: '^8 — a duplicate' },
  { id: 'invalid-attempt-accepted', edits: [[`${RT}src/rooms/presenceHosting.js`, '    if (!ok || !tabId) {', '    if (!tabId) {']], run: 'node', test: IN, pattern: '^9 — invalid attempts' },
  { id: 'shadow-enforces', edits: [[`${RT}src/rooms/presenceHosting.js`, '      if (!order.enforcing) { order.counters.wouldRefuse++; return null }', '      if (false) { order.counters.wouldRefuse++; return null }']], run: 'node', test: IN, pattern: '^modes' },
  { id: 'recheck-removed', edits: [[`${RT}src/rooms/PresenceRoom.js`, "    if (!hosting.stillLatest(client, auth)) throw new ServerError(STALE_ATTEMPT_CODE, 'stale-attempt')\n", '']], run: 'node', test: IN, pattern: '^5 — the re-check' },
  { id: 'live-page-forgotten', edits: [[`${RT}src/presence/joinOrder.js`, '      if (this.isLive(entry.userId, entry.page)) {', '      if (false) {']], run: 'node', test: IN, pattern: '^D3 — memory is bounded' },
  // ── realtime, across processes (claim v3) ──
  { id: 'v3-never-used', edits: [[`${RT}src/presence/recoveryCapability.js`, "        if (options?.page && order?.enabled && typeof target.locationClaimV3 === 'function') {", '        if (false) {']], run: 'node', test: CROSS, pattern: '^3/4/5' },
  { id: 'stale-claim-not-final', edits: [[`${RT}src/presence/locationJournal.js`, "    if (result.status === 'stale_attempt' || result.status === 'duplicate_attempt') {\n      // CLOUD JOIN-ORDER-2", '    if (false) {\n      // CLOUD JOIN-ORDER-2']], run: 'node', test: CROSS, pattern: '^3/4/5' },
  { id: 'stale-hydrating-placed', edits: [[`${RT}src/rooms/locationJoin.js`, "      if (result.status === 'stale_attempt' || result.status === 'duplicate_attempt') return this.#staleAttemptWhileHydrating(client, pending)\n", '']], run: 'node', test: CROSS, pattern: '^3/4/5' },
  { id: 'stale-answer-unread', edits: [[`${RT}src/world/persistence/playerData.js`, "  if (claim && typeof claim === 'object' && ATTEMPT_ANSWERS.has(claim.status)) return { status: claim.status, newerActive: claim.newerActive === true }\n", '']], run: 'node', test: CROSS, pattern: '^3/4/5' },
  { id: 'fallback-disables-recovery', edits: [[`${RT}src/presence/recoveryCapability.js`, '            if (!order.unsupported(error)) throw error', '            if (!capability.unsupported(error)) throw error']], run: 'node', test: CAP, pattern: '^routing: v3 refused' },
  { id: 'takeover-without-recovery', edits: [[`${RT}src/presence/recoveryCapability.js`, '{ takeover: recovery && options.takeover === true,', '{ takeover: options.takeover === true,']], run: 'node', test: CAP, pattern: '^routing: a session with a page' },
  // ── Edge handler ──
  { id: 'edge-takeover-without-recovery', edits: [['supabase/functions/world-authority/handler.ts', ' || (body.takeover && !body.recovery)) return json(400', ') return json(400']], run: 'deno', test: EDGE, pattern: 'malformed' },
  // ── client ──
  { id: 'client-attempt-not-advanced', edits: [['src/features/wildlands/multiplayer/api/colyseusPresence.ts', '        attempt: ++lastAttempt,', '        attempt: lastAttempt + 1,']], run: 'vitest', test: CLIENT, pattern: 'overlapping sockets' },
  { id: 'client-4410-reconnects', edits: [['src/features/wildlands/multiplayer/api/colyseusPresence.ts', "    if (decision.action === 'discarded' || decision.action === 'invalid') {", '    if (false) {']], run: 'vitest', test: CLIENT, pattern: "OWN socket stops it without any automatic retry \\(the entry" },
  { id: 'client-4410-unmapped', edits: [['src/features/wildlands/multiplayer/domain/closePolicy.ts', "    case CLOSE_CODE.STALE_ATTEMPT: return decision('discarded')\n", '']], run: 'vitest', test: CLIENT, pattern: 'close policy' },
  // Two layers keep an abandoned socket silent: the adapter returns before any status (this one), and the entry
  // controller ignores status from a socket it already replaced (its generation). Removing this one alone must not
  // change what the page shows.
  { id: 'client-abandoned-status-layer', expect: 'SURVIVED', edits: [['src/features/wildlands/multiplayer/api/colyseusPresence.ts', '      if (this.stopped) return\n      this.stopped = true\n', '      this.stopped = true\n']], run: 'vitest', test: CLIENT, pattern: 'abandoned attempt refused with 4410 is silent' },
]

const dirty = execFileSync('git', ['-C', ROOT, 'status', '--porcelain', '--', 'services/realtime/src', 'src', 'supabase/functions'], { encoding: 'utf8' }).trim()
if (dirty) { console.log(`BLOCKED: uncommitted changes under the mutated trees; commit them first:\n${dirty}`); process.exit(2) }

/** Terminal colour codes in deno/vitest output (built from the code point: the linter forbids \x1b in a literal). */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

function runTest(m) {
  if (m.run === 'node') {
    const r = spawnSync(NODE, ['--test', '--test-timeout=60000', '--test-reporter=tap', `--test-name-pattern=${m.pattern}`, m.test.slice(RT.length)], { cwd: join(ROOT, RT), encoding: 'utf8', timeout: 240_000, maxBuffer: 256 * 1024 * 1024 })
    const out = `${r.stdout}${r.stderr}`
    return { timedOut: r.error?.code === 'ETIMEDOUT' || /timed out after/.test(out), failed: Number(out.match(/^# fail (\d+)/m)?.[1] ?? NaN), passed: Number(out.match(/^# pass (\d+)/m)?.[1] ?? NaN), assertion: /ERR_ASSERTION|AssertionError|\+ actual - expected/.test(out) }
  }
  if (m.run === 'deno') {
    const r = spawnSync('deno', ['test', '--no-check', `--filter=${m.pattern}`, m.test], { cwd: ROOT, encoding: 'utf8', timeout: 240_000, maxBuffer: 64 * 1024 * 1024 })
    const out = `${r.stdout}${r.stderr}`.replace(ANSI, '')
    const m2 =out.match(/(\d+) passed \| (\d+) failed/)
    return { timedOut: r.error?.code === 'ETIMEDOUT', failed: Number(m2?.[2] ?? NaN), passed: Number(m2?.[1] ?? NaN), assertion: /error: Error: expected/.test(out) }
  }
  const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vitest', 'run', m.test, '-t', m.pattern, '--reporter=verbose'], { cwd: ROOT, encoding: 'utf8', timeout: 240_000, maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' })
  const out = `${r.stdout}${r.stderr}`.replace(ANSI, '')
  return { timedOut: r.error?.code === 'ETIMEDOUT', failed: Number(out.match(/Tests\s+(\d+) failed/)?.[1] ?? 0), passed: Number(out.match(/(\d+) passed/)?.[1] ?? NaN), assertion: /AssertionError/.test(out) }
}

const results = []
for (const m of MUTANTS) {
  const files = [...new Set(m.edits.map(([file]) => file))]
  const texts = Object.fromEntries(files.map(f => [f, readFileSync(join(ROOT, f), 'utf8').replace(/\r\n/g, '\n')]))
  const bad = m.edits.find(([file, from]) => texts[file].split(from).length - 1 !== 1)
  if (bad) { results.push({ id: m.id, verdict: 'BLOCKED', expect: m.expect ?? 'DETECTED', why: `fragment does not match exactly once in ${bad[0]}` }); continue }
  try {
    for (const [file, from, to] of m.edits) texts[file] = texts[file].replace(from, () => to)
    for (const f of files) writeFileSync(join(ROOT, f), texts[f])
    const { timedOut, failed, passed, assertion } = runTest(m)
    const verdict = timedOut || Number.isNaN(passed) && Number.isNaN(failed) ? 'BLOCKED'
      : failed > 0 && assertion ? 'DETECTED'
      : failed === 0 && passed > 0 ? 'SURVIVED' : 'BLOCKED'
    results.push({ id: m.id, run: m.run, verdict, expect: m.expect ?? 'DETECTED', failed, passed })
  } finally {
    execFileSync('git', ['-C', ROOT, 'checkout', '--', ...files])
  }
}
for (const r of results) console.log(`${r.id.padEnd(32)} ${(r.run ?? '').padEnd(6)} ${r.verdict.padEnd(9)} expected=${r.expect.padEnd(9)} ${r.why ?? `fail=${r.failed} pass=${r.passed}`}`)
const clean = execFileSync('git', ['-C', ROOT, 'status', '--porcelain', '--', 'services/realtime/src', 'src', 'supabase/functions'], { encoding: 'utf8' }).trim()
console.log(clean ? `RESTORE CHECK: dirty\n${clean}` : 'restore check: clean')
process.exit(results.every(r => r.verdict === r.expect) && !clean ? 0 : 1)
