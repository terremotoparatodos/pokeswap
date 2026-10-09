// ECO-BATTLE-SPECTATORS-1 — end-to-end check of battle spectators against the isolated local realtime
// (development only).
//
//   node scripts/ecosystem/eco-gameplay-local.mjs realtime      (in another terminal)
//   node scripts/ecosystem/eco-spectators-e2e.mjs [--url ws://127.0.0.1:2790] [--report <file>]
//
// Synthetic players through the real Colyseus SDK, as the browser connects. A and B each battle an
// encounter in Pradera at the same time; C watches; D arrives later. Checked on the wire:
//   - routing: C and D get both battles' public views; each owner gets only the other one's; no one
//     gets its own battle through the public channel;
//   - synchronisation: each public message with events matches the owner's message of the same
//     revision (battle time, HP, drawable event sequences);
//   - late arrival: D's first view of each running battle has no past events and is current;
//   - pause / resume: A drops its socket and rejoins inside the grace; C sees connected false, then
//     true at the same revision;
//   - area change: C walks through the cave portal (a real crossing) and gets nothing from Pradera;
//     back in Pradera it gets what is still running, as it is now, without past events;
//   - ends: B flees and the server ends A's battle; each end reaches C once, last, with the owner's
//     outcome; nothing follows;
//   - no private data: no public payload carries moves, PP, the selection, joinAck, controller,
//     action ids, private event types or a player id.
// Exit 0 PASS, 1 FAIL, 3 setup. Synthetic data only; nothing is captured, granted or persisted.

import { writeFileSync } from 'node:fs'
import { Client } from '@colyseus/sdk'
import { portalTo } from '../../services/realtime/src/world/navigation.js'
import { PUBLIC_EVENT_FIELDS } from '../../services/realtime/src/world/ecoBattlePublic.js'
import { ECO_ENGAGE_RANGE, ECO_PROTOCOL, WORLD_MESSAGE, WORLD_PROTOCOL } from '../../services/realtime/src/world/worldProtocol.js'

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback }
const URL = arg('url', 'ws://127.0.0.1:2790')
const PRESENCE_PROTOCOL = 3 // the browser's (src/features/wildlands/multiplayer/domain/closePolicy.ts)
const STEP_MS = 140 // under the server's 10 steps/s token rate
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const log = message => console.log(`[eco-spectators-e2e] ${message}`)
const report = { checks: [] }
const check = (name, detail) => { report.checks.push({ name, ...detail }); log(`ok · ${name}${detail ? ` · ${JSON.stringify(detail)}` : ''}`) }
const fail = message => {
  console.error(`[eco-spectators-e2e] FAIL: ${message}`)
  report.result = 'FAIL'; report.failure = message
  save()
  process.exit(1)
}
function save() {
  const file = arg('report', null)
  if (file) writeFileSync(file, JSON.stringify(report, null, 2) + String.fromCharCode(10))
}

const PRIVATE = ['joinAck', 'controller', '"moves"', '"pp"', 'selected', 'actionId', 'serverTimeMs', 'lastMoveId', 'PP_CHANGED', 'ACTION_STARTED', 'ACTION_READY', '"atk"', '"spa"', 'benchmark-']

async function player(id) {
  const state = { eco: null, areaId: null, self: null, engage: [], battle: [], ends: [], publics: [], sequence: 0 }
  const room = await new Client(URL).joinOrCreate('presence', {
    token: null, presenceProtocol: PRESENCE_PROTOCOL, worldProtocol: WORLD_PROTOCOL, ecoProtocol: ECO_PROTOCOL,
    tabId: `e2e-${id}-${Date.now()}`, benchmark: { id, username: id, area: 'pradera' },
  })
  room.reconnection.enabled = false
  room.onMessage('*', () => {})
  room.onMessage('presence:snapshot', snapshot => { if (snapshot.self) { state.self = snapshot.self; state.sequence = snapshot.self.moveSequence ?? 0 } })
  room.onMessage('presence:self', self => { state.self = self; state.sequence = Math.max(state.sequence, self.moveSequence ?? 0) })
  room.onMessage(WORLD_MESSAGE.SNAPSHOT, snapshot => { state.areaId = snapshot.areaId; state.eco = snapshot.eco ?? null; state.publics.push({ snapshot: snapshot.areaId, at: Date.now() }) })
  room.onMessage(WORLD_MESSAGE.ECO, message => { state.eco = message.eco })
  room.onMessage(WORLD_MESSAGE.ECO_ENGAGE_RESULT, result => state.engage.push(result))
  room.onMessage(WORLD_MESSAGE.ECO_BATTLE, message => state.battle.push(message))
  room.onMessage(WORLD_MESSAGE.ECO_BATTLE_END, end => state.ends.push({ ...end, at: Date.now() }))
  room.onMessage(WORLD_MESSAGE.ECO_BATTLE_PUBLIC, view => state.publics.push({ view, raw: JSON.stringify(view), at: Date.now() }))
  room.send('presence:ready')
  return { id, room, state }
}

async function until(predicate, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) { if (predicate()) return; await wait(100) }
  fail(`timed out waiting for ${what}`)
}

const encounterOf = (p, id) => p.state.eco?.encounters.find(e => e.id === id) ?? null
const distance = (p, t) => Math.max(Math.abs(p.state.self.tx - t.tx), Math.abs(p.state.self.ty - t.ty))
/** The public messages a player received (in order), optionally of one battle. */
const publics = (p, battleId = null) => p.state.publics.filter(m => m.view && (battleId === null || m.view.battleId === battleId)).map(m => m.view)

/** Walks greedily toward a target (a tile, or a moving encounter) until `within` tiles. */
async function walkTo(p, target, within, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs
  let stuck = 0
  while (Date.now() < deadline) {
    const t = typeof target === 'string' ? encounterOf(p, target) : target
    if (!t) return false
    if (distance(p, t) <= within) return true
    const dx = t.tx - p.state.self.tx
    const dy = t.ty - p.state.self.ty
    const primary = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up')
    const secondary = Math.abs(dx) >= Math.abs(dy) ? (dy >= 0 ? 'down' : 'up') : (dx >= 0 ? 'right' : 'left')
    const sidestep = ['up', 'down', 'left', 'right'][Math.floor(Math.random() * 4)]
    const direction = stuck > 6 ? sidestep : stuck > 2 ? secondary : primary
    const before = `${p.state.self.tx},${p.state.self.ty}`
    p.room.send('move', { direction, running: false, sequence: ++p.state.sequence })
    await wait(STEP_MS)
    stuck = `${p.state.self.tx},${p.state.self.ty}` === before ? stuck + 1 : 0
  }
  return false
}

/** A real crossing: stand on the portal and ask for the area, like the client does. */
async function cross(p, from, to) {
  const portal = portalTo(from, to)
  if (!portal) fail(`no portal ${from} → ${to}`)
  if (!(await walkTo(p, portal, 0, 120_000))) fail(`${p.id} could not reach the ${from} → ${to} portal`)
  p.room.send('area', { areaId: to })
  await until(() => p.state.areaId === to, 10_000, `${p.id} to arrive in ${to}`)
}

let requestId = 0
async function engage(p, encounterId) {
  const id = ++requestId
  p.room.send(WORLD_MESSAGE.ECO_ENGAGE, { requestId: id, encounterId })
  await until(() => p.state.engage.some(r => r.requestId === id), 5_000, `the engage answer to ${p.id}`)
  return p.state.engage.find(r => r.requestId === id)
}

/** Every public message with events must match the owner's message of the same revision. */
function syncAgainst(owner, watcher, battleId) {
  const mine = new Map(owner.state.battle.filter(m => m.battleId === battleId && m.snapshot && m.events?.length).map(m => [m.snapshot.revision, m]))
  let compared = 0
  for (const view of publics(watcher, battleId).filter(v => v.events)) {
    const theirs = mine.get(view.revision)
    if (!theirs) continue // the owner may have been away (paused) or the watcher arrived later
    if (view.timeMs !== theirs.snapshot.timeMs) fail(`sync ${battleId}: time ${view.timeMs} vs owner ${theirs.snapshot.timeMs}`)
    for (const id of ['player-0', 'wild-0']) {
      const own = theirs.snapshot.combatants[id]
      if (view.combatants[id]?.currentHp !== (own.condition.currentHp ?? own.stats.hp)) fail(`sync ${battleId}: HP of ${id} at revision ${view.revision}`)
    }
    const drawable = theirs.events.filter(e => PUBLIC_EVENT_FIELDS[e.event.type]).map(e => e.sequence).join(',')
    if (view.events.map(e => e.sequence).join(',') !== drawable) fail(`sync ${battleId}: events at revision ${view.revision}`)
    compared++
  }
  return compared
}

/**
 * Per battle, as one client received it: between two world snapshots (each one resets the client's
 * view) `seq` strictly grows; revision and battle time never go back; at most one end, and it is last.
 */
function streamInvariants(p, battleId) {
  let segment = null, previous = null, messages = 0
  const ends = []
  for (const m of p.state.publics) {
    if (m.snapshot) { segment = null; continue }
    if (m.view.battleId !== battleId) continue
    messages++
    if (segment && m.view.seq <= segment.seq) fail(`${p.id}: seq of ${battleId} did not grow (${segment.seq} → ${m.view.seq})`)
    if (previous && (m.view.revision < previous.revision || m.view.timeMs < previous.timeMs)) fail(`${p.id}: ${battleId} went back`)
    if (ends.length) fail(`${p.id}: a message followed the end of ${battleId}`)
    if (m.view.ended) ends.push(m.view)
    segment = m.view; previous = m.view
  }
  return { messages, ended: ends[0]?.ended.outcome ?? null }
}

let a, b, c, d
try {
  a = await player('eco-spect-a')
  b = await player('eco-spect-b')
  c = await player('eco-spect-c')
} catch (error) {
  console.error(`[eco-spectators-e2e] setup: cannot join ${URL} (${error?.message ?? error}); start the isolated realtime first`)
  process.exit(3)
}

try {
  await until(() => [a, b, c].every(p => p.state.self && p.state.areaId === 'pradera' && p.state.eco), 15_000, 'A, B and C in Pradera')
  await until(() => (a.state.eco.encounters.length ?? 0) >= 3, 60_000, 'Pradera to fill')

  // 1. Two battles at once: A and B each reserve a different encounter.
  const byDistance = p => [...p.state.eco.encounters].filter(e => !e.busy).sort((x, y) => distance(p, x) - distance(p, y))
  const t1 = byDistance(a)[0]
  if (!(await walkTo(a, t1.id, ECO_ENGAGE_RANGE - 2))) fail('A could not reach its encounter')
  const one = await engage(a, t1.id)
  if (!one.ok) fail(`A's engage: ${one.reason}`)
  const t2 = byDistance(b).find(e => e.id !== t1.id)
  if (!(await walkTo(b, t2.id, ECO_ENGAGE_RANGE - 2))) fail('B could not reach its encounter')
  const two = await engage(b, t2.id)
  if (!two.ok) fail(`B's engage: ${two.reason}`)
  const b1 = one.battle.battleId, b2 = two.battle.battleId
  log(`battles: A ${b1} (#${t1.speciesId}), B ${b2} (#${t2.speciesId})`)

  // 2. Routing.
  await until(() => publics(c, b1).length > 0 && publics(c, b2).length > 0, 5_000, 'C to see both battles')
  await until(() => publics(a, b2).length > 0 && publics(b, b1).length > 0, 5_000, 'each owner to see the other battle')
  if (publics(a, b1).length || publics(b, b2).length) fail('an owner received its own battle as public')
  const start = publics(c, b1)[0]
  if (start.encounterId !== t1.id || start.stage.wild.tx !== encounterOf(c, t1.id)?.tx) fail(`C's view of b1 does not stand on its encounter: ${JSON.stringify(start.stage)}`)
  check('routing: C sees both battles; each owner only the other one; nobody its own')

  // 3. Late arrival: D joins now.
  await wait(4_000)
  d = await player('eco-spect-d')
  await until(() => d.state.areaId === 'pradera', 15_000, 'D in Pradera')
  await until(() => [b1, b2].every(id => publics(d, id).length > 0 || publics(c, id).some(v => v.ended)), 5_000, 'D to receive the running battles')
  for (const id of [b1, b2]) {
    const arrival = d.state.publics.find(m => m.view?.battleId === id)
    if (!arrival) continue // it ended before D arrived
    if (arrival.view.events) fail(`D's first view of ${id} carried past events`)
    if (arrival.view.ended) fail(`D got an ended battle on arrival: ${id}`)
    const cBefore = c.state.publics.filter(m => m.view?.battleId === id && m.at <= arrival.at).at(-1)?.view
    if (cBefore && arrival.view.revision < cBefore.revision) fail(`D's first view of ${id} is older than what C already had`)
  }
  check('late arrival: D sees the running battles as they are, with no past effects')

  // 4. Pause and resume: A drops its socket and comes back inside the grace.
  const aliveBeforePause = !publics(c, b1).some(v => v.ended)
  if (aliveBeforePause) {
    await a.room.leave()
    await until(() => publics(c, b1).at(-1)?.connected === false || publics(c, b1).some(v => v.ended), 5_000, 'C to see the pause')
    const paused = publics(c, b1).at(-1)
    if (!paused.ended) {
      await wait(1_500)
      const quiet = publics(c, b1).at(-1) === paused
      a = await player('eco-spect-a')
      await until(() => a.state.engage.some(r => r.resumed), 8_000, 'A\'s battle to resume')
      await until(() => publics(c, b1).at(-1)?.connected === true, 5_000, 'C to see the resume')
      const resumed = publics(c, b1).find(v => v.seq > paused.seq && v.connected)
      if (resumed.revision !== paused.revision || resumed.timeMs !== paused.timeMs) fail(`resume moved battle time: ${paused.revision}/${paused.timeMs} → ${resumed.revision}/${resumed.timeMs}`)
      check('pause and resume reach the spectator, the resume at the same revision', { revision: paused.revision, quietWhilePaused: quiet })
    } else log('b1 ended before it could be paused; pause/resume not exercised this run')
  }

  // 5. Area change: C crosses into the cave and back, for real.
  const before = c.state.publics.length
  const leftAt = Date.now()
  await cross(c, 'pradera', 'cueva-inicial')
  const crossedAt = c.state.publics.findIndex((m, i) => i >= before && m.snapshot === 'cueva-inicial')
  await wait(3_000)
  const whileAway = c.state.publics.slice(crossedAt + 1).filter(m => m.view)
  if (whileAway.length) fail(`C received ${whileAway.length} public messages while in the cave`)
  check('area change: nothing from Pradera while in the cave')
  const awayIndex = c.state.publics.length
  await cross(c, 'cueva-inicial', 'pradera')
  const backAt = c.state.publics.slice(awayIndex).find(m => m.snapshot === 'pradera')?.at ?? Date.now()
  const back = c.state.publics.slice(awayIndex)
  const running = [b1, b2].filter(id => !publics(a, id).some(v => v.ended) && !publics(c, id).some(v => v.ended) && !a.state.ends.some(e => e.battleId === id) && !b.state.ends.some(e => e.battleId === id))
  await until(() => running.every(id => back.some(m => m.view?.battleId === id) || c.state.publics.slice(awayIndex).some(m => m.view?.battleId === id)), 5_000, 'C to receive the running battles again')
  for (const id of running) {
    const firstBack = c.state.publics.slice(awayIndex).find(m => m.view?.battleId === id).view
    if (firstBack.events) fail(`back in Pradera, ${id} came with past events`)
  }
  check('back in Pradera: the still-running battles again, as they are now', { running: running.length })

  // 6. Ends: B flees (if its battle still runs); the server ends A's.
  if (!b.state.ends.some(e => e.battleId === b2)) {
    b.room.send(WORLD_MESSAGE.ECO_FLEE, { battleId: b2 })
    await until(() => b.state.ends.some(e => e.battleId === b2), 5_000, 'B\'s flight')
  }
  await until(() => a.state.ends.some(e => e.battleId === b1) || publics(c, b1).some(v => v.ended), 150_000, 'the server to end A\'s battle')
  await wait(1_500)
  for (const [owner, id] of [[a, b1], [b, b2]]) {
    const end = owner.state.ends.find(e => e.battleId === id)
    const seen = publics(c, id).filter(v => v.ended)
    // An end while C was in the cave is not C's to see: it was not there, and nothing brings it back.
    if (end && end.at >= leftAt && end.at <= backAt) {
      if (seen.length) fail(`C saw the end of ${id}, which happened while it was away`)
      continue
    }
    if (end && seen.length !== 1) fail(`C saw ${seen.length} ends of ${id}`)
    if (end && seen[0].ended.outcome !== end.outcome) fail(`C saw ${seen[0].ended.outcome}, the owner ${end.outcome}`)
    if (end && seen[0].revision !== end.snapshot.revision) fail(`the end of ${id}: revision ${seen[0].revision} vs owner ${end.snapshot.revision}`)
  }
  const ends = { a: a.state.ends.find(e => e.battleId === b1)?.outcome ?? null, b: b.state.ends.find(e => e.battleId === b2)?.outcome ?? null }
  check('ends reach the spectator once, with the owner\'s outcome', ends)
  const afterEnds = c.state.publics.length
  await wait(2_000)
  if (c.state.publics.slice(afterEnds).some(m => m.view && [b1, b2].includes(m.view.battleId))) fail('a message followed an end')

  // 7. Synchronisation and stream invariants.
  const compared = { b1: syncAgainst(a, c, b1), b2: syncAgainst(b, c, b2) }
  if (compared.b1 + compared.b2 === 0) fail('no public message with events could be compared with its owner\'s')
  check('synchronised with the owners (same revision → same time, HP and drawable events)', compared)
  report.streams = {}
  for (const p of [a, b, c, d]) for (const id of [b1, b2]) if (publics(p, id).length) report.streams[`${p.id}:${id}`] = streamInvariants(p, id)
  check('streams: revision and time never back; one end, last', report.streams)

  // 8. No private data on the wire.
  let payloads = 0
  for (const p of [a, b, c, d]) for (const m of p.state.publics) {
    if (!m.raw) continue
    payloads++
    for (const secret of [...PRIVATE, 'eco-spect-']) if (m.raw.includes(secret)) fail(`${p.id} received ${secret} in a public view`)
  }
  check('no private data in any public payload', { payloads })

  report.result = 'PASS'
  save()
  log('PASS')
} finally {
  await Promise.allSettled([a?.room.leave(), b?.room.leave(), c?.room.leave(), d?.room.leave()])
}
process.exit(0)
