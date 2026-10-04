// WORLD LOCATION-4 F2 — the Postgres concurrency battery (README.md in this folder).
//
//   node scripts/world-location/postgres-concurrency/run.mjs --container supabase_db_<id> --build original
//        [--rounds 10] [--only A1,A5] [--out <file.json>]
//
// --build is what the database is EXPECTED to run (original | rv1 | rv2); it is checked against the
// stored function bodies before anything runs.
//
// Exit codes: 0 PASS (the build behaved as expected: original → no violation; rv1/rv2 → caught by
// exactly its detecting scenarios in every round) · 1 FAIL · 2 BLOCKED (no local Postgres, wrong
// build, or any harness_error / deadlock: never reported as PASS, never counted as a detection).
//
// Connections: the harness connects as the LOCAL stack's `postgres` role (psql inside the db
// container) — privileged, for three things only: synthetic fixtures (auth.users rows with
// @example.test addresses), observation (pg_stat_activity waits, pg_proc bodies, host and location
// rows), and stopping the hosts this run created. Every operation under test runs as service_role.

import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { BUILDS, BlockedError, assertLocalContainer, liveBuild } from './localDatabase.mjs'
import { PgSession, sleep, withDeadline } from './pgSession.mjs'
import { SCENARIOS } from './scenarios.mjs'
import { judgeRun, outcomeOf } from './judge.mjs'

const SCENARIO_MS = 60_000

function parseArgs(argv) {
  const args = { rounds: 10, only: [] }
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split('=')
    const value = () => inline ?? argv[++i]
    if (flag === '--container') args.container = value()
    else if (flag === '--build') args.build = value()
    else if (flag === '--rounds') args.rounds = Number(value())
    else if (flag === '--only') args.only = value().split(',').filter(Boolean)
    else if (flag === '--out') args.out = value()
    else throw new BlockedError(`unknown argument ${argv[i]}`)
  }
  if (!BUILDS.includes(args.build)) throw new BlockedError(`--build must be one of ${BUILDS.join(', ')}`)
  if (!Number.isInteger(args.rounds) || args.rounds < 1) throw new BlockedError('--rounds must be a positive integer')
  for (const id of args.only) if (!SCENARIOS[id]) throw new BlockedError(`unknown scenario ${id}`)
  return args
}

const live = new Set() // every open session, for the exit path

async function main() {
  const args = parseArgs(process.argv.slice(2))
  assertLocalContainer(args.container)
  const found = liveBuild(args.container)
  if (found !== args.build) throw new BlockedError(`${args.container} runs ${found}, not ${args.build}: prepare it with prepare.mjs migrate --build ${args.build}`)

  const open = async (name, role) => {
    const s = new PgSession(args.container, name)
    live.add(s)
    try { return await s.init(role) } catch (e) { await s.close(); live.delete(s); throw e }
  }
  const mon = await open('observer', null)
  const deadlocks = async () => Number(await mon.one('SELECT deadlocks FROM pg_stat_database WHERE datname = current_database();'))
  const pgVersion = await mon.one('SHOW server_version;')
  const isolation = await mon.one('SHOW default_transaction_isolation;')
  const deadlocksBefore = await deadlocks()

  const ids = args.only.length ? args.only : Object.keys(SCENARIOS)
  const results = []
  for (let round = 1; round <= args.rounds; round++) {
    for (const scenario of ids) {
      const ctx = {
        mon, sessions: [], hosts: [], notes: [],
        note: text => ctx.notes.push(text),
        open: async (name, role = 'service_role') => { const s = await open(`${scenario}/${name}`, role); ctx.sessions.push(s); return s },
        newUser: () => mon.one(`INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
          VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
                  'wloc-f2-' || substr(md5(random()::text), 1, 12) || '@example.test', now(), now()) RETURNING id;`),
        hostRow: g => mon.json(`SELECT jsonb_build_object('state', state, 'activated_at', activated_at) FROM public.world_presence_hosts WHERE generation = ${g};`),
        locRow: u => mon.json(`SELECT jsonb_build_object('owner_generation', owner_generation, 'owner_seq', owner_seq, 'owner_session', owner_session, 'epoch', epoch, 'tx', tx) FROM public.world_player_locations WHERE user_id = '${u}';`),
        ownedBy: g => mon.one(`SELECT count(*) FROM public.world_player_locations WHERE owner_generation = ${g};`).then(Number),
      }
      const started = Date.now()
      let error = null
      try { await withDeadline(SCENARIOS[scenario].run(ctx), SCENARIO_MS, scenario) } catch (e) { error = e }
      // A cleanup that fails is infrastructure, whatever the scenario said (never a detection).
      try { await cleanup(mon, ctx) } catch (e) { error = e }
      const outcome = outcomeOf(error, assert.AssertionError)
      const detail = error ? `${error.constructor.name}: ${error.message.split('\n')[0]}` : ''
      results.push({ round, scenario, outcome, ms: Date.now() - started, detail, notes: ctx.notes })
      console.log(`[${args.build}] round ${round} ${scenario}: ${outcome}${detail ? ` — ${detail}` : ''}`)
    }
  }
  const deadlocksDuringRun = (await deadlocks()) - deadlocksBefore
  await closeAll()

  const judged = judgeRun(args.build, results, ids)
  if (deadlocksDuringRun > 0) { judged.reasons.push(`${deadlocksDuringRun} deadlock(s) reported by Postgres during the run`); judged.verdict = 'BLOCKED' }
  const report = {
    battery: 'WORLD LOCATION-4 F2 postgres concurrency', build: args.build, rounds: args.rounds, scenarios: ids,
    postgres: pgVersion, isolation, deadlocksDuringRun, verdict: judged.verdict, reasons: judged.reasons, table: judged.table, results,
  }
  console.log('\nscenario  pass  violation  harness_error')
  for (const [id, t] of Object.entries(judged.table)) console.log(`${id.padEnd(8)}  ${String(t.pass).padStart(4)}  ${String(t.violation).padStart(9)}  ${String(t.harness_error).padStart(13)}   ${SCENARIOS[id].title}`)
  console.log(`\nPostgres ${pgVersion} (${isolation}) · deadlocks during the run: ${deadlocksDuringRun}`)
  console.log(`${judged.verdict} (${args.build}, ${args.rounds} round(s))${judged.reasons.length ? '\n  - ' + judged.reasons.join('\n  - ') : ''}`)
  if (args.out) writeFileSync(args.out, JSON.stringify(report, null, 1) + '\n')
  return { PASS: 0, FAIL: 1, BLOCKED: 2 }[judged.verdict]
}

/** Ends a scenario: its sessions closed (stuck backends terminated), its hosts stopped. */
async function cleanup(mon, ctx) {
  const pids = ctx.sessions.map(s => s.pid).filter(Boolean)
  for (const s of ctx.sessions) { await Promise.race([s.send('ROLLBACK;'), sleep(1_000)]); await s.close(); live.delete(s) }
  if (pids.length) await mon.one(`SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE pid IN (${pids.join(',')});`)
  if (ctx.hosts.length) await mon.one(`UPDATE public.world_presence_hosts SET state = 'stopped', stopped_at = now() WHERE generation IN (${ctx.hosts.join(',')}) AND state <> 'stopped';`)
}

async function closeAll() {
  await Promise.all([...live].map(s => s.close()))
  live.clear()
}

process.on('SIGINT', () => { closeAll().finally(() => process.exit(130)) })

main().then(code => { process.exitCode = code }, async error => {
  await closeAll()
  const blocked = error instanceof BlockedError
  console.error(`${blocked ? 'BLOCKED' : 'BLOCKED (harness)'}: ${error.message}`)
  process.exitCode = 2
})
