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
//
// Long enough, reproducibly, without touching balance: each owner selects Double Team (#104, a
// legal move of the fixture that deals no damage) through the ordinary action intent, so its
// Pikachu does not knock the wild one out early. A lost or late public message is never retried:
// mutual receipt is read from each battle's START (seq 1, sent when it is reserved, whatever its
// length) and a timeout FAILS. The only retries left (D's arrival, the pause, the cave trip) need
// an end the SERVER told the owner (world:eco-battle-end) before the step could be shown; anything
// else — a missing message, a timeout, the infrastructure — FAILS. Every retry is recorded.
//
// Start and later synchronisation are accredited separately, at EVERY viewer of each of the first
// two battles (C and the other owner): its start, then at least one real owner update after the
// start (an ongoing tick with events, never the start or a final result alone) received publicly
// with the same battle, encounter, revision, time, HP and drawable events. Back from the cave,
// every battle whose owner was told no end before C's return must be re-sent fresh to C; a later
// end never excuses a missing re-send.
//
// Negative controls (harness only; server and product untouched). Each run must FAIL, unretried:
//   --drop <receiver>:<owner> (a, b, c or d; a or b): that receiver discards every public message of
//     the owner's FIRST battle; with --drop-mode updates it keeps the start (seq 1) and discards the rest;
//   --drop-return: back in Pradera, C discards the fresh re-send of the battle kept for the trip, and
//     B flees it 150 ms later (an end told to its owner AFTER the return).
// Exit 0 PASS, 1 FAIL, 3 setup. Synthetic data only; nothing is captured, granted or persisted.

import { writeFileSync } from 'node:fs'
import { Client } from '@colyseus/sdk'
import { isWalkable, portalTo } from '../../services/realtime/src/world/navigation.js'
import { PUBLIC_EVENT_FIELDS } from '../../services/realtime/src/world/ecoBattlePublic.js'
import { wildPoseAt } from '../../services/realtime/src/world/ecoScene.js'
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

/**
 * Each run's own synthetic players: a run never inherits a reservation (a battle in its reconnection
 * grace) from an earlier run of the same server.
 */
const RUN = arg('run', Date.now().toString(36))
const pid = letter => `eco-spect-${letter}-${RUN}`
report.run = RUN

/** --drop <receiver>:<owner>: the negative control (see the header). */
const DROP = (() => {
  const spec = arg('drop', null)
  if (!spec) return null
  const [receiver, owner] = spec.split(':')
  if (!['a', 'b', 'c', 'd'].includes(receiver) || !['a', 'b'].includes(owner)) { console.error('[eco-spectators-e2e] --drop <a|b|c|d>:<a|b>'); process.exit(3) }
  return { receiver: pid(receiver), owner }
})()
const DROP_MODE = arg('drop-mode', 'all')
if (!['all', 'updates'].includes(DROP_MODE)) { console.error('[eco-spectators-e2e] --drop-mode all|updates'); process.exit(3) }
const DROP_RETURN = process.argv.includes('--drop-return')
/** Each owner's FIRST target, known before its engage is sent (so a drop misses nothing). */
const firstTargets = {}
const dropped = []
/** --drop-return: the battle kept for the cave trip, and the one C discards after its return. */
let keptForTrip = null, returnDrop = null
report.negativeControl = DROP || DROP_RETURN ? { drop: arg('drop', null), mode: DROP ? DROP_MODE : null, dropReturn: DROP_RETURN, dropped } : null
report.retries = []

const PRIVATE = ['joinAck', 'controller', '"moves"', '"pp"', 'selected', 'actionId', 'serverTimeMs', 'lastMoveId', 'PP_CHANGED', 'ACTION_STARTED', 'ACTION_READY', '"atk"', '"spa"', 'benchmark-']

/** `previous`: the same player's earlier connection — its received history is kept (a rejoin adds to it). */
async function player(id, previous = null) {
  const kept = previous?.state
  const state = { eco: null, areaId: null, self: null, engage: [...(kept?.engage ?? [])], battle: [...(kept?.battle ?? [])], ends: [...(kept?.ends ?? [])], publics: [...(kept?.publics ?? [])], clock: null, sequence: 0 }
  const room = await new Client(URL).joinOrCreate('presence', {
    token: null, presenceProtocol: PRESENCE_PROTOCOL, worldProtocol: WORLD_PROTOCOL, ecoProtocol: ECO_PROTOCOL,
    tabId: `e2e-${id}-${Date.now()}`, benchmark: { id, username: id, area: 'pradera' },
  })
  room.reconnection.enabled = false
  room.onMessage('*', () => {})
  room.onMessage('presence:snapshot', snapshot => { if (snapshot.self) { state.self = snapshot.self; state.sequence = snapshot.self.moveSequence ?? 0 } })
  room.onMessage('presence:self', self => { state.self = self; state.sequence = Math.max(state.sequence, self.moveSequence ?? 0) })
  room.onMessage(WORLD_MESSAGE.SNAPSHOT, snapshot => {
    const from = state.areaId
    state.clock = { now: snapshot.now, at: Date.now() }
    state.areaId = snapshot.areaId; state.eco = snapshot.eco ?? null; state.publics.push({ snapshot: snapshot.areaId, at: Date.now() })
    if (DROP_RETURN && id === pid('c') && from === 'cueva-inicial' && snapshot.areaId === 'pradera' && keptForTrip && !returnDrop) {
      returnDrop = keptForTrip
      setTimeout(() => b.room.send(WORLD_MESSAGE.ECO_FLEE, { battleId: returnDrop }), 150)
    }
  })
  room.onMessage(WORLD_MESSAGE.ECO, message => { state.clock = { now: message.now, at: Date.now() }; state.eco = message.eco })
  room.onMessage(WORLD_MESSAGE.ECO_ENGAGE_RESULT, result => state.engage.push(result))
  room.onMessage(WORLD_MESSAGE.ECO_BATTLE, message => state.battle.push(message))
  room.onMessage(WORLD_MESSAGE.ECO_BATTLE_END, end => state.ends.push({ ...end, at: Date.now() }))
  room.onMessage(WORLD_MESSAGE.ECO_BATTLE_PUBLIC, view => {
    const dropFirst = DROP && id === DROP.receiver && view?.encounterId === firstTargets[DROP.owner] && (DROP_MODE === 'all' || view.seq > 1)
    const dropReturn = DROP_RETURN && id === pid('c') && returnDrop && view?.battleId === returnDrop
    if (dropFirst || dropReturn) { dropped.push({ receiver: id, battleId: view.battleId, seq: view.seq, ended: Boolean(view.ended), at: Date.now() }); return }
    state.publics.push({ view, raw: JSON.stringify(view), at: Date.now() })
  })
  room.send('presence:ready')
  return { id, room, state }
}

async function until(predicate, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) { if (predicate()) return; await wait(100) }
  fail(`timed out waiting for ${what}`)
}

/** The server's clock as this client last heard it (world snapshots and ECO views carry `now`). */
const serverNow = p => (p.state.clock ? p.state.clock.now + (Date.now() - p.state.clock.at) : Date.now())
/**
 * An encounter where it is SEEN (ECO-BATTLE-SCENE-1): busy, where the server froze it (`stand`);
 * free, on its shared patrol at the server's time — the tile the 3-tile limit is measured from. The
 * home tile stays in `home`.
 */
const encounterOf = (p, id) => {
  const e = p.state.eco?.encounters.find(x => x.id === id)
  if (!e) return null
  const seen = e.stand ?? wildPoseAt({ id: e.id, areaId: p.state.eco.areaId, tx: e.tx, ty: e.ty }, serverNow(p))
  return { ...e, home: { tx: e.tx, ty: e.ty }, tx: seen.tx, ty: seen.ty }
}
const distance = (p, t) => Math.max(Math.abs(p.state.self.tx - t.tx), Math.abs(p.state.self.ty - t.ty))
/** The public messages a player received (in order), optionally of one battle. */
const publics = (p, battleId = null) => p.state.publics.filter(m => m.view && (battleId === null || m.view.battleId === battleId)).map(m => m.view)

const STEPS = Object.freeze({ up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] })

/** The first step of a shortest walkable path (the server's own walkability) to a tile `goal` accepts. */
function firstStep(areaId, from, goal, limit = 40_000) {
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
      if (seen.has(key(nx, ny)) || !isWalkable(areaId, nx, ny)) continue
      seen.set(key(nx, ny), { from: key(x, y), direction })
      queue.push([nx, ny])
    }
  }
  return null
}

/** Walks a shortest path toward a target (a tile, or a moving encounter) until `within` tiles, re-planning every step. */
async function walkTo(p, target, within, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs
  let stuck = 0
  while (Date.now() < deadline) {
    const t = typeof target === 'string' ? encounterOf(p, target) : target
    if (!t) return false
    if (distance(p, t) <= within) return true
    const here = p.state.self
    const planned = firstStep(p.state.areaId ?? here.areaId, here, (x, y) => Math.max(Math.abs(x - t.tx), Math.abs(y - t.ty)) <= within)
    // Blocked by someone standing in the way (or no path): a random step, then plan again.
    const direction = !planned || stuck > 3 ? Object.keys(STEPS)[Math.floor(Math.random() * 4)] : planned
    const before = `${here.tx},${here.ty}`
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
 * Post-start synchronisation of one battle at one viewer: public updates (seq > 1, not an end) that
 * match a real owner update — an ongoing tick with events (never the start, never the final
 * result) — of the same revision, with the same battle, encounter, time, HP and drawable events.
 */
function updatePairs(owner, watcher, battleId) {
  const updates = new Map(owner.state.battle
    .filter(m => m.battleId === battleId && m.snapshot && m.events?.length && m.snapshot.outcome?.kind === 'ongoing')
    .map(m => [m.snapshot.revision, m]))
  let matched = 0
  for (const view of publics(watcher, battleId).filter(v => v.seq > 1 && !v.ended && v.events)) {
    const mine = updates.get(view.revision)
    if (!mine) continue
    if (view.battleId !== mine.battleId || view.encounterId !== targets.get(battleId)?.id) fail(`update ${battleId} at ${watcher.id}: identity`)
    if (view.timeMs !== mine.snapshot.timeMs) fail(`update ${battleId} at ${watcher.id}: time ${view.timeMs} vs owner ${mine.snapshot.timeMs}`)
    for (const id of ['player-0', 'wild-0']) {
      const own = mine.snapshot.combatants[id]
      if (view.combatants[id]?.currentHp !== (own.condition.currentHp ?? own.stats.hp)) fail(`update ${battleId} at ${watcher.id}: HP of ${id} at revision ${view.revision}`)
    }
    const drawable = mine.events.filter(e => PUBLIC_EVENT_FIELDS[e.event.type]).map(e => e.sequence).join(',')
    if (view.events.map(e => e.sequence).join(',') !== drawable) fail(`update ${battleId} at ${watcher.id}: events at revision ${view.revision}`)
    matched++
  }
  return matched
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
  a = await player(pid('a'), a)
  b = await player(pid('b'))
  c = await player(pid('c'))
} catch (error) {
  console.error(`[eco-spectators-e2e] setup: cannot join ${URL} (${error?.message ?? error}); start the isolated realtime first`)
  process.exit(3)
}

/** Which owner each battle belongs to (the owner objects change when A rejoins). */
const owners = new Map()
/** battleId → the encounter it was reserved against, as the owner saw it then. */
const targets = new Map()
const ownerOf = id => (owners.get(id) === 'a' ? a : b)
const endedFor = id => ownerOf(id).state.ends.some(e => e.battleId === id) || publics(c, id).some(v => v.ended)
const byDistance = p => [...p.state.eco.encounters].filter(e => !e.busy).sort((x, y) => distance(p, x) - distance(p, y))

const ownerEnd = id => ownerOf(id).state.ends.find(e => e.battleId === id) ?? null
/** A retry is allowed only for an end the server told the owner; recorded in the report. */
function retryAfterEnd(step, id) {
  const end = ownerEnd(id)
  if (!end) fail(`${step}: ${id} gave no sign the step could use, and its owner was told no end — not retried`)
  report.retries.push({ step, battleId: id, outcome: end.outcome, revision: end.snapshot.revision })
  log(`${step}: ${id} ended (${end.outcome}, told to its owner) before the step could be shown; again`)
}

/** Walks to the nearest free encounter it can reach (one may wander off) and stays in range. */
async function approach(p, skip = null) {
  for (const candidate of byDistance(p).filter(e => e.id !== skip).slice(0, 6)) {
    if (await walkTo(p, candidate.id, ECO_ENGAGE_RANGE - 2, 40_000)) return candidate
  }
  return fail(`${p.id} could not reach any encounter`)
}

/** Reserves the encounter and selects Double Team, the owner's own legal choice (see the header). */
async function reserveAt(p, name, candidate) {
  if (!firstTargets[name]) firstTargets[name] = candidate.id
  const answer = await engage(p, candidate.id)
  if (!answer.ok) {
    // Only the server's own word on position or availability may send the owner to another encounter.
    if (!['too-far', 'not-alive', 'busy'].includes(answer.reason)) fail(`${p.id}'s engage refused: ${answer.reason}`)
    report.retries.push({ step: 'engage', player: p.id, encounterId: candidate.id, reason: answer.reason })
    log(`${p.id}: engage refused by the server (${answer.reason}); another encounter`)
    return null
  }
  const { battleId, joinAck, snapshot } = answer.battle
  owners.set(battleId, name)
  targets.set(battleId, { id: candidate.id, tx: candidate.tx, ty: candidate.ty })
  const actionId = `${joinAck.controllerId}:${joinAck.nextActionSequence}`
  p.room.send(WORLD_MESSAGE.ECO_BATTLE_ACTION, { actionId, battleId, catalogVersion: snapshot.catalogVersion, battleRulesVersion: snapshot.battleRulesVersion, intent: { kind: 'useMove', combatantId: 'player-0', moveId: 104, targetId: 'player-0' } })
  await until(() => p.state.battle.some(m => m.result?.actionId === actionId), 5_000, `${p.id}'s Double Team selection to be answered`)
  const result = p.state.battle.find(m => m.result?.actionId === actionId).result
  if (result.kind !== 'accepted') fail(`${p.id}'s Double Team selection: ${result.kind} ${result.reason ?? ''}`)
  log(`${p.id} battles ${battleId} (#${candidate.speciesId}), Double Team selected`)
  return battleId
}

/** Approaches and reserves (the next candidate if one was refused). */
async function reserve(p, name) {
  for (let i = 0; i < 6; i++) {
    const battleId = await reserveAt(p, name, await approach(p))
    if (battleId) return { battleId }
  }
  return fail(`${p.id} could not reserve any encounter`)
}

/** A battle of `name`'s that is running now: the current one, or a new one. */
async function running(name) {
  const p = name === 'a' ? a : b
  const current = [...owners].filter(([id, who]) => who === name && !endedFor(id)).map(([id]) => id).at(-1)
  return current ?? (await reserve(p, name)).battleId
}

try {
  await until(() => [a, b, c].every(p => p.state.self && p.state.areaId === 'pradera' && p.state.eco), 15_000, 'A, B and C in Pradera')
  await until(() => (a.state.eco.encounters.length ?? 0) >= 3, 60_000, 'Pradera to fill')

  // 0. C waits beside the cave portal, still in Pradera (so its crossing later is one step).
  const mouth = portalTo('pradera', 'cueva-inicial')
  if (!(await walkTo(c, mouth, 1, 120_000))) fail('C could not reach the cave mouth')

  // 1–2. Two battles at once, really active together, and routed to everyone but their owners.
  //   No retry here: both owners stand in range first and engage back to back; every viewer must
  //   receive each START (seq 1, sent at the reservation whatever the battle's length); a timeout FAILS.
  const near = { a: await approach(a), b: null }
  near.b = await approach(b, near.a.id)
  /** Engages; after a refusal the server explained (recorded), it approaches another encounter — at most twice more. */
  const firstBattle = async (p, name, candidate, skip) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const battleId = await reserveAt(p, name, candidate)
      if (battleId) return battleId
      candidate = await approach(p, skip())
      firstTargets[name] = candidate.id
    }
    return fail(`${p.id}: three engages refused`)
  }
  const b1 = await firstBattle(a, 'a', near.a, () => near.b.id)
  const b2 = await firstBattle(b, 'b', near.b, () => targets.get(b1).id)
  const startedFor = (p, id) => publics(p, id).some(v => v.seq === 1)
  await until(() => startedFor(c, b1) && startedFor(c, b2) && startedFor(a, b2) && startedFor(b, b1), 5_000, 'every viewer to receive both battles\' start (a lost public receipt fails, it is not retried)')
  // Later synchronisation, separately from the start: a real owner update after the start, received
  // publicly by EACH viewer of each battle (C and the other owner). A loss is a timeout: FAIL, unretried.
  /** The viewers of each first battle, as they are now (A's object changes when it rejoins). */
  const viewersOf = id => (id === b1 ? [c, b] : [c, a])
  const updatesSeen = () => Object.fromEntries([b1, b2].flatMap(id => viewersOf(id).map(v => [`${v.id}:${id}`, updatePairs(ownerOf(id), v, id)])))
  await until(() => Object.values(updatesSeen()).every(n => n > 0), 30_000, 'a post-start owner update of each battle received by every viewer (a lost update fails, it is not retried)')
  report.updatesBeforeD = updatesSeen()
  if ([...owners].some(([id, who]) => publics(who === 'a' ? a : b, id).length)) fail('an owner received its own battle as public')
  if (!publics(a, b2).length || !publics(b, b1).length) fail('an owner did not receive the other battle')
  if (targets.get(b1).id === targets.get(b2).id) fail('the two battles are against the same individual')
  for (const id of [b1, b2]) {
    const first = publics(c, id)[0]
    const target = targets.get(id)
    if (first.seq !== 1 || first.events || first.ended) fail(`C's first view of ${id}: ${JSON.stringify({ seq: first.seq, events: first.events?.length, ended: first.ended })}`)
    if (first.encounterId !== target.id) fail(`${id} names ${first.encounterId}, reserved against ${target.id}`)
    // ECO-BATTLE-SCENE-1: the area list freezes it on the scene's tile (`stand`), and the Pokémon stands in front of it
    await until(() => encounterOf(c, target.id)?.stand, 3_000, 'the area list to carry the frozen tile')
    if (Math.abs(first.stage.pokemon.tx - first.stage.wild.tx) + Math.abs(first.stage.pokemon.ty - first.stage.wild.ty) !== 1) fail(`${id}: the Pokémon is not in front of the wild one: ${JSON.stringify(first.stage)}`)
    const listed = encounterOf(c, target.id)
    if (!listed || first.stage.wild.tx !== listed.tx || first.stage.wild.ty !== listed.ty) fail(`${id}: wild tile ${JSON.stringify(first.stage.wild)} vs listed ${JSON.stringify(listed && { tx: listed.tx, ty: listed.ty })}`)
  }
  // Active overlap as C saw it: both started before either ended (neither had ended at all here).
  const startedAt = id => c.state.publics.find(m => m.view?.battleId === id).at
  const endedAt = id => c.state.publics.find(m => m.view?.battleId === id && m.view.ended)?.at ?? Infinity
  if (!(Math.max(startedAt(b1), startedAt(b2)) < Math.min(endedAt(b1), endedAt(b2)))) fail('the two battles were never active together for C')
  const pairsBeforeD = { [b1]: syncAgainst(a, c, b1), [b2]: syncAgainst(b, c, b2) }
  check('routing: both battles active together; C sees both; each owner receives the other one, never its own; ids and tiles exact; an event pair for each', { pairs: pairsBeforeD })

  // 3. Late arrival: D joins a battle that is live and whose events C has already seen.
  for (let attempt = 0; ; attempt++) {
    if (attempt === 3) fail('no battle stayed live for D\'s arrival')
    const live = [b1, b2].find(id => !endedFor(id) && syncAgainst(ownerOf(id), c, id) > 0) ?? await running('b')
    await until(() => ownerEnd(live) || publics(c, live).some(v => v.events?.length), 20_000, 'C to have seen events of the live battle')
    if (!publics(c, live).some(v => v.events?.length)) { retryAfterEnd('late arrival', live); continue }
    d = await player(pid('d'), d)
    await until(() => d.state.areaId === 'pradera', 15_000, 'D in Pradera')
    const joinedAt = d.state.publics.findLast(m => m.snapshot === 'pradera').at
    await until(() => (ownerEnd(live) && ownerEnd(live).at <= joinedAt) || d.state.publics.some(m => m.at >= joinedAt && m.view?.battleId === live), 5_000, 'D to receive the live battle')
    const arrival = d.state.publics.find(m => m.at >= joinedAt && m.view?.battleId === live)
    if (!arrival) { retryAfterEnd('late arrival', live); await d.room.leave(); continue } // ended before D arrived (the owner was told)
    if (arrival.view.ended) fail(`D's first view of ${live} was its end`)
    if (arrival.view.events) fail(`D's first view of ${live} carried past events`)
    const cBefore = c.state.publics.filter(m => m.view?.battleId === live && m.at <= arrival.at).at(-1)?.view
    if (cBefore && arrival.view.revision < cBefore.revision) fail(`D's first view of ${live} is older than what C already had`)
    for (const m of d.state.publics.filter(x => x.at >= joinedAt && x.view)) {
      const firstOfBattle = d.state.publics.find(x => x.at >= joinedAt && x.view?.battleId === m.view.battleId) === m
      if (firstOfBattle && m.view.events) fail(`D's first view of ${m.view.battleId} carried past events`)
    }
    check('late arrival: D receives the live battle as it is, without the effects C already saw', { battle: live, revision: arrival.view.revision })
    break
  }

  // 4. Pause and resume: A drops its socket mid-battle and comes back inside the grace.
  for (let attempt = 0; ; attempt++) {
    if (attempt === 3) fail('A\'s battles kept ending before a pause could be checked')
    const paused0 = await running('a')
    await a.room.leave()
    await until(() => publics(c, paused0).at(-1)?.connected === false || endedFor(paused0), 5_000, 'C to see the pause')
    const paused = publics(c, paused0).at(-1)
    if (paused.ended) { retryAfterEnd('pause', paused0); a = await player(pid('a'), a); await until(() => a.state.areaId === 'pradera', 15_000, 'A back'); continue }
    await wait(1_500)
    const quiet = publics(c, paused0).at(-1) === paused
    a = await player(pid('a'), a)
    await until(() => a.state.engage.some(r => r.resumed), 8_000, 'A\'s battle to resume')
    await until(() => publics(c, paused0).at(-1)?.connected === true || endedFor(paused0), 5_000, 'C to see the resume')
    const resumed = publics(c, paused0).find(v => v.seq > paused.seq)
    if (!resumed.connected) fail('the message after the pause was not the resume')
    if (resumed.revision !== paused.revision || resumed.timeMs !== paused.timeMs) fail(`resume moved battle time: ${paused.revision}/${paused.timeMs} → ${resumed.revision}/${resumed.timeMs}`)
    if (!quiet) fail('messages arrived while the battle was paused')
    check('pause and resume reach the spectator; the resume keeps the revision', { battle: paused0, revision: paused.revision })
    break
  }

  // 5. Area change: C crosses into the cave and back, for real, while a battle runs.
  for (let attempt = 0; ; attempt++) {
    if (attempt === 3) fail('no battle survived C\'s trip to the cave')
    const kept = await running('b')
    keptForTrip = kept
    if (!(await walkTo(c, mouth, 1, 60_000))) fail('C could not get back beside the cave mouth')
    await cross(c, 'pradera', 'cueva-inicial')
    const outAt = c.state.publics.findLast(m => m.snapshot === 'cueva-inicial').at
    await wait(2_500)
    const whileAway = c.state.publics.filter(m => m.at > outAt && m.view)
    if (whileAway.length) fail(`C received ${whileAway.length} public messages while in the cave`)
    await cross(c, 'cueva-inicial', 'pradera')
    const backAt = c.state.publics.findLast(m => m.snapshot === 'pradera').at
    await wait(800)
    const after = c.state.publics.filter(m => m.at >= backAt && m.view)
    const ownersEnds = [...owners.keys()].map(id => ownerOf(id).state.ends.find(e => e.battleId === id)).filter(Boolean)
    for (const end of ownersEnds.filter(e => e.at > outAt && e.at < backAt)) {
      if (after.some(m => m.view.battleId === end.battleId)) fail(`${end.battleId} ended while C was away and came back`)
    }
    // Every battle whose owner was told no end BEFORE C's return was running at it: the server re-sends
    // it right after the snapshot. Its absence FAILS — an end told later never excuses it.
    const activeAtReturn = [...owners.keys()].filter(id => !(ownerEnd(id) && ownerEnd(id).at < backAt))
    const resent = {}
    for (const id of activeAtReturn) {
      const first = after.find(m => m.view.battleId === id)?.view
      if (!first || first.ended) fail(`back in Pradera, C got no fresh re-send of ${id}, running at its return (its owner's end, if any, came ${ownerEnd(id) ? ownerEnd(id).at - backAt + ' ms after' : 'never'})`)
      if (first.events) fail(`back in Pradera, ${id} came with past events`)
      resent[id] = first.revision
    }
    // A retry only when every battle had ended, as told to its owner, before C came back.
    if (!activeAtReturn.length) { retryAfterEnd('area change', kept); continue }
    check('area change: nothing from Pradera while in the cave; back, every running battle re-sent fresh, without past effects', { resent })
    break
  }

  // 6. Ends: B flees its running battle; the server ends A's.
  const fleeing = await running('b')
  b.room.send(WORLD_MESSAGE.ECO_FLEE, { battleId: fleeing })
  await until(() => b.state.ends.some(e => e.battleId === fleeing), 5_000, 'B\'s flight')
  const decided = await running('a')
  await until(() => a.state.ends.some(e => e.battleId === decided), 150_000, 'the server to end A\'s battle')
  await wait(2_000)
  for (const id of [fleeing, decided]) {
    const end = ownerOf(id).state.ends.find(e => e.battleId === id)
    const other = owners.get(id) === 'a' ? b : a
    for (const viewer of [c, other]) {
      const seen = publics(viewer, id).filter(v => v.ended)
      if (seen.length !== 1) fail(`${viewer.id} saw ${seen.length} ends of ${id}`)
      if (seen[0].ended.outcome !== end.outcome || seen[0].revision !== end.snapshot.revision) fail(`the end of ${id}: ${viewer.id} ${seen[0].ended.outcome}/${seen[0].revision}, owner ${end.outcome}/${end.snapshot.revision}`)
    }
  }
  check('ends reach C and the other owner once, last, with the owner\'s outcome and state', { fled: fleeing, decided: a.state.ends.find(e => e.battleId === decided).outcome })

  // 7. Synchronisation and stream invariants over every battle of the run.
  const compared = {}
  for (const id of owners.keys()) compared[id] = syncAgainst(ownerOf(id), c, id)
  for (const id of [b1, b2]) if (!(compared[id] > 0)) fail(`no event pair compared for ${id}`)
  report.updatesAtEnd = Object.fromEntries([b1, b2].flatMap(id => viewersOf(id).map(v => [`${v.id}:${id}`, updatePairs(ownerOf(id), v, id)])))
  for (const [key, n] of Object.entries(report.updatesAtEnd)) if (!(n > 0)) fail(`no post-start update pair for ${key}`)
  check('synchronised with the owners (same revision → same time, HP and drawable events)', compared)
  report.streams = {}
  for (const p of [a, b, c, d]) for (const id of owners.keys()) if (publics(p, id).length) report.streams[`${p.id}:${id}`] = streamInvariants(p, id)
  check('streams: seq grows between world snapshots; revision and time never back; one end, last', report.streams)

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
