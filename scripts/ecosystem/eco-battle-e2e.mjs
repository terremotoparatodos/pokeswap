// ECO-GAMEPLAY-2 — end-to-end check of test-battle reservations against the isolated local realtime
// (development only).
//
//   node scripts/ecosystem/eco-gameplay-local.mjs realtime      (in another terminal)
//   node scripts/ecosystem/eco-battle-e2e.mjs [--url ws://127.0.0.1:2790]
//
// Two synthetic players (the browser's own protocol, through the real Colyseus SDK) walk up to the
// same encounter in Pradera. A reserves it; B is refused `busy` and sees it busy; capture is refused
// by the sandbox; a foreign action and a test retirement cannot touch it; A flees (released, still
// in the world). A engages again, drops its socket mid-battle and rejoins inside the grace (same
// battle, resumed); then the server decides the end with no orders from A. Victory must retire the
// individual for both; any other end must leave it in the world. Exit 0 PASS, 1 FAIL, 3 setup.
// Synthetic data only; nothing is captured, granted or persisted.

import { writeFileSync } from 'node:fs'
import { Client } from '@colyseus/sdk'
import { isWalkable } from '../../services/realtime/src/world/navigation.js'
import { ECO_ENGAGE_RANGE, ECO_PROTOCOL, WORLD_MESSAGE, WORLD_PROTOCOL } from '../../services/realtime/src/world/worldProtocol.js'

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback }
const URL = arg('url', 'ws://127.0.0.1:2790')
const PRESENCE_PROTOCOL = 3 // the browser's (src/features/wildlands/multiplayer/domain/closePolicy.ts)
const STEP_MS = 140 // under the server's 10 steps/s token rate
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const log = message => console.log(`[eco-battle-e2e] ${message}`)
const fail = message => { console.error(`[eco-battle-e2e] FAIL: ${message}`); process.exit(1) }

async function player(id) {
  const state = { eco: null, self: null, engage: [], battle: [], ends: [], retire: [], sequence: 0 }
  const room = await new Client(URL).joinOrCreate('presence', {
    token: null, presenceProtocol: PRESENCE_PROTOCOL, worldProtocol: WORLD_PROTOCOL, ecoProtocol: ECO_PROTOCOL,
    tabId: `e2e-${id}-${Date.now()}`, benchmark: { id, username: id, area: 'pradera' },
  })
  room.reconnection.enabled = false
  room.onMessage('*', () => {})
  room.onMessage('presence:snapshot', snapshot => { if (snapshot.self) { state.self = snapshot.self; state.sequence = snapshot.self.moveSequence ?? 0 } })
  room.onMessage('presence:self', self => { state.self = self; state.sequence = Math.max(state.sequence, self.moveSequence ?? 0) })
  room.onMessage(WORLD_MESSAGE.SNAPSHOT, snapshot => { if (snapshot.eco) state.eco = snapshot.eco })
  room.onMessage(WORLD_MESSAGE.ECO, message => { state.eco = message.eco })
  room.onMessage(WORLD_MESSAGE.ECO_ENGAGE_RESULT, result => state.engage.push(result))
  room.onMessage(WORLD_MESSAGE.ECO_BATTLE, message => state.battle.push({ ...message, receivedAt: Date.now() }))
  room.onMessage(WORLD_MESSAGE.ECO_BATTLE_END, end => state.ends.push(end))
  room.onMessage(WORLD_MESSAGE.ECO_DEV_RETIRE_RESULT, result => state.retire.push(result))
  room.send('presence:ready')
  return { id, room, state }
}

async function until(predicate, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) { if (predicate()) return; await wait(100) }
  fail(`timed out waiting for ${what}`)
}

const encounterOf = (p, id) => p.state.eco?.encounters.find(e => e.id === id) ?? null
const distance = (p, e) => Math.max(Math.abs(p.state.self.tx - e.tx), Math.abs(p.state.self.ty - e.ty))

const STEPS = Object.freeze({ up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] })

/** The first step of a shortest walkable path (the server's own walkability) to a tile `goal` accepts. */
function firstStep(from, goal, limit = 40_000) {
  const key = (x, y) => `${x},${y}`
  const seen = new Map([[key(from.tx, from.ty), null]])
  const queue = [[from.tx, from.ty]]
  for (let i = 0; i < queue.length && i < limit; i++) {
    const [x, y] = queue[i]
    if (goal(x, y)) {
      let at = key(x, y), step = null
      while (seen.get(at)) { step = seen.get(at); at = step.from }
      return step?.direction ?? null
    }
    for (const [direction, [dx, dy]] of Object.entries(STEPS)) {
      const nx = x + dx, ny = y + dy
      if (seen.has(key(nx, ny)) || !isWalkable('pradera', nx, ny)) continue
      seen.set(key(nx, ny), { from: key(x, y), direction })
      queue.push([nx, ny])
    }
  }
  return null
}

/**
 * Walks toward the (moving) encounter until `within` tiles along a shortest walkable path, planned
 * again every step (ECO-BATTLE-ENDING-1: the 3-tile start limit leaves no room for greedy steps that
 * do not go round obstacles). Blocked by someone in the way, or no path: a random step, then plan again.
 */
async function walkTo(p, encounterId, within, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs
  let stuck = 0
  while (Date.now() < deadline) {
    const e = encounterOf(p, encounterId)
    if (!e) return false
    if (distance(p, e) <= within) return true
    const planned = firstStep(p.state.self, (x, y) => Math.max(Math.abs(x - e.tx), Math.abs(y - e.ty)) <= within)
    const direction = !planned || stuck > 3 ? Object.keys(STEPS)[Math.floor(Math.random() * 4)] : planned
    const before = `${p.state.self.tx},${p.state.self.ty}`
    p.room.send('move', { direction, running: false, sequence: ++p.state.sequence })
    await wait(STEP_MS)
    stuck = `${p.state.self.tx},${p.state.self.ty}` === before ? stuck + 1 : 0
  }
  return false
}

/**
 * ECO-OVERWORLD-BATTLE-1 — directed sync check (the open «HP and timer standing still» observation of
 * ECO-PRESENTATION-1). On the wire, for one real battle after its resume: every snapshot the owner
 * received, when it arrived, its battle time, revision and HP. It FAILS only on inconsistencies the
 * client could not fix by itself — battle time or revision going backwards, a snapshot's HP that
 * disagrees with the HP its own events report — and REPORTS the cadence (gaps between messages,
 * battle time against wall time) without inventing a threshold for it. `--sync-report <file>` saves it.
 */
function syncCheck(messages, end) {
  const rows = messages.map(m => ({
    receivedAt: m.receivedAt, timeMs: m.snapshot.timeMs, revision: m.snapshot.revision,
    hp: Object.fromEntries(Object.values(m.snapshot.combatants).map(c => [c.combatantId, c.condition.currentHp ?? c.stats.hp])),
    events: (m.events ?? []).map(e => e.event.type),
    lastHpByEvents: Object.fromEntries((m.events ?? []).filter(e => typeof e.event.remainingHp === 'number').map(e => [e.event.combatantId, e.event.remainingHp])),
  }))
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].timeMs < rows[i - 1].timeMs) fail(`sync: battle time went back (${rows[i - 1].timeMs} → ${rows[i].timeMs})`)
    if (rows[i].revision < rows[i - 1].revision) fail(`sync: revision went back (${rows[i - 1].revision} → ${rows[i].revision})`)
  }
  for (const row of rows) {
    for (const [id, hp] of Object.entries(row.lastHpByEvents)) {
      if (row.hp[id] !== hp) fail(`sync: snapshot HP of ${id} is ${row.hp[id]} but its events say ${hp} (revision ${row.revision})`)
    }
  }
  const gaps = rows.slice(1).map((r, i) => r.receivedAt - rows[i].receivedAt)
  const wall = rows.length > 1 ? rows[rows.length - 1].receivedAt - rows[0].receivedAt : 0
  const battle = rows.length > 1 ? rows[rows.length - 1].timeMs - rows[0].timeMs : 0
  const report = { messages: rows.length, maxGapMs: gaps.length ? Math.max(...gaps) : null, wallMs: wall, battleMs: battle, endTimeMs: end.snapshot.timeMs, rows }
  log(`sync: ${rows.length} snapshots, monotonic, HP consistent with events; max gap ${report.maxGapMs} ms; battle ${battle} ms over ${wall} ms of wall time`)
  const file = arg('sync-report', null)
  if (file) writeFileSync(file, JSON.stringify(report, null, 2) + String.fromCharCode(10))
}

let requestId = 0
async function engage(p, encounterId) {
  const id = ++requestId
  p.room.send(WORLD_MESSAGE.ECO_ENGAGE, { requestId: id, encounterId })
  await until(() => p.state.engage.some(r => r.requestId === id), 5_000, `the engage answer to ${p.id}`)
  return p.state.engage.find(r => r.requestId === id)
}

let a, b
try {
  a = await player('eco-battle-a')
  b = await player('eco-battle-b')
} catch (error) {
  console.error(`[eco-battle-e2e] setup: cannot join ${URL} (${error?.message ?? error}); start the isolated realtime first`)
  process.exit(3)
}

try {
  await until(() => a.state.self && b.state.self && a.state.eco?.areaId === 'pradera' && b.state.eco?.areaId === 'pradera', 15_000, 'both players in Pradera')
  await until(() => (a.state.eco.encounters.length ?? 0) >= 3, 60_000, 'Pradera to fill')

  // 1. A walks up to the nearest encounter and reserves it by its individual id.
  const target = [...a.state.eco.encounters].sort((x, y) => distance(a, x) - distance(a, y))[0]
  log(`target ${target.id.split(':').slice(2).join(':')} (#${target.speciesId}), ${distance(a, target)} tiles from A`)
  if (distance(a, target) > ECO_ENGAGE_RANGE) {
    const far = await engage(a, target.id)
    if (far.reason !== 'too-far') fail(`far engage answered ${JSON.stringify(far)}`)
    log('far engage refused: too-far')
  }
  if (!(await walkTo(a, target.id, ECO_ENGAGE_RANGE - 2))) fail('A could not reach the encounter')
  const first = await engage(a, target.id)
  if (!first.ok || !first.battle?.fixture) fail(`A's engage: ${JSON.stringify({ ...first, battle: undefined })}`)
  const battleId = first.battle.battleId
  log(`A reserved it: ${battleId} (fixture: ${first.battle.fixtureLabel}, ${first.battle.expiresInMs} ms of battle time)`)

  // 2. B, also in range, is refused and sees it busy.
  if (!(await walkTo(b, target.id, ECO_ENGAGE_RANGE - 2))) fail('B could not reach the encounter')
  const second = await engage(b, target.id)
  if (second.ok || second.reason !== 'busy') fail(`B's engage: ${JSON.stringify(second)}`)
  await until(() => encounterOf(b, target.id)?.busy === true, 3_000, 'B to see it busy')
  log('B refused (busy) and sees it busy')

  // 3. Capture is refused by the sandbox; B cannot act in A's battle; a test retirement cannot skip it.
  const versions = first.battle.snapshot
  const next = first.battle.joinAck.nextActionSequence
  a.room.send(WORLD_MESSAGE.ECO_BATTLE_ACTION, { actionId: `${first.battle.joinAck.controllerId}:${next}`, battleId, catalogVersion: versions.catalogVersion, battleRulesVersion: versions.battleRulesVersion, intent: { kind: 'capture', combatantId: 'player-0', targetId: 'wild-0', ballId: 'poke-ball' } })
  await until(() => a.state.battle.some(m => m.result?.reason === 'NOT_ALLOWED_IN_SANDBOX'), 3_000, 'the sandbox to refuse capture')
  b.room.send(WORLD_MESSAGE.ECO_BATTLE_ACTION, { actionId: `${first.battle.joinAck.controllerId}:${next + 1}`, battleId, intent: { kind: 'useMove', combatantId: 'player-0', moveId: 84, targetId: 'wild-0' } })
  await until(() => b.state.battle.some(m => m.result?.reason === 'no-battle'), 3_000, 'B\'s foreign action to be refused')
  if (b.state.battle.some(m => m.snapshot)) fail('B received a battle snapshot')
  a.room.send(WORLD_MESSAGE.ECO_DEV_RETIRE, { requestId: 1, encounterId: target.id })
  await until(() => a.state.retire.length === 1, 3_000, 'the test retirement answer')
  if (a.state.retire[0].reason !== 'busy') fail(`test retirement: ${JSON.stringify(a.state.retire[0])}`)
  log('capture refused by the sandbox; B\'s action refused (no-battle, no snapshot); test retirement refused (busy)')

  // 4. A flees: released, still in the world, free for both.
  a.room.send(WORLD_MESSAGE.ECO_FLEE, { battleId })
  await until(() => a.state.ends.length === 1, 3_000, 'the flee to end the battle')
  if (a.state.ends[0].outcome !== 'fled' || a.state.ends[0].retired) fail(`flee end: ${JSON.stringify({ ...a.state.ends[0], snapshot: undefined })}`)
  await until(() => [a, b].every(p => encounterOf(p, target.id)?.busy === false), 3_000, 'the encounter to be free for both')
  log('A fled: released, not retired, free for both')

  // 5. A engages again, drops its socket, and rejoins inside the grace: the same battle resumes.
  if (!(await walkTo(a, target.id, ECO_ENGAGE_RANGE - 1))) fail('A lost the encounter before re-engaging')
  const again = await engage(a, target.id)
  if (!again.ok || again.battle.battleId === battleId) fail(`re-engage: ${JSON.stringify({ ...again, battle: again.battle?.battleId })}`)
  const secondBattle = again.battle.battleId
  await a.room.leave()
  await wait(2_000)
  if (encounterOf(b, target.id)?.busy !== true) fail('the encounter was not kept busy during the grace')
  a = await player('eco-battle-a')
  await until(() => a.state.engage.some(r => r.resumed), 5_000, 'the resumed battle after rejoining')
  const resumed = a.state.engage.find(r => r.resumed)
  if (resumed.battle.battleId !== secondBattle) fail(`resumed ${resumed.battle.battleId}, expected ${secondBattle}`)
  log(`A dropped and rejoined within the grace: battle ${secondBattle} resumed (next action ${resumed.battle.joinAck.nextActionSequence})`)

  // 6. The server decides the end (no orders from A). Victory retires for both; anything else does not.
  await until(() => a.state.ends.length > 0, 140_000, 'the server to end the battle')
  const end = a.state.ends[0]
  log(`the server ended it: ${end.outcome} after ${end.snapshot.timeMs} ms of battle time (retired: ${end.retired})`)
  syncCheck(a.state.battle.filter(m => m.battleId === secondBattle && m.snapshot), end)
  await wait(1_000)
  const present = [a, b].map(p => Boolean(encounterOf(p, target.id)))
  if (end.outcome === 'victory') {
    if (!end.retired || present.some(Boolean)) fail(`victory but present=${present} retired=${end.retired}`)
    log('victory: retired once, gone for both')
  } else {
    if (end.retired || !present.every(Boolean)) fail(`${end.outcome} but present=${present} retired=${end.retired}`)
    log(`${end.outcome}: released, still in the world for both`)
  }
  log('PASS')
} finally {
  await Promise.allSettled([a?.room.leave(), b?.room.leave()])
}
process.exit(0)
