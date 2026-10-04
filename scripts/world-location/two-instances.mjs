// WORLD LOCATION-2/4 — two real realtime PROCESSES, one location store (LOCAL ONLY).
//
//   node scripts/world-location/two-instances.mjs
//
// What runs, and what is simulated:
//   - unmodified `services/realtime/src/index.js` processes, each with
//     WORLD_LOCATION_PERSISTENCE=on and the Edge adapter, each a presence host
//     (WORLD LOCATION-4: acquire before listen, activate after);
//   - ONE authority in this process (localAuthority.mjs): the real world-authority
//     handler over an embedded Postgres (PGlite) running the real migrations;
//   - a stand-in for Supabase Auth's /auth/v1/user and empty REST reads.
// Clients are real @colyseus/sdk sockets that authenticate like a browser (an
// allowed Origin and a token); no benchmark identity, no production bypass.
//
// Scenario (a deploy rehearsal; Colyseus Cloud itself must still be verified):
//   1. A serves the player, who crosses Ciudad → Pradera (urgent save).
//   2. B starts while A is still alive (a deploy overlap): B's host is newer. The
//      player's new socket lands on B and is restored in Pradera from the row.
//   3. A learns of the newer host (its next renewal or authority answer) and drains:
//      the old socket is closed with 4503 (or 4409 if its save was refused first),
//      never 4001; its host is stopped and the process stays alive refusing joins
//      with 4503 (it never exits on its own). The row keeps B's state.
//   4. A dies hard. The player on B crosses back to Ciudad (saved).
//   5. B dies hard (its lease simply runs out); a fresh B' starts and restores the
//      player at B's last saved tile.
//   6. Abandoned claim: a second player joins B' but its claim hangs in the
//      authority; B' gives up (1.5 s), places it at Ciudad, the socket goes. The
//      player joins a fresh A' (a newer host) and claims. Only then does the
//      abandoned claim run in the database: it is superseded and writes nothing.
//      A' keeps writing: no stale, no close.
// Exit code 0 only if every check passes. Prints a JSON summary.

import { randomBytes } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { startLocalAuthority } from './localAuthority.mjs'
import { connect, delay, startRealtime } from './realtimeProcesses.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const realtime = `${root}services/realtime/src/`
const { routeBetween } = await import(pathToFileURL(`${realtime}world/testing.js`).href)
const { portalTo } = await import(pathToFileURL(`${realtime}world/navigation.js`).href)
const { ARRIVALS, TOWN_FROM_PRADERA } = await import(pathToFileURL(`${realtime}protocol/arrival.js`).href)

const checks = []
const check = (name, ok, detail = '') => { checks.push({ name, ok: Boolean(ok), detail }); if (!ok) console.error(`FAIL ${name} ${detail}`) }

const local = await startLocalAuthority({ secret: randomBytes(24).toString('hex') })
const { query } = local
const start = (name, port) => startRealtime({ name, port, env: local.env('on', name) })

async function walkTo(state, to) {
  const route = routeBetween(state.self.areaId, state.self, to)
  if (!route) throw new Error(`no route to ${to.tx},${to.ty}`)
  for (const direction of route) {
    const sequence = state.self.moveSequence + 1
    state.room.send('move', { direction, running: false, sequence })
    for (let i = 0; i < 40 && state.self.moveSequence < sequence; i++) await delay(10)
    await delay(110)
  }
}

async function cross(state, to) {
  await walkTo(state, portalTo(state.self.areaId, to))
  state.room.send('area', { areaId: to })
  for (let i = 0; i < 100 && state.self.areaId !== to; i++) await delay(20)
}

async function row(userId) {
  const { rows } = await query('SELECT area_id, tx, ty, epoch::int, seq::int FROM public.world_player_locations WHERE user_id = $1', [userId])
  return rows[0] ?? null
}

const { userId, token } = await local.player()
const summary = {}

let A = await start('A', 2611)
let B = null
try {
  const onA = await connect(A, token, { tabId: 'tab-two-a-harness' })
  check('A: a first-time player starts in Ciudad', onA.self.areaId === 'ciudad-corazon', JSON.stringify(onA.self))
  await cross(onA, 'pradera')
  await delay(1_200)
  check('A: the crossing is saved within ~1 s', (await row(userId))?.area_id === 'pradera', JSON.stringify(await row(userId)))

  B = await start('B', 2621) // overlap: A is still alive; B's host is newer
  const onB = await connect(B, token, { tabId: 'tab-two-b-harness' })
  check('B: the new socket is restored from the row (Pradera arrival)', onB.self.areaId === 'pradera' && onB.self.tx === ARRIVALS.pradera.tx && onB.self.ty === ARRIVALS.pradera.ty, JSON.stringify(onB.self))
  check('B: claimed a newer epoch', (await row(userId))?.epoch === 2, JSON.stringify(await row(userId)))

  await cross(onA, 'ciudad-corazon').catch(() => {}) // the old socket acts on A (A may already be draining)
  for (let i = 0; i < 200 && onA.left === null; i++) await delay(50) // within one renewal
  check('A: the old socket is closed with 4503 (drain) or 4409, never 4001', onA.left === 4503 || onA.left === 4409, `left=${onA.left}`)
  check('A: the row keeps B\'s state', (await row(userId))?.area_id === 'pradera' && (await row(userId))?.epoch === 2, JSON.stringify(await row(userId)))
  // The socket closes before the drain ends (stop comes after the flush): wait for A's stop.
  for (let i = 0; i < 300 && (await local.hosts())?.[0]?.state !== 'stopped'; i++) await delay(50)
  const late = await connect(A, token, { tabId: 'tab-two-late-harness', waitSelf: false })
  check('A: displaced, it stays alive and stopped: /readyz 503, joins refused with 4503 (it never exits on its own)', A.child.exitCode === null && (await A.ready()) === 503 && late.refused === 4503, JSON.stringify({ exit: A.child.exitCode, ready: await A.ready(), refused: late.refused }))
  const hosts = await local.hosts()
  check('A: its host is stopped, B\'s is active', hosts?.[0]?.state === 'stopped' && hosts?.[1]?.state === 'active', JSON.stringify(hosts?.map(h => [h.generation, h.state])))

  await A.kill() // the deploy ends the displaced process
  A = null
  await cross(onB, 'ciudad-corazon')
  await delay(1_200)
  const saved = await row(userId)
  check('B: its crossing back is saved', saved?.area_id === 'ciudad-corazon' && saved.tx === TOWN_FROM_PRADERA.tx && saved.ty === TOWN_FROM_PRADERA.ty, JSON.stringify(saved))
  summary.metricsB = (await B.metrics())?.location

  await B.kill() // B crashes too: its lease runs out on its own
  B = await start('B2', 2631) // a fresh process: no reconnect memory, a newer host
  const again = await connect(B, token, { tabId: 'tab-two-b2-harness' })
  check('B\': a restart restores the last saved tile', again.self.areaId === 'ciudad-corazon' && again.self.tx === TOWN_FROM_PRADERA.tx && again.self.ty === TOWN_FROM_PRADERA.ty, JSON.stringify(again.self))
  check('B\': epoch 3', (await row(userId))?.epoch === 3, JSON.stringify(await row(userId)))
  await again.room.leave()

  // 6. An abandoned claim on B' lands in the database after the live session's claim on A'.
  const second = await local.player()
  local.holdClaims(second.userId)
  const abandoned = await connect(B, second.token, { tabId: 'tab-two-abandoned-harness' })
  check('B\': a hung claim places the player at Ciudad after the 1.5 s timeout', abandoned.self.areaId === 'ciudad-corazon', JSON.stringify(abandoned.self))
  check('B\': the claim was held, not answered', local.calls.held === 1, JSON.stringify(local.calls))
  await abandoned.room.leave()
  for (let i = 0; i < 40 && abandoned.left === null; i++) await delay(25)
  A = await start('A2', 2641) // a newer host; B' drains when it learns of it
  const live = await connect(A, second.token, { tabId: 'tab-two-live-harness' })
  for (let i = 0; i < 40 && (await row(second.userId))?.epoch !== 1; i++) await delay(50)
  const epoch = (await row(second.userId))?.epoch
  check('A\': the live session claimed', epoch === 1, JSON.stringify(await row(second.userId)))
  const answer = await local.releaseHeld()
  check('the abandoned claim runs late and writes nothing (superseded)', answer?.claim?.status === 'superseded' && (await row(second.userId))?.epoch === epoch, JSON.stringify({ answer, row: await row(second.userId) }))
  await cross(live, 'pradera')
  await delay(1_200)
  check('A\': the live session keeps writing, never closed', (await row(second.userId))?.area_id === 'pradera' && live.left === null, JSON.stringify({ row: await row(second.userId), left: live.left }))
  const metricsA2 = (await A.metrics())?.location
  check('A\': no stale and no fenced disconnect on /metrics', metricsA2?.journal?.saves?.stale === 0 && metricsA2?.fencedDisconnects === 0, JSON.stringify(metricsA2?.journal?.saves))
  await live.room.leave()
  summary.authorityCalls = { ...local.calls }
} catch (error) {
  check('scenario ran to the end', false, String(error?.stack ?? error))
} finally {
  if (A) await A.kill()
  if (B) await B.kill()
  await local.close()
}

const passed = checks.every(c => c.ok)
console.log(JSON.stringify({ passed, checks, summary }, null, 2))
process.exit(passed ? 0 : 1)
