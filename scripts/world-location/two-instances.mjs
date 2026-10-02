// WORLD LOCATION-2 — two real realtime PROCESSES, one location store (LOCAL ONLY).
//
//   node scripts/world-location/two-instances.mjs
//
// What runs, and what is simulated:
//   - two unmodified `services/realtime/src/index.js` processes (A and B), each
//     with WORLD_LOCATION_PERSISTENCE=on and the Edge adapter;
//   - ONE authority in this process: the real world-authority handler
//     (supabase/functions/world-authority/handler.ts) over an embedded Postgres
//     (PGlite) running the real migrations — what the Edge Runtime + Postgres
//     would do, minus the network hop to Supabase;
//   - a stand-in for Supabase Auth's /auth/v1/user (a token → a user id) and
//     empty REST reads (wild catalog, companions).
// Clients are real @colyseus/sdk sockets. The realtime runs in its local
// benchmark mode only to accept Node sockets without an Origin header; the
// players authenticate with tokens through the normal path (UUID user ids),
// so they persist like real players.
//
// Scenario (D-L10 rehearsal; Colyseus Cloud itself must still be verified):
//   1. A serves the player, who crosses Ciudad → Pradera (urgent save).
//   2. B starts while A is still alive (a deploy overlap); the same player's
//      new socket lands on B and is restored in Pradera from the row.
//   3. A's old socket acts once more; its save is stale → A closes it with
//      4001 'session-replaced'. The row keeps B's state.
//   4. A dies hard (no shutdown). The player on B crosses back to Ciudad.
//   5. B dies hard; a fresh B' starts; the player joins after the 15 s grace
//      window would have expired anyway (no memory in a new process) and is
//      restored at B's last saved tile.
//   6. Review B2 (abandoned claim): a second player joins B' but its claim
//      hangs in the authority; B' gives up (1.5 s), places it at Ciudad, and
//      the socket goes. The player joins a fresh A' (claims normally). Only
//      then does the abandoned claim run in the database. A' keeps writing:
//      no stale, no 4001.
// Exit code 0 only if every check passes. Prints a JSON summary.

import { spawn } from 'node:child_process'
import net from 'node:net'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Client } from '@colyseus/sdk'
import { startLocalAuthority } from './localAuthority.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const realtime = `${root}services/realtime/src/`
const { routeBetween } = await import(pathToFileURL(`${realtime}world/testing.js`).href)
const { portalTo } = await import(pathToFileURL(`${realtime}world/navigation.js`).href)
const { ARRIVALS, TOWN_FROM_PRADERA } = await import(pathToFileURL(`${realtime}protocol/arrival.js`).href)

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const checks = []
const check = (name, ok, detail = '') => { checks.push({ name, ok: Boolean(ok), detail }); if (!ok) console.error(`FAIL ${name} ${detail}`) }

// ── The authority and the auth stand-in (scripts/world-location/localAuthority.mjs) ──

const local = await startLocalAuthority({ secret: 'l'.repeat(48) })
const { query } = local

// ── Realtime processes ───────────────────────────────────────────────────

async function waitForPort(port, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const open = await new Promise(resolve => {
      const socket = net.createConnection({ host: '127.0.0.1', port })
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('error', () => resolve(false))
    })
    if (open) return
    await delay(100)
  }
  throw new Error(`no realtime on ${port}`)
}

async function startRealtime(name, port) {
  const child = spawn(process.execPath, [`${realtime}index.js`], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HEALTH_PORT: String(port + 1), NODE_ENV: 'development', PRESENCE_BENCHMARK: 'on', ...local.env('on') },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout.on('data', chunk => { log += chunk })
  child.stderr.on('data', chunk => { log += chunk })
  await waitForPort(port)
  return { name, port, child, log: () => log, metrics: async () => (await fetch(`http://127.0.0.1:${port + 1}/metrics`)).json(), version: async () => (await fetch(`http://127.0.0.1:${port}/version`)).json() }
}

const kill = async processInfo => { processInfo.child.kill('SIGKILL'); await new Promise(resolve => processInfo.child.once('exit', resolve)) }

// ── A player socket ──────────────────────────────────────────────────────

async function connect(server, token) {
  const room = await new Client(`ws://127.0.0.1:${server.port}`).joinOrCreate('presence', { token, presenceProtocol: 2, worldProtocol: 3 })
  room.reconnection.enabled = false
  const state = { room, self: null, left: null, errors: [] }
  room.onMessage('presence:snapshot', payload => { if (payload.self) state.self = payload.self })
  room.onMessage('presence:self', payload => { state.self = payload })
  room.onMessage('presence:error', payload => state.errors.push(payload.reason))
  for (const type of ['presence:delta', 'presence:batch', 'chat:history', 'chat:line', 'world:snapshot', 'world:batch', 'world:player-state', 'world:status']) room.onMessage(type, () => {})
  room.onMessage('*', () => {})
  room.onLeave(code => { state.left = code })
  room.send('presence:ready')
  for (let i = 0; i < 100 && !state.self; i++) await delay(50)
  if (!state.self) throw new Error(`no snapshot from ${server.name}`)
  return state
}

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

// ── Scenario ─────────────────────────────────────────────────────────────

const { userId, token } = await local.player()
const summary = {}

let A = await startRealtime('A', 2611)
let B = null
try {
  const onA = await connect(A, token)
  check('A: a first-time player starts in Ciudad', onA.self.areaId === 'ciudad-corazon', JSON.stringify(onA.self))
  await cross(onA, 'pradera')
  await delay(1_200)
  check('A: the crossing is saved within ~1 s', (await row(userId))?.area_id === 'pradera', JSON.stringify(await row(userId)))

  B = await startRealtime('B', 2621) // overlap: A is still alive
  const onB = await connect(B, token)
  check('B: the new socket is restored from the row (Pradera arrival)', onB.self.areaId === 'pradera' && onB.self.tx === ARRIVALS.pradera.tx && onB.self.ty === ARRIVALS.pradera.ty, JSON.stringify(onB.self))
  check('B: claimed a newer epoch', (await row(userId))?.epoch === 2, JSON.stringify(await row(userId)))

  await cross(onA, 'ciudad-corazon') // the old socket acts on A: urgent save → stale
  for (let i = 0; i < 60 && onA.left === null; i++) await delay(50)
  check('A: the stale writer is closed with 4001', onA.left === 4001, `left=${onA.left}`)
  check('A: the row keeps B\'s state', (await row(userId))?.area_id === 'pradera' && (await row(userId))?.epoch === 2, JSON.stringify(await row(userId)))
  const metricsA = (await A.metrics()).location
  check('A: /metrics counts one fenced disconnect', metricsA?.fencedDisconnects === 1, JSON.stringify(metricsA?.journal?.saves))
  summary.metricsA = { mode: metricsA?.mode, effective: metricsA?.effective, fencedDisconnects: metricsA?.fencedDisconnects, saves: metricsA?.journal?.saves }
  const version = await A.version()
  check('/version carries no location state (D-L5)', !/location|shadow|epoch/.test(JSON.stringify(version)), JSON.stringify(version))

  await kill(A) // A dies hard: no shutdown, no flush
  A = null
  await cross(onB, 'ciudad-corazon')
  await delay(1_200)
  const saved = await row(userId)
  check('B: its crossing back is saved', saved?.area_id === 'ciudad-corazon' && saved.tx === TOWN_FROM_PRADERA.tx && saved.ty === TOWN_FROM_PRADERA.ty, JSON.stringify(saved))
  summary.metricsB = (await B.metrics()).location

  await kill(B) // B crashes too
  B = await startRealtime('B2', 2631) // a fresh process: no reconnect memory
  const again = await connect(B, token)
  check('B\': a restart restores the last saved tile', again.self.areaId === 'ciudad-corazon' && again.self.tx === TOWN_FROM_PRADERA.tx && again.self.ty === TOWN_FROM_PRADERA.ty, JSON.stringify(again.self))
  check('B\': epoch 3', (await row(userId))?.epoch === 3, JSON.stringify(await row(userId)))
  again.room.leave()

  // 6. An abandoned claim on B' lands in the database after the live session's claim on A'.
  const late = await local.player()
  local.holdClaims(late.userId)
  const abandoned = await connect(B, late.token)
  check('B\': a hung claim places the player at Ciudad after the 1.5 s timeout', abandoned.self.areaId === 'ciudad-corazon', JSON.stringify(abandoned.self))
  check('B\': the claim was held, not answered', local.calls.held === 1, JSON.stringify(local.calls))
  abandoned.room.leave()
  for (let i = 0; i < 40 && abandoned.left === null; i++) await delay(25)
  A = await startRealtime('A2', 2641)
  const live = await connect(A, late.token)
  for (let i = 0; i < 40 && (await row(late.userId))?.epoch !== 1; i++) await delay(50)
  const epoch = (await row(late.userId))?.epoch
  check('A\': the live session claimed', epoch === 1, JSON.stringify(await row(late.userId)))
  const answer = await local.releaseHeld()
  check('the abandoned claim runs late and writes nothing (conflict)', answer?.claim?.status === 'conflict' && (await row(late.userId))?.epoch === epoch, JSON.stringify({ answer, row: await row(late.userId) }))
  await cross(live, 'pradera')
  await delay(1_200)
  check('A\': the live session keeps writing, never fenced', (await row(late.userId))?.area_id === 'pradera' && live.left === null, JSON.stringify({ row: await row(late.userId), left: live.left }))
  const metricsA2 = (await A.metrics()).location
  check('A\': no stale and no fenced disconnect on /metrics', metricsA2?.journal?.saves?.stale === 0 && metricsA2?.fencedDisconnects === 0, JSON.stringify(metricsA2?.journal?.saves))
  live.room.leave()
  summary.authorityCalls = { ...local.calls }
} catch (error) {
  check('scenario ran to the end', false, String(error?.stack ?? error))
} finally {
  if (A) await kill(A)
  if (B) await kill(B)
  await local.close()
}

const passed = checks.every(c => c.ok)
console.log(JSON.stringify({ passed, checks, summary }, null, 2))
process.exit(passed ? 0 : 1)
