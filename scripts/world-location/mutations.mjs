// WORLD LOCATION-2 — negative controls. Each critical protection is broken on
// purpose, its test is run and MUST fail, and the file is restored byte for
// byte. The tree must be clean before and after (checked with git).
//
//   node scripts/world-location/mutations.mjs            all
//   node scripts/world-location/mutations.mjs M3 M12     some
//
// Prints one line per mutation and a JSON summary; exit 0 only if every
// mutation was caught and the tree is restored.
//
// What counts as caught (review 2, F3): EVERY test command of the mutation
// exits non-zero on its own — a run killed at the runner's deadline is
// `timedOut` and is never counted as caught, whatever its output — and, when
// the mutation names them, the expected test is among the failures (or is the
// first one, `first: true`) and the expected cause appears in the output.

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const RT = 'services/realtime/'
// The spec reporter is requested explicitly: without it Node picks one by itself (TAP when stdout is
// not a TTY on some versions), and the verdicts below parse spec's `✖ <name> (<ms>ms)` lines.
const node = (...files) => ({ cwd: `${root}${RT}`, cmd: process.execPath, args: ['--test', '--test-reporter=spec', '--test-timeout=60000', ...files] })
const deno = file => ({ cwd: root, cmd: 'deno', args: ['test', file] })
/** The same command, with the failure it must produce: `expect` a test name (prefix), `first` it must be the first failure, `cause` a regex over the output. */
const expecting = (command, expect, { first = false, cause = null } = {}) => ({ ...command, expect, first, cause })

const MIGRATION = 'supabase/migrations/20261001220000_world_player_locations.sql'
const HANDLER = 'supabase/functions/world-authority/handler.ts'
const JOURNAL = `${RT}src/presence/locationJournal.js`
const POLICY = `${RT}src/presence/locationPolicy.js`
const SERVICE = `${RT}src/presence/locationService.js`
const JOIN = `${RT}src/rooms/locationJoin.js`
const ROOM = `${RT}src/rooms/PresenceRoom.js`
const ADAPTER = `${RT}src/world/persistence/playerData.js`

const DB_TEST = node('src/world/persistence/worldLocations.database.test.js')
const JOURNAL_TEST = node('src/presence/locationJournal.test.js')
const JOURNAL_DB_TEST = node('src/presence/locationJournal.database.test.js')
const POLICY_TEST = node('src/presence/locationPolicy.test.js')
const ROOM_TEST = node('src/rooms/PresenceRoomLocation.test.js')
const FLAG_TEST = node('src/presence/locationFlag.test.js')
const ADAPTER_TEST = node('src/world/persistence/locationAdapters.test.js')
const LAYOUT_TEST = node('src/world/layoutVersion.test.js')
const LAYOUT = `${RT}src/world/layoutVersion.js`
const TERRAIN = `${RT}src/world/terrain.js`
const DENO_TEST = deno('supabase/functions/world-authority/handler.test.ts')

const MUTATIONS = [
  // Database: CAS, trust boundary, NULL safety, epoch reset.
  { id: 'M1', what: 'save CAS ignores the epoch (a fenced session could write)', file: MIGRATION, from: 'WHERE user_id = v_user AND epoch = v_epoch AND seq < v_seq', to: 'WHERE user_id = v_user AND seq < v_seq', test: DB_TEST },
  { id: 'M2', what: 'save CAS ignores the seq (retries and reordered batches overwrite)', file: MIGRATION, from: 'WHERE user_id = v_user AND epoch = v_epoch AND seq < v_seq', to: 'WHERE user_id = v_user AND epoch = v_epoch', test: DB_TEST },
  { id: 'M3', what: 'client privileges on the table are not revoked', file: MIGRATION, from: 'REVOKE ALL ON TABLE public.world_player_locations FROM PUBLIC, anon, authenticated, service_role;', to: '-- (mutated: no revoke)', test: DB_TEST },
  { id: 'M4', what: 'clients keep EXECUTE on the claim function', file: MIGRATION, from: 'REVOKE ALL ON FUNCTION public.world_location_claim(uuid, bigint) FROM PUBLIC, anon, authenticated;', to: '-- (mutated: no revoke)', test: DB_TEST },
  { id: 'M5', what: 'a missing key slips through (NULL <> compared)', file: MIGRATION, from: "IF jsonb_typeof(v_r.row -> 'epoch') IS DISTINCT FROM 'number'", to: "IF jsonb_typeof(v_r.row -> 'epoch') <> 'number'", test: DB_TEST },
  { id: 'M6', what: 'a claim does not reset seq (a restarted writer is stuck as duplicate)', file: MIGRATION, from: 'SET epoch = epoch + 1, seq = 0, updated_at = now()', to: 'SET epoch = epoch + 1, updated_at = now()', test: JOURNAL_DB_TEST },
  { id: 'M7', what: 'service_role keeps DELETE (no revoke from it)', file: MIGRATION, from: 'FROM PUBLIC, anon, authenticated, service_role;', to: 'FROM PUBLIC, anon, authenticated;', test: DB_TEST },
  // Edge Function: validation before the database.
  { id: 'M8', what: 'location_save accepts out-of-range tiles', file: HANDLER, from: 'if (!counter(r.epoch) || !counter(r.seq) || !tile(r.tx) || !tile(r.ty)) return null', to: 'if (!counter(r.epoch) || !counter(r.seq)) return null', test: DENO_TEST },
  { id: 'M9', what: 'location_save accepts a repeated player in one batch', file: HANDLER, from: '    if (seen.has(key)) return null\n', to: '', test: DENO_TEST },
  { id: 'M10', what: 'location_claim accepts any user id', file: HANDLER, from: "        if (typeof body.userId !== 'string' || !UUID.test(body.userId)) return json(400, { error: 'invalid_user' })\n        // The epoch the realtime", to: "        // The epoch the realtime", test: DENO_TEST },
  // Adapter: per-user parsing.
  { id: 'M11', what: 'an answer about another user confirms the sent one', file: ADAPTER, from: "given.get(row.userId.toLowerCase()) ?? 'unknown'", to: "given.get(row.userId.toLowerCase()) ?? [...given.values()][0] ?? 'unknown'", test: ADAPTER_TEST },
  // Journal.
  { id: 'M12', what: 'the client moveSequence becomes the seq', file: JOURNAL, from: 'const seq = reuse ? pending.attempt.seq : ++entry.seq', to: 'const seq = reuse ? pending.attempt.seq : (++entry.seq, pending.actor.moveSequence || entry.seq)', test: JOURNAL_TEST },
  { id: 'M13', what: 'a batch is confirmed whole (results not read per user)', file: JOURNAL, from: "const result = results.get(row.userId.toLowerCase()) ?? 'unknown'", to: "const result = 'applied'", test: JOURNAL_TEST },
  { id: 'M14', what: 'a stale answer does not fence the writer', file: JOURNAL, from: "      } else if (result === 'stale') {", to: "      } else if (result === 'stale-disabled') {", test: JOURNAL_TEST },
  { id: 'M15', what: 'an unclaimed session saves anyway', file: JOURNAL, from: "if (!pending || pending.inflight || entry.status !== 'claimed' || pending.session !== entry.session) return false", to: 'if (!pending || pending.inflight || pending.session !== entry.session) return false', test: JOURNAL_TEST },
  { id: 'M16', what: 'memory is unbounded (no eviction)', file: JOURNAL, from: '    if (this.entries.size <= this.maxEntries) return\n    const idle', to: '    return\n    const idle', test: JOURNAL_TEST },
  { id: 'M17', what: 'no backoff after a failed batch', file: JOURNAL, from: 'this.nextFlushAt = this.now() + backoffMs(this.failures - 1)', to: 'this.nextFlushAt = 0', test: JOURNAL_TEST },
  { id: 'M18', what: 'no checkpoint jitter (stampede)', file: JOURNAL, from: 'return hash % span', to: 'return 0 * (hash % span)', test: JOURNAL_TEST },
  { id: 'M19', what: 'batches larger than 200 rows', file: JOURNAL, from: 'export const MAX_BATCH_ROWS = 200', to: 'export const MAX_BATCH_ROWS = 1_000', test: JOURNAL_TEST },
  { id: 'M20', what: 'a changed location reuses the seq of a failed attempt', file: JOURNAL, from: 'pending.attempt.epoch === entry.epoch && sameLocation(pending.attempt.location, location)', to: 'pending.attempt.epoch === entry.epoch', test: JOURNAL_TEST },
  { id: 'M21', what: 'claims of one player are not chained', file: JOURNAL, from: 'const attempt = entry.chain.then(() => this.#claimOnce(entry, session))', to: 'const attempt = this.#claimOnce(entry, session)', test: JOURNAL_TEST },
  { id: 'M22', what: 'the shutdown flush waits past its deadline', file: JOURNAL, from: "const within = async promise => (await Promise.race([promise.then(() => true), sleep(remaining()).then(() => false)]))", to: 'const within = async promise => { await promise; return true }', test: expecting(node('--test-timeout=8000', 'src/presence/locationJournal.test.js'), 'flushAll (shutdown): sends everything pending at once', { first: true, cause: /flushAll on a hung authority did not settle within 2000 ms/ }) },
  { id: 'M23', what: 'an unclaimed session retries its claim without backoff', file: JOURNAL, from: 'entry.nextClaimAt = this.now() + backoffMs(entry.claimAttempts) + jitterFor(session.userId, 250)', to: 'entry.nextClaimAt = this.now()', test: JOURNAL_TEST },
  // Restore policy.
  { id: 'M24', what: 'a restored tile is not checked (solid, portal, unreachable)', file: POLICY, from: "  if (!isSafeLanding(areaId, tx, ty)) return placed(areaId, arrival, 'tile')\n", to: '', test: POLICY_TEST },
  { id: 'M25', what: 'a changed layout version is ignored (D-L8)', file: POLICY, from: "  if (location.layoutVersion !== layoutVersion(areaId)) return placed(areaId, arrival, 'layout')\n", to: '', test: POLICY_TEST },
  { id: 'M26', what: 'an unknown area is trusted', file: POLICY, from: "  if (!isPersistableArea(areaId)) return placed(TOWN_AREA_ID, TOWN_SPAWN, 'area')\n", to: "  if (!isPersistableArea(areaId) && !String(areaId).startsWith('tundra')) return placed(TOWN_AREA_ID, TOWN_SPAWN, 'area')\n", test: POLICY_TEST },
  { id: 'M27', what: 'pre-CAVES-3 clients are restored inside a cave (D-L6)', file: POLICY, from: '  if (cave && !(Number.isInteger(worldProtocol) && worldProtocol >= WORLD_PROTOCOL)) {', to: '  if (false) {', test: POLICY_TEST },
  { id: 'M28', what: 'a Dungeon floor is saved as is (D-L9)', file: POLICY, from: "const DUNGEON_FLOOR = /^dg:([a-z0-9][a-z0-9-]{0,47}):([1-9][0-9]{0,2})$/", to: "const DUNGEON_FLOOR = /^$/", test: POLICY_TEST },
  // Room: connection rules.
  { id: 'M29', what: 'no hydration: a provisional Ciudad position is published at once', file: JOIN, from: 'return Boolean(session && !live && !restored && this.location().restores)', to: 'return false', test: ROOM_TEST },
  { id: 'M30', what: 'the stale writer is not disconnected', file: JOIN, from: '    client.leave(SESSION_REPLACED_CODE, SESSION_REPLACED)\n  }\n}', to: '  }\n}', test: ROOM_TEST },
  { id: 'M31', what: 'a fenced session is remembered for reconnects', file: ROOM, from: '      if (rememberable) reconnectingActors.remember(id, actor)', to: '      reconnectingActors.remember(id, actor)', test: ROOM_TEST },
  { id: 'M32', what: 'a late claim moves a player whose fallback was already published (R3)', file: JOIN, from: "if (location.restores && session.origin === 'fallback') this.#adopt(session, actor)", to: "if (location.restores && session.origin === 'fallback') { const place = restoreFromRow(result.location, { worldProtocol: session.worldProtocol }); if (place) Object.assign(actor, place); this.#adopt(session, actor) }", test: ROOM_TEST },
  { id: 'M33', what: 'the hydration timeout is not 1.5 s', file: SERVICE, from: 'export const HYDRATION_TIMEOUT_MS = 1_500', to: 'export const HYDRATION_TIMEOUT_MS = 3_000', test: ROOM_TEST },
  { id: 'M34', what: 'guests and synthetic ids persist', file: JOURNAL, from: "export const persistableIdentity = userId => typeof userId === 'string' && UUID.test(userId)", to: "export const persistableIdentity = userId => typeof userId === 'string'", test: ROOM_TEST },
  { id: 'M35', what: 'moves during hydration are accepted (actor visible early)', file: ROOM, from: "      locationJoin.hydrate(this, client, session, join)\n      return", to: "      locationJoin.hydrate(this, client, session, join)\n      actors.set(auth.userId, this.freshActor(auth, characterId))\n      return", test: ROOM_TEST },
  // Flag.
  { id: 'M36', what: 'the flag accepts loose values', file: SERVICE, from: "return LOCATION_MODES.includes(value) ? value : 'off'", to: "return LOCATION_MODES.includes(String(value).trim().toLowerCase()) ? String(value).trim().toLowerCase() : 'off'", test: FLAG_TEST },
  { id: 'M37', what: 'off still claims (rollback not immediate)', file: SERVICE, from: "this.effective = this.mode === 'off' ? 'off' : supportsLocation(store) ? this.mode : 'unavailable'", to: "this.effective = supportsLocation(store) ? (this.mode === 'off' ? 'shadow' : this.mode) : 'unavailable'", test: ROOM_TEST },
  // Load (found by the 100-player benchmark).
  { id: 'M39', what: 'two location batches per second (500 ms tick)', file: JOURNAL, from: 'export const LOCATION_TICK_MS = 1_000', to: 'export const LOCATION_TICK_MS = 500', test: FLAG_TEST },
  { id: 'M40', what: 'layout fingerprints computed on the first live save, not at start', file: SERVICE, from: '    if (this.active) for (const areaId of PERSISTABLE_AREAS) layoutVersion(areaId)\n', to: '', test: FLAG_TEST },
  // Review B1: shadow is not invasive.
  { id: 'M41', what: 'shadow disconnects a stale session (R1)', file: JOIN, from: '    if (!location.restores) { location.counters.shadow.wouldFence++; return }\n', to: '', test: ROOM_TEST },
  { id: 'M42', what: 'shadow keeps a stale session out of the reconnect cache', file: JOIN, from: 'return !(fenced && location.restores)', to: 'return !fenced', test: ROOM_TEST },
  { id: 'M43', what: 'shadow names the close reason of a local replacement', file: JOIN, from: 'if (this.location().restores) previous.leave(SESSION_REPLACED_CODE, SESSION_REPLACED)', to: 'if (this.location().active) previous.leave(SESSION_REPLACED_CODE, SESSION_REPLACED)', test: ROOM_TEST },
  // Review B2: abandoned or out-of-order claims.
  { id: 'M44', what: 'the claim is unconditional for an existing row (R2)', file: MIGRATION, from: 'WHERE user_id = p_user_id AND epoch = p_expected_epoch', to: 'WHERE user_id = p_user_id', tests: [
    expecting(DB_TEST, 'R2 in the database'),
    // Review 2 (F1): the room must catch it too, through the second-round zombie.
    expecting(ROOM_TEST, 'on, 1 instance(s): an abandoned second-round claim (UPDATE, expected = E)', { cause: /the zombie answers conflict/ }),
  ] },
  { id: 'M45', what: 'a claim expecting no row bumps an existing one', file: MIGRATION, from: 'ON CONFLICT (user_id) DO NOTHING', to: 'ON CONFLICT (user_id) DO UPDATE SET epoch = world_player_locations.epoch + 1, seq = 0', test: ROOM_TEST },
  { id: 'M46', what: 'a claim is sent for a session that ended or was replaced', file: JOURNAL, from: 'return !this.disabled && session.live && entry.session === session && this.entries.get(entry.userId) === entry', to: 'return !this.disabled', test: JOURNAL_TEST },
  { id: 'M47', what: 'an entry is forgotten while one of its claims is in flight (chain lost)', file: JOURNAL, from: "if (!entry.pending && !entry.session?.live && entry.claimsInFlight === 0 && this.entries.get(entry.userId) === entry)", to: "if (!entry.pending && !entry.session?.live && this.entries.get(entry.userId) === entry)", test: JOURNAL_TEST },
  { id: 'M48', what: 'a conflict is not followed by a claim after the current epoch', file: JOURNAL, from: "if (result?.status !== 'conflict') break", to: 'break', test: JOURNAL_TEST },
  { id: 'M49', what: 'world-authority passes a claim with no expected epoch', file: HANDLER, from: "        if (!Number.isSafeInteger(body.expectedEpoch) || (body.expectedEpoch as number) < 0) return json(400, { error: 'invalid_epoch' })\n", to: '', test: DENO_TEST },
  // The whole give-up is removed (no orphan timer left to reject unhandled): the claim simply waits on the store.
  { id: 'M50', what: 'the journal waits on a hung claim forever', file: JOURNAL, from: "    const giveUp = new Promise((_, reject) => {\n      timer = setTimeout(() => reject(new Error('claim abandoned')), this.claimWaitMs)\n      timer.unref?.()\n    })\n    try {\n      return await Promise.race([this.store.locationClaim(userId, expectedEpoch), giveUp])", to: '    try {\n      return await this.store.locationClaim(userId, expectedEpoch)', test: expecting(node('--test-timeout=8000', 'src/presence/locationJournal.test.js'), 'a claim given up (claimWaitMs) that lands in the store late', { first: true, cause: /a claim on a hung store did not settle within 2000 ms/ }) },
  // Review B3: a late claim never moves a published player.
  { id: 'M51', what: 'an adopted position is not saved at once (the old row could come back)', file: JOIN, from: 'location.note(session, actor, { urgent: true })', to: 'location.note(session, actor)', test: ROOM_TEST },
  // Review M2: Pradera's version covers its whole canonical data.
  { id: 'M52', what: "Pradera's authored layer is not hashed", file: LAYOUT, from: "authored: [...AUTHORED_DECOR].filter(([key]) => key.startsWith('pradera:'))", to: "authored: [...AUTHORED_DECOR].filter(([key]) => key.startsWith('pradera:-'))", test: LAYOUT_TEST },
  { id: 'M53', what: 'a generator edit far from every authored place, without a new generator version', file: TERRAIN, from: "if (r < 0.03) return 'tree'", to: "if (r < 0.031) return 'tree'", test: LAYOUT_TEST },
  { id: 'M54', what: 'the generator version is left out of the layout version', file: LAYOUT, from: "areaId: 'pradera', generator: TERRAIN_GENERATOR_VERSION, seed:", to: "areaId: 'pradera', seed:", test: LAYOUT_TEST },
  // Layout versions are frozen.
  { id: 'M38', what: 'a cave map change without a new frozen version', file: `${RT}src/world/caveLayouts.js`, from: "  '##....###.....##...##',\n  '##....###.....##...##',", to: "  '##....###.....##...##',\n  '##....##......##...##',", test: LAYOUT_TEST },
]

function git(...args) { return spawnSync('git', args, { cwd: root, encoding: 'utf8' }) }
const clean = () => git('status', '--porcelain', '--untracked-files=no', '--', 'supabase', 'services', 'scripts').stdout.trim() === ''

const wanted = new Set(process.argv.slice(2))
const selected = MUTATIONS.filter(m => wanted.size === 0 || wanted.has(m.id))
if (!clean()) { console.error('the tree is not clean: commit or stash first'); process.exit(2) }

const results = []
for (const m of selected) {
  const path = `${root}${m.file}`
  const original = readFileSync(path)
  const text = original.toString('utf8').replace(/\r\n/g, '\n')
  const count = text.split(m.from).length - 1
  if (count !== 1) { results.push({ id: m.id, caught: false, error: `pattern found ${count} times` }); console.log(`${m.id} PATTERN ${count}x — ${m.what}`); continue }
  writeFileSync(path, text.replace(m.from, m.to))
  const started = Date.now()
  const runs = []
  try {
    for (const test of m.tests ?? [m.test]) runs.push(judge(test, spawnSync(test.cmd, test.args, { cwd: test.cwd, encoding: 'utf8', timeout: 240_000, shell: test.cmd === 'deno' })))
  } finally {
    writeFileSync(path, original)
  }
  const caught = runs.every(r => r.caught)
  const timedOut = runs.some(r => r.timedOut)
  results.push({ id: m.id, what: m.what, caught, timedOut, runs, ms: Date.now() - started })
  const label = caught ? 'CAUGHT' : timedOut ? 'TIMED OUT (not caught)' : 'MISSED'
  console.log(`${m.id} ${label} (${Math.round((Date.now() - started) / 1000)} s) — ${m.what} → ${runs.map(r => r.firstFailure ?? r.why ?? '?').join(' | ')}`)
}

/** One test command's verdict. A run the runner had to kill is never a catch. */
function judge(test, run) {
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`
  const timedOut = run.error?.code === 'ETIMEDOUT' || run.signal !== null
  const failures = [...new Set([
    ...[...out.matchAll(/^✖ (?!failing tests)(.+?) \(\d/gmu)].map(match => match[1].trim()),
    ...[...out.matchAll(/^(.+?) \.\.\. .*FAILED/gmu)].map(match => match[1].trim()),
  ])]
  const firstFailure = failures[0] ?? null
  let why = null
  if (timedOut) why = 'killed at the runner deadline'
  else if (run.status === 0) why = 'the tests passed'
  else if (test.expect && test.first && !firstFailure?.startsWith(test.expect)) why = `first failure is not "${test.expect}"`
  else if (test.expect && !failures.some(name => name.startsWith(test.expect))) why = `"${test.expect}" did not fail`
  else if (test.cause && !test.cause.test(out)) why = `cause ${test.cause} not in the output`
  return { caught: why === null, timedOut, exit: run.status, signal: run.signal, firstFailure, expect: test.expect ?? null, why }
}
const restored = clean()
const caught = results.filter(r => r.caught).length
console.log(JSON.stringify({ total: results.length, caught, restored, results }, null, 2))
process.exit(caught === results.length && restored ? 0 : 1)
