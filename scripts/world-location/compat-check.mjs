// WORLD LOCATION-4 — which releases speak which location protocol (read-only, git refs only).
//
//   node scripts/world-location/compat-check.mjs [--production playtest-0.2] [--dark 4d0ab64] [--head HEAD]
//
// Checks, from the committed sources (tests excluded):
//   - production (Playtest 0.2): no location operation at all, no presence host, client ≤ 2;
//   - the dark environment: the v1 location operations only (no presence host, no keyed shape);
//   - this branch: the keyed shapes and the host lifecycle, the v1 operations still answered
//     (not removed yet: the dark environment depends on them), and a protocol-3 client.
// Exit 0 only if every expectation holds. Prints a JSON summary.

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback }
const refs = { production: arg('production', 'playtest-0.2'), dark: arg('dark', '4d0ab64'), head: arg('head', 'HEAD') }

const SERVER = ['services/realtime/src', 'supabase/functions']
const CLIENT = ['src']
const PATTERNS = {
  v1Operations: { pattern: "case 'location_claim'|op: 'location_claim'|'location_claim'", paths: SERVER },
  presenceHost: { pattern: 'presence_(acquire|activate|renew|drain|stop)', paths: SERVER },
  keyedShapes: { pattern: 'world_location_(claim|save)_keyed', paths: SERVER },
  v1ClaimWithEpoch: { pattern: 'p_expected_epoch: body.expectedEpoch', paths: ['supabase/functions'] },
  clientProtocol3: { pattern: 'PRESENCE_PROTOCOL = 3', paths: CLIENT },
}

function uses(ref, { pattern, paths }) {
  const run = spawnSync('git', ['grep', '-l', '-E', pattern, ref, '--', ...paths, ':(exclude)*.test.*', ':(exclude)*.spec.*'], { cwd: root, encoding: 'utf8' })
  if (run.status > 1) throw new Error(`git grep failed on ${ref}: ${run.stderr}`)
  return run.stdout.split('\n').filter(Boolean).map(line => line.slice(ref.length + 1))
}

const found = {}
for (const [name, ref] of Object.entries(refs)) {
  found[name] = { ref }
  for (const [key, spec] of Object.entries(PATTERNS)) found[name][key] = uses(ref, spec)
}

const expect = (label, ok) => ({ label, ok: Boolean(ok) })
const checks = [
  expect('production: no location operation (v1 or keyed) and no presence host', !found.production.v1Operations.length && !found.production.keyedShapes.length && !found.production.presenceHost.length),
  expect('production: the client does not declare protocol 3', !found.production.clientProtocol3.length),
  expect('dark: the v1 location operations only', found.dark.v1Operations.length > 0 && !found.dark.keyedShapes.length && !found.dark.presenceHost.length),
  expect('head: the keyed shapes and the presence host lifecycle', found.head.keyedShapes.length > 0 && found.head.presenceHost.length > 0),
  expect('head: the v1 claim with an expected epoch is still answered (not removed yet)', found.head.v1ClaimWithEpoch.length > 0),
  expect('head: the client declares protocol 3', found.head.clientProtocol3.length > 0),
]
const passed = checks.every(c => c.ok)
console.log(JSON.stringify({ passed, checks, found }, null, 2))
process.exit(passed ? 0 : 1)
