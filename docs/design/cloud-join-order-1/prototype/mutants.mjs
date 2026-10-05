// CLOUD JOIN-ORDER-1 — negative controls for the realtime prototype. Each mutant removes ONE decisive
// check from the PROTOTYPE tree, runs the case that must catch it, and restores the file from the copy
// it read first (never `git checkout`: the prototype is uncommitted work in an isolated worktree).
// DETECTED only on an assertion failure; a timeout or crash is BLOCKED, never a detection.
//   node docs/design/cloud-join-order-1/prototype/mutants.mjs <node> <proto>/services/realtime/src/
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const NODE = process.argv[2]
const TREE = process.argv[3]
const TEST = fileURLToPath(new URL('./joinOrder.test.mjs', import.meta.url))
const MUTANTS = [
  { id: 'admission-check-removed', file: 'rooms/presenceHosting.js', from: 'const verdict = this.joinOrder.observe(auth.userId, tabId, attempt)', to: "const verdict = 'admit'", pattern: '^1 ' },
  { id: 'duplicate-counted-as-new', file: 'presence/joinOrder.js', from: 'if (highest !== undefined && attempt <= highest) {', to: 'if (highest !== undefined && attempt < highest) {', pattern: '^8 ' },
  { id: 'stale-claim-not-final', file: 'presence/locationJournal.js', from: "    if (result.status === 'stale_attempt' || result.status === 'duplicate_attempt') {", to: "    if (false) {", pattern: '^3/4/5 ' },
  { id: 'invalid-attempt-accepted', file: 'presence/joinOrder.js', from: "  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > ATTEMPT_MAX) throw new InvalidAttempt('invalid attempt')", to: '', pattern: '^9 ' },
  // Defence in depth: the re-check right before the replacement. No await separates admission's tail from the
  // replacement today, so removing it alone is expected to SURVIVE (it guards future awaits in between).
  { id: 'recheck-removed', expect: 'SURVIVED', file: 'rooms/PresenceRoom.js', from: "    if (!hosting.stillLatest(client, auth)) throw new ServerError(STALE_ATTEMPT_CODE, 'stale-attempt')\n", to: '', pattern: '^1 ' },
]
const results = []
for (const m of MUTANTS) {
  const path = join(TREE, m.file)
  const original = readFileSync(path, 'utf8')
  const lf = original.replace(/\r\n/g, '\n')
  if (lf.split(m.from).length - 1 !== 1) { results.push({ ...m, verdict: 'BLOCKED', why: 'fragment does not match exactly once' }); continue }
  try {
    writeFileSync(path, lf.replace(m.from, () => m.to))
    const run = spawnSync(NODE, ['--test', '--test-timeout=60000', '--test-reporter=tap', `--test-name-pattern=${m.pattern}`, TEST], { encoding: 'utf8', timeout: 240_000, maxBuffer: 256 * 1024 * 1024, env: { ...process.env, JOIN_ORDER_TREE: TREE } })
    const out = `${run.stdout}${run.stderr}`
    const failed = Number(out.match(/^# fail (\d+)/m)?.[1] ?? NaN)
    const passed = Number(out.match(/^# pass (\d+)/m)?.[1] ?? NaN)
    const assertion = /ERR_ASSERTION|AssertionError|\+ actual - expected/.test(out)
    const timedOut = run.error?.code === 'ETIMEDOUT' || /timed out after/.test(out)
    const verdict = timedOut || Number.isNaN(failed) ? 'BLOCKED' : failed > 0 && assertion ? 'DETECTED' : failed === 0 && passed > 0 ? 'SURVIVED' : 'BLOCKED'
    results.push({ ...m, verdict, failed, passed })
  } finally {
    writeFileSync(path, original)
  }
}
for (const r of results) console.log(`${r.id.padEnd(28)} ${r.verdict.padEnd(9)} expected=${(r.expect ?? 'DETECTED').padEnd(9)} ${r.why ?? `fail=${r.failed} pass=${r.passed}`}`)
process.exit(results.every(r => r.verdict === (r.expect ?? 'DETECTED')) ? 0 : 1)
