// WORLD LOCATION-4 — negative controls for the distributed ordering. Each protection is broken on
// purpose, its test runs and MUST fail (the named test among the failures), and the file is
// restored byte for byte. The tree must be clean before and after (checked with git).
//
//   node scripts/world-location/ordering-mutations.mjs            all
//   node scripts/world-location/ordering-mutations.mjs O3 O12     some
//
// Exit 0 only if every mutation was caught and the tree is restored. Same contract as
// scripts/world-location/mutations.mjs (WORLD LOCATION-2), for the new layers.

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const RT = 'services/realtime/'
const node = (...files) => ({ cwd: `${root}${RT}`, cmd: process.execPath, args: ['--test', '--test-reporter=spec', '--test-timeout=60000', ...files] })
const deno = file => ({ cwd: root, cmd: 'deno', args: ['test', file] })
const expecting = (command, expect) => ({ ...command, expect })

const MIGRATION = 'supabase/migrations/20261003120000_world_location_ordering.sql'
const HANDLER = 'supabase/functions/world-authority/handler.ts'
const DENO_TEST = name => expecting(deno('supabase/functions/world-authority/handler.test.ts'), name)
const HOST = `${RT}src/presence/hostLifecycle.js`
const ROOM = `${RT}src/rooms/PresenceRoom.js`
const HOST_TEST = name => expecting(node('src/presence/hostLifecycle.test.js'), name)
const ROOM_HOST_TEST = name => expecting(node('src/rooms/PresenceRoomHost.test.js'), name)
const JOURNAL = `${RT}src/presence/locationJournal.js`
const JOIN = `${RT}src/rooms/locationJoin.js`
const JOURNAL_TEST = name => expecting(node('src/presence/locationJournal.test.js'), name)
const ROOM_TEST = name => expecting(node('src/rooms/PresenceRoomLocation.test.js'), name)
const CLOSE_TEST = name => expecting(node('src/rooms/PresenceRoomClose.test.js'), name)
const BOOT_TEST = name => expecting(node('src/realtimeServer.test.js'), name)
const DB = file => `src/world/persistence/${file}`
const DB_TEST = name => expecting(node(DB('worldLocationOrdering.database.test.js')), name)

export const MUTATIONS = [
  // ── SQL: host lifecycle (C1) ──
  { id: 'O1', what: 'acquire creates an active host (no starting state)', file: MIGRATION,
    from: "state            text        NOT NULL DEFAULT 'starting'", to: "state            text        NOT NULL DEFAULT 'active'",
    test: DB_TEST('acquire: a new host starts in starting') },
  { id: 'O2', what: 'acquire is not idempotent (a retry rewrites the row)', file: MIGRATION,
    from: '  ON CONFLICT (host_id) DO NOTHING;\n  SELECT * INTO v FROM public.world_presence_hosts WHERE host_id = p_host_id;',
    to: '  ON CONFLICT (host_id) DO UPDATE SET lease_expires_at = EXCLUDED.lease_expires_at;\n  SELECT * INTO v FROM public.world_presence_hosts WHERE host_id = p_host_id;',
    test: DB_TEST('acquire: a new host starts in starting') },
  { id: 'O3', what: 'activate does not check the state (draining/stopped reactivate)', file: MIGRATION,
    from: "  IF v.state <> 'starting' THEN RETURN jsonb_build_object('status', 'host_inactive', 'state', v.state); END IF;\n",
    to: '', test: DB_TEST('draining never returns to active') },
  { id: 'O4', what: 'activate ignores an expired starting lease (a hung candidate activates)', file: MIGRATION,
    from: "  IF v.lease_expires_at <= now() THEN RETURN jsonb_build_object('status', 'host_expired', 'state', v.state); END IF;\n",
    to: '', test: DB_TEST('activate: only from starting') },
  { id: 'O5', what: 'activate over a newer active host', file: MIGRATION,
    from: "    RETURN jsonb_build_object('status', 'newer_active');\n  END IF;\n", to: "    NULL;\n  END IF;\n",
    test: DB_TEST('activate: only from starting') },
  { id: 'O6', what: 'newerActive counts starting candidates (a candidate drains the active host)', file: MIGRATION,
    from: "  v_newer := EXISTS (SELECT 1 FROM public.world_presence_hosts h\n                      WHERE h.generation > p_generation AND h.state = 'active'",
    to: "  v_newer := EXISTS (SELECT 1 FROM public.world_presence_hosts h\n                      WHERE h.generation > p_generation AND h.state IN ('active', 'starting')",
    test: DB_TEST('newerActive counts only active hosts') },
  { id: 'O7', what: 'renew extends the drain window', file: MIGRATION,
    from: "  IF v.state = 'starting' OR (v.state = 'active'", to: "  IF v.state IN ('starting', 'draining') OR (v.state = 'active'",
    test: DB_TEST('renew never changes the state') },
  { id: 'O8', what: 'renew revives an expired active host although a newer one is active', file: MIGRATION,
    from: " OR (v.state = 'active' AND NOT (v.lease_expires_at <= now() AND v_newer))", to: " OR v.state = 'active'",
    test: DB_TEST('renew never changes the state') },
  { id: 'O9', what: 'drain moves a stopped host back to draining', file: MIGRATION,
    from: "  ELSIF v.state = 'draining' THEN\n    RETURN jsonb_build_object('status', 'ok', 'state', 'draining');\n  END IF;\n  RETURN jsonb_build_object('status', 'host_inactive', 'state', 'stopped');",
    to: "  END IF;\n  RETURN jsonb_build_object('status', 'ok', 'state', 'draining');",
    test: DB_TEST('draining never returns to active') },
  // ── SQL: state-gated claims and saves (C2) ──
  { id: 'O10', what: 'a claim from a starting/draining/stopped host is accepted', file: MIGRATION,
    from: "  IF h.state <> 'active' THEN RETURN jsonb_build_object('status', 'host_inactive', 'state', h.state); END IF;\n",
    to: '', test: DB_TEST('claims fail closed unless the host is active') },
  { id: 'O11', what: 'a claim from a host whose lease ran out is accepted', file: MIGRATION,
    from: "  IF h.lease_expires_at <= now() THEN RETURN jsonb_build_object('status', 'host_expired'); END IF;\n",
    to: '', test: DB_TEST('claims fail closed unless the host is active') },
  { id: 'O12', what: 'a claim checks the generation only, not the host id', file: MIGRATION,
    from: "  SELECT * INTO h FROM public.world_presence_hosts WHERE generation = p_generation AND host_id = p_host_id FOR SHARE;\n  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'unknown_host'); END IF;\n  IF h.state <> 'active'",
    to: "  SELECT * INTO h FROM public.world_presence_hosts WHERE generation = p_generation FOR SHARE;\n  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'unknown_host'); END IF;\n  IF h.state <> 'active'",
    test: DB_TEST('claims fail closed unless the host is active') },
  { id: 'O13', what: 'an equal key takes the row again (a retry bumps the epoch)', file: MIGRATION,
    from: '           < (EXCLUDED.owner_generation, EXCLUDED.owner_seq)', to: '           <= (EXCLUDED.owner_generation, EXCLUDED.owner_seq)',
    test: DB_TEST('claim: a lost answer retried adopts') },
  { id: 'O14', what: 'a smaller key takes the row (last claim wins: T3/T4/T7 again)', file: MIGRATION,
    from: '           < (EXCLUDED.owner_generation, EXCLUDED.owner_seq)', to: '           <> (EXCLUDED.owner_generation, EXCLUDED.owner_seq)',
    test: DB_TEST('claim: a greater key takes the row') },
  { id: 'O15', what: 'the same key from another session is adopted', file: MIGRATION,
    from: "      IF v_row.owner_session IS DISTINCT FROM p_session THEN RAISE EXCEPTION 'key_reused'; END IF;\n", to: '',
    test: DB_TEST('claim: a lost answer retried adopts') },
  { id: 'O16', what: 'a starting host can save', file: MIGRATION,
    from: "  IF h.state IN ('starting', 'stopped') THEN", to: "  IF h.state IN ('stopped') THEN",
    test: DB_TEST('saves from a starting, expired') },
  { id: 'O17', what: 'a save ignores the lease', file: MIGRATION,
    from: "  IF h.lease_expires_at <= now() THEN RETURN jsonb_build_object('status', 'host_expired', 'state', h.state); END IF;\n\n  IF jsonb_typeof",
    to: "\n  IF jsonb_typeof", test: DB_TEST('saves: active normal; draining only') },
  { id: 'O18', what: 'a save ignores ownership (a draining host writes a row it lost, epoch guessed)', file: MIGRATION,
    from: 'AND seq < v_seq AND owner_generation = p_generation;', to: 'AND seq < v_seq;',
    test: DB_TEST('saves: active normal; draining only') },
  // ── SQL: v1 closed against keyed rows ──
  { id: 'O19', what: 'a v1 claim takes a keyed row', file: MIGRATION,
    from: 'AND epoch = p_expected_epoch AND owner_generation = 0', to: 'AND epoch = p_expected_epoch',
    test: DB_TEST('v1 still works on rows no keyed session owns') },
  { id: 'O20', what: 'a v1 save writes a keyed row', file: MIGRATION,
    from: 'AND seq < v_seq AND owner_generation = 0;', to: 'AND seq < v_seq;',
    test: DB_TEST('v1 still works on rows no keyed session owns') },
  // ── SQL: privileges (C3) ──
  { id: 'O21', what: 'the sequence keeps Supabase default privileges', file: MIGRATION,
    from: 'REVOKE ALL ON SEQUENCE public.world_presence_generation_seq FROM PUBLIC, anon, authenticated, service_role;\n', to: '',
    test: DB_TEST('privileges: anon, authenticated and PUBLIC cannot touch') },
  { id: 'O22', what: 'the hosts table keeps Supabase default privileges', file: MIGRATION,
    from: 'REVOKE ALL ON TABLE public.world_presence_hosts FROM PUBLIC, anon, authenticated, service_role;\n', to: '',
    test: DB_TEST('privileges: anon, authenticated and PUBLIC cannot touch') },
  { id: 'O23', what: 'acquire keeps the default EXECUTE (PUBLIC, anon, authenticated)', file: MIGRATION,
    from: 'REVOKE ALL ON FUNCTION public.world_presence_acquire(uuid, integer) FROM PUBLIC, anon, authenticated, service_role;\n', to: '',
    // Defence in depth: an INVOKER function still hits the table REVOKE, so the role test passes; the catalog check catches it.
    test: DB_TEST('catalog: the ordering grants check returns zero rows') },
  { id: 'O24', what: 'service_role cannot nextval (no USAGE on the sequence)', file: MIGRATION,
    from: 'GRANT USAGE ON SEQUENCE public.world_presence_generation_seq TO service_role;\n', to: '',
    test: DB_TEST('privileges: service_role does everything') },
  { id: 'O25', what: 'RLS off on the hosts table', file: MIGRATION,
    from: 'ALTER TABLE public.world_presence_hosts ENABLE ROW LEVEL SECURITY;', to: '-- (mutated: RLS off)',
    test: DB_TEST('catalog: the ordering grants check returns zero rows') },
  // ── Edge Function: the v5 contract validates before the database ──
  { id: 'E1', what: 'a keyed claim also carrying a v1 expectedEpoch is accepted', file: HANDLER,
    from: "  if ('expectedEpoch' in body) return json(400, { error: 'mixed_claim' })\n", to: '',
    test: DENO_TEST('location_claim (keyed): any missing or malformed key field') },
  { id: 'E2', what: 'a keyed claim without a session id reaches SQL', file: HANDLER,
    from: " || !uuid(body.sessionId)) return json(400, { error: 'invalid_key' })", to: ") return json(400, { error: 'invalid_key' })",
    test: DENO_TEST('location_claim (keyed): any missing or malformed key field') },
  { id: 'E3', what: 'a keyed save without its host reaches SQL', file: HANDLER,
    from: "  const host = hostArgs(body)\n  if (!host) return json(400, { error: 'invalid_host' })\n  const rows = locationRows(body.rows)",
    to: "  const host = hostArgs(body)\n  const rows = locationRows(body.rows)",
    test: DENO_TEST('location_save (keyed): the writing host travels') },
  { id: 'E4', what: 'presence_acquire accepts any lease', file: HANDLER,
    from: "if (!uuid(body.hostId) || !within(body.leaseMs, LEASE_MIN_MS, LEASE_MAX_MS)) return json(400, { error: 'invalid_host' })\n    return json(200, await call('world_presence_acquire'",
    to: "if (!uuid(body.hostId)) return json(400, { error: 'invalid_host' })\n    return json(200, await call('world_presence_acquire'",
    test: DENO_TEST('a malformed host, lease or drain window is refused') },
  // ── Realtime: host lifecycle (C1) ──
  { id: 'H1', what: 'a starting host hands out session keys (claims before activation)', file: HOST,
    from: "    if (this.state !== 'active') return null\n    this.counters.keys++", to: '    this.counters.keys++',
    test: HOST_TEST('acquire before listen') },
  { id: 'H2', what: 'newerActive is reported again on every answer (repeated drains)', file: HOST,
    from: 'if (answer.newerActive === true && !this.newerSeen) {', to: 'if (answer.newerActive === true) {',
    test: HOST_TEST('refused answers end or pause') },
  { id: 'H3', what: 'a refused activation is taken as active (newer_active ignored)', file: HOST,
    from: "      if (answer?.status === 'active') {\n        this.state = 'active'", to: "      if (answer) {\n        this.state = 'active'",
    test: HOST_TEST('two concurrent candidates') },
  { id: 'H4', what: 'joins are admitted before the host is active', file: ROOM,
    from: "    if (host && !host.admitting && !(await host.whenActive(ACTIVATION_WAIT_MS))) throw new ServerError(HOST_DRAINING_CODE, 'host-draining')\n", to: '',
    test: ROOM_HOST_TEST('a join that arrives before activation waits') },
  { id: 'H5', what: 'a starting host admits joins', file: HOST,
    from: "get admitting() { return this.state === 'active' || this.state === 'unavailable' }", to: "get admitting() { return this.state === 'active' || this.state === 'unavailable' || this.state === 'starting' }",
    test: HOST_TEST('acquire before listen') },
  { id: 'H6', what: 'a draining host tries to activate again', file: HOST,
    from: "  async activate() {\n    if (this.state !== 'starting') return this.state", to: "  async activate() {\n    if (this.state === 'active') return this.state",
    test: HOST_TEST('a newer active host: the old one learns') },
  // ── Realtime: keyed journal (ordering) ──
  { id: 'J1', what: 'superseded is not final (the session keeps claiming)', file: JOURNAL,
    from: "      this.counters.claims.outranked++\n      entry.status = 'superseded'", to: "      this.counters.claims.outranked++\n      entry.status = 'unclaimed'",
    test: JOURNAL_TEST('superseded is final') },
  { id: 'J2', what: 'a retry asks the host for a new key (re-read: T4 again)', file: JOURNAL,
    from: '    if (counted) this.counters.claims.failed++', to: '    if (counted) this.counters.claims.failed++\n    if (this.host?.sessionKey) { const fresh = this.host.sessionKey(); if (fresh) session.key = fresh }',
    test: JOURNAL_TEST('T4 (old claim abandoned, lands late, retried)') },
  { id: 'J3', what: 'claims are sent while the host cannot claim', file: JOURNAL,
    from: ' && this.entries.get(entry.userId) === entry && Boolean(this.host?.canClaim)', to: ' && this.entries.get(entry.userId) === entry',
    test: JOURNAL_TEST('a claim is never sent while the host cannot claim') },
  { id: 'J4', what: 'saves are sent while the host cannot save', file: JOURNAL,
    from: '    if (!this.host?.canSave) return null\n    const due = []', to: '    const due = []',
    test: JOURNAL_TEST('a host that cannot save sends nothing') },
  { id: 'J5', what: 'newerActive in a save answer is ignored', file: JOURNAL,
    from: '    if (answer.newerActive) this.host.observe?.({ newerActive: true })\n', to: '',
    test: JOURNAL_TEST('newerActive in any answer reaches the host once') },
  // ── Realtime: the room reacts to a superseded claim ──
  { id: 'R1', what: 'on: a superseded session keeps playing (never closed)', file: JOIN,
    from: "    location.counters.supersededDisconnects++\n    this.closeReplaced(client, { named: true })\n  }\n\n  #supersededWhileHydrating", to: "    location.counters.supersededDisconnects++\n  }\n\n  #supersededWhileHydrating",
    test: ROOM_TEST('on: T4 in the room') },
  { id: 'R3', what: 'on: a session superseded while hydrating is not closed', file: JOIN,
    from: '    if (this.clientsByActor.get(pending.join.auth.userId) === client) this.closeReplaced(client, { named: true })\n', to: '',
    test: ROOM_TEST('on: T3 in the room') },
  { id: 'R2', what: 'shadow: a superseded session is disconnected (shadow becomes invasive)', file: JOIN,
    from: '    if (!location.restores) { location.counters.shadow.wouldReplace++; return }\n', to: '',
    test: ROOM_TEST('shadow: T3 in the room') },
  // ── Realtime: drain and close codes (design §5) ──
  { id: 'C1', what: 'shutdown keeps Colyseus\' default close (4001 SERVER_SHUTDOWN): clients stop as replaced', file: ROOM,
    from: '  onBeforeShutdown() {\n', to: '  onBeforeShutdownDisabled() {\n',
    test: BOOT_TEST('bootstrap:') },
  { id: 'C2', what: 'a protocol-3 client is replaced with the legacy 4001', file: ROOM,
    from: '  if (modern(client)) client.leave(SESSION_REPLACED_CODE, SESSION_REPLACED)\n  else if (named)', to: '  if (named)',
    test: CLOSE_TEST('replacement:') },
  { id: 'C3', what: 'a resume from another tab displaces the live session', file: ROOM,
    from: "      if (previous && tabOf.get(previous) !== tabId) { metrics.rejected('resume'); throw new ServerError(SESSION_REPLACED_CODE, 'session-replaced') }\n", to: '',
    test: CLOSE_TEST('resume:') },
  { id: 'C4', what: 'movement is accepted while draining', file: ROOM,
    from: '  move(client, payload) {\n    if (draining) return this.frozen(client)\n', to: '  move(client, payload) {\n',
    test: CLOSE_TEST('drain:') },
  { id: 'C5', what: 'shadow drains on a newer host (shadow becomes invasive)', file: ROOM,
    from: '  if (!location.restores) { location.counters.shadow.wouldDrain++; return }\n', to: '',
    test: CLOSE_TEST('shadow: a newer active host') },
  { id: 'C6', what: 'on: a newer active host is ignored (two hosts keep serving)', file: ROOM,
    from: '    next.onNewerActive = () => { void drainForHostChange() }\n', to: '',
    test: CLOSE_TEST('on: a newer active host') },
  // ── Realtime: shutdown log (design L1) ──
  { id: 'L1', what: 'rows refused because another session owns them are reported as saved', file: `${RT}src/presence/shutdownSummary.js`,
    from: "    saved: sum('applied') + sum('duplicate'),", to: "    saved: sum('applied') + sum('duplicate') + sum('stale'),",
    test: expecting(node('src/presence/shutdownSummary.test.js'), 'L1: a flush whose only row is stale') },
  { id: 'L2', what: 'rows dropped by an inactive host are not reported', file: JOURNAL,
    from: 'this.counters.dropped.hostInactive++; counts.hostRefused++;', to: 'this.counters.dropped.hostInactive++;',
    test: JOURNAL_TEST('saves follow the host') },
]

function git(...args) { return spawnSync('git', args, { cwd: root, encoding: 'utf8' }) }
const clean = () => git('status', '--porcelain', '--untracked-files=no', '--', 'supabase', 'services', 'scripts', 'src').stdout.trim() === ''

/** One test command's verdict. A run the runner had to kill is never a catch. */
function judge(test, run) {
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`
  const timedOut = run.error?.code === 'ETIMEDOUT' || run.signal !== null
  const failures = [...new Set([
    ...[...out.matchAll(/^\s*✖ (?!failing tests)(.+?) \(\d/gmu)].map(match => match[1].trim()),
    ...[...out.matchAll(/^(.+?) \.\.\. .*FAILED/gmu)].map(match => match[1].trim()),
    ...[...out.matchAll(/^\s*(?:FAIL|×)\s+(.+?)(?:\s+\d+ms)?$/gmu)].map(match => match[1].trim()),
  ])]
  let why = null
  if (timedOut) why = 'killed at the runner deadline'
  else if (run.status === 0) why = 'the tests passed'
  else if (test.expect && !failures.some(name => name.includes(test.expect))) why = `"${test.expect}" did not fail (failures: ${failures.slice(0, 3).join(' | ') || 'none parsed'})`
  return { caught: why === null, timedOut, exit: run.status, firstFailure: failures[0] ?? null, why }
}

export function runMutations(list, { label = 'ordering' } = {}) {
  if (!clean()) { console.error('the tree is not clean: commit or stash first'); process.exit(2) }
  const results = []
  for (const m of list) {
    const path = `${root}${m.file}`
    const original = readFileSync(path)
    const text = original.toString('utf8').replace(/\r\n/g, '\n')
    const count = text.split(m.from).length - 1
    if (count !== 1) { results.push({ id: m.id, caught: false, why: `pattern found ${count} times` }); console.log(`${m.id} PATTERN ${count}x — ${m.what}`); continue }
    writeFileSync(path, text.replace(m.from, m.to))
    const started = Date.now()
    const runs = []
    try {
      for (const test of m.tests ?? [m.test]) runs.push(judge(test, spawnSync(test.cmd, test.args, { cwd: test.cwd, encoding: 'utf8', timeout: 300_000, shell: test.cmd === 'deno' || test.shell === true })))
    } finally {
      writeFileSync(path, original)
    }
    const caught = runs.every(r => r.caught)
    results.push({ id: m.id, what: m.what, caught, runs, ms: Date.now() - started })
    console.log(`${m.id} ${caught ? 'CAUGHT' : 'MISSED'} (${Math.round((Date.now() - started) / 1000)} s) — ${m.what} → ${runs.map(r => r.why ?? r.firstFailure ?? '?').join(' | ')}`)
  }
  const restored = clean()
  const caught = results.filter(r => r.caught).length
  console.log(JSON.stringify({ label, total: results.length, caught, restored, missed: results.filter(r => !r.caught).map(r => r.id) }))
  return caught === results.length && restored
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const wanted = new Set(process.argv.slice(2))
  const ok = runMutations(MUTATIONS.filter(m => wanted.size === 0 || wanted.has(m.id)))
  process.exit(ok ? 0 : 1)
}
