// CLOUD READINESS-3 — realtime negative controls. Each mutant removes a protection from the committed
// realtime code (exact replacements in the working copy), runs the test that must catch it, and restores
// the files with `git checkout`. DETECTED only if that test FAILS on an assertion; a timeout, a crash
// before any test or a harness error is BLOCKED, never a detection. Requires a clean working copy.
// `expect: 'SURVIVED'` marks ONE layer of a two-layer protection: removing it alone must not change the
// outcome (the other layer holds); removing both must be DETECTED.
//   node docs/design/cloud-readiness-3/evidence/realtimeMutants.mjs <node binary>
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const RT = join(ROOT, 'services', 'realtime')
const NODE = process.argv[2] ?? process.execPath
const ROOM = 'src/rooms/PresenceRoomRecovery.test.js'
const CAP = 'src/presence/recoveryCapability.test.js'
const HOSTING = 'src/rooms/presenceHosting.js'
const STOP_PROMOTING = '    if (standby?.promoting) { this.standbyCounters.abandoned++; void standby.promoting.stop() }\n'
const RECHECK = "if (this.standby !== standby || this.shutdownBegun || state !== 'active') {"
const ACTIVATE_GUARD = "    if (state === 'starting' && this.standby === standby && !this.shutdownBegun) state = await candidate.activate()"
const MUTANTS = [
  // Two layers keep a promotion that a shutdown overtook from being installed: beginShutdown() stops the
  // identity being promoted (its activation answers late/stopped), and #promote re-checks the shutdown.
  { id: 'layer1-promotion-not-stopped', expect: 'SURVIVED', edits: [[HOSTING, STOP_PROMOTING, '']], test: ROOM, pattern: 'SIGINT during the promotion' },
  { id: 'layer2-no-shutdown-recheck', expect: 'SURVIVED', edits: [[HOSTING, RECHECK, "if (state !== 'active') {"]], test: ROOM, pattern: 'SIGINT during the promotion' },
  { id: 'both-layers-late-promotion', edits: [[HOSTING, STOP_PROMOTING, ''], [HOSTING, RECHECK, "if (state !== 'active') {"], [HOSTING, ACTIVATE_GUARD, "    if (state === 'starting') state = await candidate.activate()"]],
    test: ROOM, pattern: 'SIGINT during the promotion' },
  { id: 'takeover-on-resume', edits: [['src/rooms/locationJoin.js', 'session.takeover = options?.takeover === true && options?.resume !== true', 'session.takeover = options?.takeover === true']],
    test: ROOM, pattern: 'UNREACHABLE owner' },
  { id: 'unreachable-is-replaced', edits: [['src/rooms/locationJoin.js', "if (result.status === 'owner_unreachable') return this.#retryWhileHydrating(client, pending, 'owner-unreachable')", "if (result.status === 'owner_unreachable') return this.#supersededWhileHydrating(client, pending)"]],
    test: ROOM, pattern: 'UNREACHABLE owner' },
  { id: 'stale-host-is-replaced', edits: [['src/rooms/locationJoin.js', "if (result.status === 'superseded' && result.newerActive === true && this.recovery()) return this.#retryWhileHydrating(client, pending, 'draining')", '']],
    test: ROOM, pattern: 'LIVE owner on a newer host' },
  { id: 'disable-not-permanent', edits: [['src/presence/recoveryCapability.js', "    this.state = 'disabled'\n", "    this.state = 'unknown'\n"]], test: CAP, pattern: 'disable is permanent' },
  { id: 'standby-without-new-exclusive-identity', edits: [[HOSTING, 'new HostLifecycle({ store, exclusive: true, log: this.log })', 'new HostLifecycle({ store, exclusive: false, log: this.log })']],
    test: ROOM, pattern: 'booting lower candidate' },
  { id: 'kill-switch-ignored', edits: [['src/presence/recoveryCapability.js', "export const recoveryRequested = env => env?.[RECOVERY_ENV] === 'on'", "export const recoveryRequested = env => env?.[RECOVERY_ENV] !== 'off'"]], test: CAP, pattern: 'kill switch' },
  { id: 'fallback-without-disable', edits: [['src/presence/recoveryCapability.js', '            if (!capability.unsupported(error)) throw error\n', '            if (!(error instanceof Error)) throw error\n']], test: CAP, pattern: 'withRecovery' },
]

const results = []
for (const m of MUTANTS) {
  const files = [...new Set(m.edits.map(([file]) => file))]
  const texts = Object.fromEntries(files.map(f => [f, readFileSync(join(RT, f), 'utf8').replace(/\r\n/g, '\n')]))
  const bad = m.edits.find(([file, from]) => texts[file].split(from).length - 1 !== 1)
  if (bad) { results.push({ id: m.id, verdict: 'BLOCKED', expect: m.expect ?? 'DETECTED', why: `fragment does not match exactly once in ${bad[0]}` }); continue }
  try {
    for (const [file, from, to] of m.edits) texts[file] = texts[file].replace(from, () => to)
    for (const f of files) writeFileSync(join(RT, f), texts[f])
    const run = spawnSync(NODE, ['--test', '--test-timeout=60000', '--test-reporter=tap', `--test-name-pattern=${m.pattern}`, m.test], { cwd: RT, encoding: 'utf8', timeout: 180_000, maxBuffer: 256 * 1024 * 1024 })
    const out = `${run.stdout}${run.stderr}`
    const failed = Number(out.match(/^# fail (\d+)/m)?.[1] ?? NaN)
    const passed = Number(out.match(/^# pass (\d+)/m)?.[1] ?? NaN)
    // An assert diff ("+ actual - expected") is an assertion too: Node reports a circular diff as ERR_TEST_FAILURE.
    const assertion = /ERR_ASSERTION|AssertionError|\+ actual - expected/.test(out)
    const timedOut = run.error?.code === 'ETIMEDOUT' || /timed out after/.test(out)
    const verdict = timedOut || Number.isNaN(failed) ? 'BLOCKED' : failed > 0 && assertion ? 'DETECTED' : failed === 0 && passed > 0 ? 'SURVIVED' : 'BLOCKED'
    results.push({ id: m.id, verdict, expect: m.expect ?? 'DETECTED', failed, passed, pattern: m.pattern })
  } finally {
    for (const f of files) execFileSync('git', ['-C', ROOT, 'checkout', '--', `services/realtime/${f}`])
  }
}
for (const r of results) console.log(`${r.id.padEnd(40)} ${r.verdict.padEnd(9)} expected=${r.expect.padEnd(9)} ${r.why ?? `fail=${r.failed} pass=${r.passed} (${r.pattern})`}`)
const clean = execFileSync('git', ['-C', ROOT, 'status', '--porcelain', '--', 'services/realtime/src'], { encoding: 'utf8' }).trim()
console.log(clean === '' ? 'working copy restored: clean' : `WARNING: working copy not clean:\n${clean}`)
process.exit(results.every(r => r.verdict === r.expect) && clean === '' ? 0 : 1)
