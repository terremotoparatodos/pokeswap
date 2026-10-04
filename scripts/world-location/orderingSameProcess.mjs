// WORLD LOCATION-4 harness, same-process mode: two presence hosts in ONE Node process.
//
// Two copies of the room module (each with its own HostLifecycle, journal and location
// service) share one embedded Postgres running the real migrations, through the real SQL
// adapter. Host A is acquired and activated first, B after it (B is the newer generation).
// Every store call gets a distributed latency; the scenario injects the T3/T4/T7 fault on
// the OLDER session's claim. Clients are the room's own fake sockets (no transport), so a
// repetition costs milliseconds of CPU and the races are dense.
//
// The hosts do not react to each other (`reactToHostChanges: false`): this is the window,
// bounded by one renewal in production, before the older host learns of the newer one and
// drains. That window is exactly where T3/T4/T7 happened (LOCATION-3B).
//
// Per repetition (a new player): session A (older) joins, then session B (newer, on the
// newer host — `cross` — or on the same host — `same`). Checked:
//   I1 the row's owner key is B's key;
//   I2 B is never closed by the server before it leaves;
//   I3 B's last position is the row after it leaves;
//   I4 no save of A is applied after B's claim.

import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { pool, tail, uniform } from './harnessRandom.mjs'

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

async function waitFor(condition, label, timeoutMs = 15_000) {
  const started = performance.now()
  while (!condition()) {
    if (performance.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await wait(5)
  }
}

/** The SQL adapter with per-call latency and faults; every location call is recorded. */
function faulty(base, inst, { random, events, rules }) {
  const take = (op, userIds) => {
    const index = rules.findIndex(r => r.op === op && r.inst === inst && userIds.includes(r.userId))
    return index < 0 ? null : rules.splice(index, 1)[0]
  }
  const traced = (op, userIds, payload, call) => async (...args) => {
    const event = { inst, op, userIds, payload, tRecv: performance.now(), tDone: null, answer: null, rule: null }
    events.push(event)
    const rule = take(op, userIds)
    event.rule = rule?.mode ?? null
    await wait(tail(random))
    const run = async () => { const answer = await call(...args); event.answer = answer; event.tDone = performance.now(); return answer }
    if (rule?.mode === 'hold') {
      // Never answered: the journal gives up; the operation lands when the harness releases it.
      return new Promise((_, reject) => { rule.release = async () => { await run(); reject(new Error('released late')) }; rules.held.push(rule) })
    }
    if (rule?.mode === 'delay') await wait(rule.ms)
    const answer = await run()
    if (rule?.mode === 'lose') throw new Error('response lost')
    return answer
  }
  return {
    ...base,
    locationClaim: (userId, key) => traced('location_claim', [userId], key, base.locationClaim)(userId, key),
    locationSave: (rows, host) => traced('location_save', rows.map(r => r.userId), rows.map(r => ({ ...r })), base.locationSave)(rows, host),
  }
}

export async function runSameProcess({ tree, reps, random, width = 25, scenarios = ['T3', 'T4', 'T7'] }) {
  const rt = `${tree}services/realtime/src/`
  const load = path => import(pathToFileURL(`${rt}${path}`).href)
  const roomUrl = pathToFileURL(`${rt}rooms/PresenceRoom.js`).href
  const modules = { A: await import(`${roomUrl}?instance=harness-a`), B: await import(`${roomUrl}?instance=harness-b`) }
  if (typeof modules.A.configurePresenceHost !== 'function') return { applicable: false, reason: 'this tree has no presence host (pre WORLD LOCATION-4)' }
  const { HostLifecycle } = await load('presence/hostLifecycle.js')
  const { openLocalDatabase, serviceQuery } = await load('world/persistence/dev/localDatabase.js')
  const { createSqlPlayerData } = await load('world/persistence/playerData.js')
  const { createDemoSkillPolicy } = await load('world/demoSkillPolicy.js')
  const { createStaticOwnership } = await load('world/pokemonOwnership.js')
  const { openDirection } = await load('world/testing.js')
  const { WORLD_PROTOCOL } = await load('world/worldProtocol.js')
  const { MESSAGE } = await load('protocol/messages.js')

  const db = await openLocalDatabase()
  const data = createSqlPlayerData(serviceQuery(db))
  const events = []
  const rules = []
  rules.held = []
  const hosts = {}
  const rooms = {}
  for (const inst of ['A', 'B']) {
    hosts[inst] = new HostLifecycle({ store: data, log: () => {} })
    await hosts[inst].acquire()
    await hosts[inst].activate()
    const module = modules[inst]
    module.configureWorld({ skills: createDemoSkillPolicy({ durationMs: 3_000 }), ownership: createStaticOwnership({}) })
    module.configurePresenceHost(hosts[inst], { reactToHostChanges: false })
    module.configureLocationPersistence({ mode: 'on', store: faulty(data, inst, { random, events, rules }), log: () => {} })
    rooms[inst] = new module.PresenceRoom()
    rooms[inst].onCreate()
  }

  const client = id => {
    const messages = []
    const leaves = []
    return { sessionId: id, userData: undefined, messages, leaves, send: (type, payload) => messages.push({ type, payload }), leave: (code, reason) => leaves.push([code, reason]) }
  }
  const self = c => {
    const entry = [...c.messages].reverse().find(e => e.type === MESSAGE.SELF || (e.type === MESSAGE.SNAPSHOT && e.payload.self))
    return entry ? (entry.type === MESSAGE.SELF ? entry.payload : entry.payload.self) : null
  }
  const step = (room, c) => {
    const at = self(c)
    const direction = openDirection(at.areaId, at, ['right', 'left', 'up', 'down'])
    room.move(c, { direction, running: false, sequence: at.moveSequence + 1 })
    return self(c)
  }
  const answered = (inst, op, userId) => events.filter(e => e.inst === inst && e.op === op && e.userIds.includes(userId) && e.tDone !== null)
  const row = async userId => (await serviceQuery(db)('SELECT area_id, tx, ty, owner_generation::int AS g, owner_seq::int AS s, owner_session AS session FROM public.world_player_locations WHERE user_id = $1', [userId])).rows[0] ?? null

  async function repetition(scenario, i) {
    const variant = i % 4 === 3 ? 'same' : 'cross'
    const userId = randomUUID()
    await db.query('INSERT INTO auth.users VALUES ($1)', [userId])
    const auth = { kind: 'player', userId, username: 'P', token: null }
    const where = { A: 'A', B: variant === 'cross' ? 'B' : 'A' }
    const fault = scenario === 'T3' ? { mode: 'delay', ms: uniform(random, 300, 1_200) } : scenario === 'T4' ? { mode: 'hold' } : null
    if (fault) rules.push({ op: 'location_claim', inst: where.A, userId, ...fault })
    const gap = scenario === 'T7' ? uniform(random, 0, 300) : scenario === 'T4' ? 300 : uniform(random, 20, 200)
    const a = client(`a-${userId}`)
    const b = client(`b-${userId}`)
    await rooms[where.A].onJoin(a, { worldProtocol: WORLD_PROTOCOL, presenceProtocol: 3, tabId: `tab-a-${i}-harness` }, auth)
    rooms[where.A].ready(a)
    await wait(gap)
    await rooms[where.B].onJoin(b, { worldProtocol: WORLD_PROTOCOL, presenceProtocol: 3, tabId: `tab-b-${i}-harness` }, auth)
    rooms[where.B].ready(b)
    // By construction A's key is the smaller one (accepted earlier on the same host, or on the
    // older host) and B's the greater: a fact of the scenario, not of the protocol under test.
    const greater = (x, y) => x.generation > y.generation || (x.generation === y.generation && x.seq > y.seq)
    const claimsOf = () => events.filter(e => e.op === 'location_claim' && e.userIds.includes(userId) && e.payload?.sessionId)
    const keys = () => {
      const all = [...new Map(claimsOf().map(e => [e.payload.sessionId, e.payload])).values()]
      return all.length < 2 ? null : { a: all.reduce((m, k) => (greater(m, k) ? k : m)), b: all.reduce((m, k) => (greater(k, m) ? k : m)) }
    }
    await waitFor(() => keys() && claimsOf().some(e => e.payload.sessionId === keys().b.sessionId && e.tDone !== null) && (self(b) || b.leaves.length), 'B claimed and placed')
    const { a: aKey, b: bKey } = keys()
    const ofA = e => e.payload?.sessionId === aKey.sessionId
    const bClaim = claimsOf().find(e => e.payload.sessionId === bKey.sessionId && e.tDone !== null)
    const tB = bClaim.tDone
    if (scenario === 'T3') await waitFor(() => claimsOf().some(e => ofA(e) && e.rule === 'delay' && e.tDone !== null), 'the delayed claim landed')
    if (scenario === 'T4') {
      const held = () => rules.held.find(r => r.userId === userId)
      await waitFor(() => held(), 'the claim is held')
      // The journal gives up (claimWaitMs) and retries with the SAME key; then the held one lands.
      await waitFor(() => claimsOf().some(e => ofA(e) && e.tDone !== null) || a.leaves.length > 0, 'the retry was answered', 20_000)
      const rule = held()
      rules.held.splice(rules.held.indexOf(rule), 1)
      await rule.release()
    }
    const bLeftEarly = b.leaves.length > 0
    const bAt = step(rooms[where.B], b)
    rooms[where.B].onLeave(b)
    const savesBefore = answered(where.B, 'location_save', userId).length
    await waitFor(() => answered(where.B, 'location_save', userId).length > savesBefore, 'B saved on leave')
    const aOpen = a.leaves.length === 0
    if (aOpen && self(a)) step(rooms[where.A], a)
    rooms[where.A].onLeave(a)
    await wait(1_300) // A's urgent save, if any, has had its tick
    const final = await row(userId)
    // Only across hosts are A's saves attributable (on one host the journal holds one session per player).
    const aAppliedAfter = variant === 'cross'
      ? events.filter(e => e.inst === 'A' && e.op === 'location_save' && e.userIds.includes(userId) && e.tDone > tB && e.answer?.status === 'ok' && e.answer.results?.get?.(userId) === 'applied')
      : []
    const violations = []
    if (final?.g !== bKey.generation || final?.s !== bKey.seq) violations.push(`I1 owner ${final?.g}/${final?.s} is not B's key ${bKey.generation}/${bKey.seq}`)
    if (bLeftEarly) violations.push(`I2 B closed by the server (${JSON.stringify(b.leaves)})`)
    if (!final || final.area_id !== bAt.areaId || final.tx !== bAt.tx || final.ty !== bAt.ty) violations.push(`I3 row ${final?.area_id}:${final?.tx},${final?.ty} is not B's last ${bAt.areaId}:${bAt.tx},${bAt.ty}`)
    if (aAppliedAfter.length) violations.push(`I4 ${aAppliedAfter.length} save(s) of A applied after B's claim`)
    const aClaims = claimsOf().filter(ofA)
    return { scenario, variant, i, fault: fault ? { ...fault } : null, gap, violations, aOutcome: aOpen ? 'open' : a.leaves[0]?.[0], aClaims: aClaims.map(e => e.answer?.status ?? 'pending') }
  }

  const results = {}
  try {
    for (const scenario of scenarios) {
      const started = performance.now()
      const runs = await pool(reps, width, i => repetition(scenario, i).catch(error => ({ scenario, i, violations: [`error: ${String(error?.message ?? error)}`] })))
      results[scenario] = {
        reps: runs.length, ms: Math.round(performance.now() - started),
        violated: runs.filter(r => r.violations.length).length,
        variants: { cross: runs.filter(r => r.variant === 'cross').length, same: runs.filter(r => r.variant === 'same').length },
        olderOutcomes: runs.reduce((count, r) => { const k = String(r.aOutcome); count[k] = (count[k] ?? 0) + 1; return count }, {}),
        examples: runs.filter(r => r.violations.length).slice(0, 5),
      }
    }
  } finally {
    for (const inst of ['A', 'B']) {
      rooms[inst].setSimulationInterval(null)
      rooms[inst].clock.clear()
      modules[inst].configureLocationPersistence({ mode: 'off' })
      modules[inst].configurePresenceHost(null)
      await hosts[inst].stop()
    }
    await db.close()
  }
  return { applicable: true, results }
}
