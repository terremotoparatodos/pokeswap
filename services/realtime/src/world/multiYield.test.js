import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_UNITS, REFILL_MS, drawStock, generationAt, settlementIdOf, stockedUnit } from './nodeStock.js'
import { createStaticOwnership } from './pokemonOwnership.js'
import { RESYNC_DELAYS_MS, RESYNC_HOLD_STEPS, ResourceAuthority, SETTLE_RETRY_DELAYS_MS } from './resourceAuthority.js'
import { RESPAWN_MS } from './resourceLayout.js'
import { keysDeep, manualClock, praderaNodesNearSpawn, settle } from './testing.js'
import { WORK_TICK_MS, publicNode } from './worldProtocol.js'

// RESOURCE YIELD-2: sequences of units on one reservation, the ordered commit
// pipeline, stopping (cancel, move, disconnect), private partial nodes and
// their refill. SKILLS is scripted here; the real rules and the real database
// run in integration.test.js and persistence/multiYield.database.test.js.

const [{ node: TREE, stands: [SPOT_A, SPOT_B] }] = praderaNodesNearSpawn()
const STEP = 50
const UNIT = 2 * WORK_TICK_MS
const SUMMARY = { xpGained: 10, rewards: [{ itemId: 'log', quantity: 1 }] }

/**
 * An authority on a manual clock with a scripted SKILLS. `latency` (ms per
 * settle call, in call order) is simulated on the same clock: a settle call
 * resolves only once the clock has passed its due instant.
 */
function harness({ stock = { min: 3, max: 3 }, attempts = [2], latency = [0], commit = null, random = () => 0, loadNodes = null } = {}) {
  const clock = manualClock()
  const actors = new Map([
    ['a', { id: 'a', areaId: 'pradera', ...SPOT_A }],
    ['b', { id: 'b', areaId: 'pradera', ...SPOT_B }],
  ])
  const log = { authorized: [], calls: [], settled: [], cancelled: [], yields: [], done: [], nodes: [], draws: 0, loads: 0 }
  const waiting = []
  const skills = {
    async authorizeWorkAttempt(attempt) {
      const n = attempts[Math.min(log.authorized.length, attempts.length - 1)]
      log.authorized.push({ id: attempt.actionId, at: clock.now() })
      return { ok: true, durationMs: n * WORK_TICK_MS, ...(stock ? { stock } : {}) }
    },
    settleWork(settlement) {
      const call = { id: settlement.actionId, at: clock.now(), settlement, resolvedAt: null }
      const due = clock.now() + latency[Math.min(log.calls.length, latency.length - 1)]
      log.calls.push(call)
      const answer = commit?.(settlement, log) ?? { ok: true, status: log.settled.includes(settlement.actionId) ? 'duplicate' : 'applied', summary: SUMMARY }
      return new Promise(resolve => waiting.push({ due, resolve: () => {
        call.resolvedAt = clock.now()
        if (answer.ok && answer.status === 'applied') log.settled.push(settlement.actionId)
        resolve(answer)
      } }))
    },
    cancelWork(cancellation) { log.cancelled.push(cancellation.actionId) },
  }
  let ids = 0
  const authority = new ResourceAuthority({
    skills, ownership: createStaticOwnership({ a: [25], b: [6] }), lookupActor: id => actors.get(id) ?? null,
    now: clock.now, newActionId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`, sleep: async () => {},
    random: () => { log.draws++; return random() },
    onNode: record => log.nodes.push(record),
    onYield: (playerId, unit) => log.yields.push({ playerId, ...unit, at: clock.now() }),
    onDone: (playerId, event) => log.done.push({ playerId, ...event, at: clock.now() }),
    ...(loadNodes ? { loadNodes: async () => { log.loads++; return loadNodes(log, clock) } } : {}),
  })
  /** Resolves every due settle call, letting the chain move on. */
  const pump = async () => {
    for (let round = 0; round < 8; round++) {
      for (const entry of waiting.filter(w => w.due <= clock.now())) { waiting.splice(waiting.indexOf(entry), 1); entry.resolve() }
      await settle()
    }
  }
  /** The room's fixed tick, `ms` long. */
  const run = async ms => {
    for (let left = ms; left > 0; left -= STEP) { clock.advance(Math.min(STEP, left)); authority.tick(); await pump() }
  }
  const work = async (id = 'a', pokemon = id === 'a' ? 25 : 6, requestId = 1) => {
    const reply = await authority.requestWork(actors.get(id), { nodeId: TREE.id, pokemonInstanceId: pokemon, requestId })
    await pump()
    return reply
  }
  return { authority, clock, actors, log, run, pump, work, waiting }
}

const sid = (actionId, index) => settlementIdOf(actionId, index)

// ── nodeStock ────────────────────────────────────────────────────────────────

test('settlement ids: <actionId>-<hex2 index>, stable, and only for index 0..19', () => {
  const base = '00000000-0000-4000-8000-000000000001'
  assert.equal(sid(base, 0), `${base}-00`)
  assert.equal(sid(base, 10), `${base}-0a`)
  assert.equal(sid(base, 19), `${base}-13`)
  assert.equal(sid(base, 3), sid(base, 3), 'every retry of a unit uses the same id')
  assert.equal(MAX_UNITS, 20)
  for (const bad of [20, -1, 1.5, Number.NaN, '1']) assert.throws(() => sid(base, bad), RangeError)
})

test('stock draws: uniform over SKILLS’ range, extremes included; no range is one unit', () => {
  for (const [range, low, high] of [[{ min: 2, max: 4 }, 2, 4], [{ min: 2, max: 3 }, 2, 3], [{ min: 1, max: 3 }, 1, 3], [{ min: 1, max: 1 }, 1, 1]]) {
    assert.equal(drawStock(range, () => 0), low)
    assert.equal(drawStock(range, () => 0.9999999), high)
    const seen = new Set(Array.from({ length: 100 }, (_, i) => drawStock(range, () => i / 100)))
    assert.deepEqual([...seen].sort(), Array.from({ length: high - low + 1 }, (_, i) => low + i))
  }
  assert.equal(drawStock(null, () => 0.9), 1)
})

test('generation at the reservation: a live partial’s token and stock; an expired or absent one is a new generation', () => {
  const partial = { stock: 2, token: 't-00', actionId: null, respawnAt: 10_000 }
  assert.deepEqual(generationAt(partial, 9_999), { expectedToken: 't-00', stockBefore: 2, fresh: false })
  assert.deepEqual(generationAt(partial, 10_000), { expectedToken: null, stockBefore: null, fresh: true }, 'expired at its instant (rule B)')
  assert.deepEqual(generationAt(null, 0), { expectedToken: null, stockBefore: null, fresh: true })
  assert.deepEqual(generationAt({ ...partial, actionId: 'x' }, 0).fresh, true, 'a reserved record is not a partial')
  assert.deepEqual(generationAt({ state: 'depleted', stock: null, token: 't-01', actionId: null, respawnAt: 99 }, 0).fresh, true)
})

test('stockedUnit: first, intermediate and last unit — the node and the database contract', () => {
  const at = { expectedToken: null, reservedAt: 1_000, endsAt: 2_200 }
  const first = stockedUnit(TREE, { ...at, settlementId: 's-00', before: 3 })
  assert.deepEqual(first.next, { state: 'available', stock: 2, token: 's-00', respawnAt: 2_200 + REFILL_MS })
  assert.deepEqual(first.world.stock, { before: 3, after: 2 })
  assert.equal(first.world.expectedToken, null)
  const middle = stockedUnit(TREE, { ...at, settlementId: 's-01', before: 2, expectedToken: 's-00' })
  assert.deepEqual([middle.next.stock, middle.world.expectedToken, middle.world.reservedAt], [1, 's-00', 1_000])
  const last = stockedUnit(TREE, { ...at, settlementId: 's-02', before: 1, expectedToken: 's-01' })
  assert.deepEqual(last.next, { state: 'depleted', stock: null, token: 's-02', respawnAt: 2_200 + RESPAWN_MS[TREE.resourceKind] })
  assert.deepEqual(last.world.stock, { before: 1, after: 0 })
})

// ── Sequences ────────────────────────────────────────────────────────────────

test('a stock-3 node yields three units, each with its own settlement and CAS, then depletes', async () => {
  const h = harness()
  const started = await h.work()
  assert.equal(started.ok, true)
  await h.run(4 * UNIT)
  const id = started.actionId
  assert.deepEqual(h.log.settled, [sid(id, 0), sid(id, 1), sid(id, 2)])
  assert.deepEqual(h.log.authorized.map(a => a.id), [sid(id, 0), sid(id, 1), sid(id, 2)], 'no fourth authorization')
  assert.deepEqual(h.log.yields.map(y => [y.index, y.actionId]), [[0, id], [1, id], [2, id]])
  const worlds = h.log.calls.map(call => call.settlement.world)
  assert.deepEqual(worlds.map(w => w.stock), [{ before: 3, after: 2 }, { before: 2, after: 1 }, { before: 1, after: 0 }])
  assert.deepEqual(worlds.map(w => w.expectedToken), [null, sid(id, 0), sid(id, 1)])
  assert.deepEqual(new Set(worlds.map(w => w.reservedAt)), new Set([started.startedAt]), 'every unit is checked against the reservation instant')
  assert.deepEqual(worlds.map(w => w.state), ['available', 'available', 'depleted'])
  const [done] = h.log.done
  assert.deepEqual({ ok: done.ok, reason: done.reason, total: done.total }, { ok: true, reason: 'depleted', total: { units: 3, xpGained: 30, rewards: [{ itemId: 'log', quantity: 3 }] } })
  const lastEnd = started.startedAt + 3 * UNIT
  assert.deepEqual([h.authority.store.get(TREE.id).state, h.authority.store.get(TREE.id).respawnAt], ['depleted', lastEnd + RESPAWN_MS[TREE.resourceKind]])
  assert.equal(h.log.draws, 1, 'the stock is drawn once per generation')
})

test('stock 1: one unit, then depleted — never a second authorization', async () => {
  const h = harness({ stock: { min: 1, max: 1 } })
  const started = await h.work()
  await h.run(3 * UNIT)
  assert.deepEqual(h.log.settled, [sid(started.actionId, 0)])
  assert.equal(h.log.authorized.length, 1)
  assert.deepEqual([h.log.done[0].reason, h.log.done[0].total.units], ['depleted', 1])
})

test('no range from SKILLS (a plot, the demo policy): a sequence of one', async () => {
  const h = harness({ stock: null })
  await h.work()
  await h.run(3 * UNIT)
  assert.equal(h.log.settled.length, 1)
  assert.equal(h.log.done[0].reason, 'depleted')
  assert.equal(h.log.draws, 0)
})

for (const latencyMs of [400, 1_500]) {
  test(`pipeline with ${latencyMs} ms commits: attempts never pause, commits stay in order, each yield follows its commit`, async () => {
    const h = harness({ latency: [latencyMs] })
    const started = await h.work()
    await h.run(8 * UNIT)
    const t0 = started.startedAt
    // Attempts: back to back on the tick grid, whatever the latency.
    assert.deepEqual(h.log.calls.map(c => [c.settlement.startedAt - t0, c.settlement.endsAt - t0]), [[0, UNIT], [UNIT, 2 * UNIT], [2 * UNIT, 3 * UNIT]])
    // Commits: strictly ordered — unit i+1 is sent only after unit i resolved.
    for (let i = 1; i < h.log.calls.length; i++) assert.ok(h.log.calls[i].at >= h.log.calls[i - 1].resolvedAt, `commit ${i} after commit ${i - 1}`)
    // Yields: after their own commit, in order.
    assert.deepEqual(h.log.yields.map(y => y.index), [0, 1, 2])
    h.log.yields.forEach((y, i) => assert.equal(y.at, h.log.calls[i].resolvedAt))
    const end = h.log.done[0].at - t0
    // Units: 3 × 1.2 s of attempts. The end waits only for the commits still queued.
    const expected = latencyMs <= UNIT ? 3 * UNIT + latencyMs : UNIT + 3 * latencyMs
    assert.equal(end, expected, `sequence end at ${end} ms`)
    assert.equal(h.log.settled.length, 3)
  })
}

test('no yield before its commit is confirmed, however long the database takes', async () => {
  const h = harness({ latency: [60_000] })
  const started = await h.work()
  await h.run(10 * UNIT)
  assert.deepEqual(h.log.yields, [])
  assert.equal(h.log.calls.length, 1, 'unit 1 waits behind unit 0 in the chain')
  assert.equal(h.authority.actions.get(started.actionId).index, 2, 'the attempts went on: unit 2 is running')
  await h.run(3 * 60_000)
  assert.deepEqual(h.log.yields.map(y => y.index), [0, 1, 2])
})

test('stale_node on unit 1 (M-1): settled once under its own id, never re-settled, closed once; nothing after it is prepared, paid or yielded', async () => {
  const h = harness({ commit: settlement => (settlement.actionId.endsWith('-01') ? { ok: false, retryable: false, reason: 'stale-node' } : null) })
  const started = await h.work()
  await h.run(6 * UNIT)
  const id = started.actionId
  // Every real settleWork call, in order: exactly one per unit that reached the database.
  assert.deepEqual(h.log.calls.map(c => c.id), [sid(id, 0), sid(id, 1)], 'the stale unit is sent once, with its own id; unit 2 never')
  assert.deepEqual(h.log.settled, [sid(id, 0)])
  assert.deepEqual(h.log.cancelled, [sid(id, 1), sid(id, 2)], 'the stale unit and the prepared unit 2 are each closed once')
  assert.equal(h.log.authorized.some(a => a.id === sid(id, 3)), false, 'no unit after the one running is prepared')
  assert.deepEqual(h.log.yields.map(y => y.index), [0])
  assert.deepEqual([h.log.done.length, h.log.done[0].ok, h.log.done[0].reason, h.log.done[0].total.units], [1, true, 'error', 1])
  assert.equal(h.authority.metrics.staleNodes, 1)
  assert.equal(h.authority.actions.size, 0, 'the node is released')
  // Nothing more happens afterwards, however long the room runs.
  await h.run(60_000)
  assert.equal(h.log.calls.length, 2)
  assert.equal(h.log.done.length, 1)
})

test('a commit that keeps failing is retried with the same id, then aborts everything after it', async () => {
  const h = harness({ commit: () => ({ ok: false, retryable: true, reason: 'store-down' }) })
  const started = await h.work()
  await h.run(4 * UNIT)
  const id = started.actionId
  assert.deepEqual(h.log.calls.map(c => c.id), [sid(id, 0), sid(id, 0), sid(id, 0), sid(id, 0)])
  assert.deepEqual(h.log.settled, [])
  assert.deepEqual(h.log.cancelled, [sid(id, 1)])
  assert.deepEqual([h.log.done[0].ok, h.log.done[0].reason], [false, 'error'])
  assert.equal(h.authority.store.get(TREE.id), null, 'nothing settled on a fresh node: it is full again')
})

// ── Stopping ─────────────────────────────────────────────────────────────────

test('cancel before the first success persists nothing', async () => {
  const h = harness()
  const started = await h.work()
  await h.run(WORK_TICK_MS)
  assert.equal(h.authority.cancel('a', started.actionId), true)
  await h.run(3 * UNIT)
  assert.deepEqual([h.log.calls.length, h.log.settled.length], [0, 0])
  assert.deepEqual(h.log.cancelled, [sid(started.actionId, 0)])
  assert.deepEqual({ ok: h.log.done[0].ok, reason: h.log.done[0].reason, units: h.log.done[0].total.units }, { ok: false, reason: 'cancelled', units: 0 })
  assert.equal(h.authority.store.get(TREE.id), null)
})

test('cancel during unit 1: unit 0 paid once, unit 1 never; the partial keeps its stock and its refill clock', async () => {
  const h = harness()
  const started = await h.work()
  await h.run(UNIT + WORK_TICK_MS)
  const id = started.actionId
  assert.equal(h.authority.cancel('a', id), true)
  assert.equal(h.authority.cancel('a', id), false, 'a second cancel finds nothing')
  await h.run(3 * UNIT)
  assert.deepEqual(h.log.settled, [sid(id, 0)])
  assert.deepEqual(h.log.cancelled, [sid(id, 1)])
  assert.deepEqual([h.log.done.length, h.log.done[0].ok, h.log.done[0].reason], [1, true, 'cancelled'])
  const partial = h.authority.store.get(TREE.id)
  assert.deepEqual([partial.state, partial.stock, partial.token, partial.respawnAt], ['available', 2, sid(id, 0), started.startedAt + UNIT + REFILL_MS])
  assert.deepEqual(publicNode(partial), { id: TREE.id, state: 'available', version: partial.version, base: true }, 'private: it looks full')
})

test('walking away: before the success nothing is paid; a unit already settling pays once; moves never duplicate the cancellation', async () => {
  const h = harness({ latency: [400] })
  const started = await h.work()
  const id = started.actionId
  // Exactly at unit 0's end: it enters settling, unit 1 starts. Then the trainer walks, three times.
  await h.run(UNIT)
  const actor = h.actors.get('a')
  for (let i = 0; i < 3; i++) { actor.tx += 1; h.authority.reconcileActor(actor) }
  await h.run(3 * UNIT)
  assert.deepEqual(h.log.settled, [sid(id, 0)])
  assert.deepEqual(h.log.cancelled, [sid(id, 1)])
  assert.equal(h.authority.metrics.cancelled, 1)
  assert.deepEqual([h.log.done.length, h.log.done[0].reason, h.log.done[0].total.units], [1, 'moved', 1])
  assert.deepEqual(h.log.yields.map(y => y.index), [0], 'the paid unit still reaches its owner')
})

test('disconnect: the unit in progress finishes and settles, no further unit starts, the worker retires', async () => {
  const h = harness()
  const started = await h.work()
  await h.run(UNIT + WORK_TICK_MS)
  h.authority.ownerLeft('a')
  await h.run(4 * UNIT)
  const id = started.actionId
  assert.deepEqual(h.log.settled, [sid(id, 0), sid(id, 1)])
  assert.equal(h.log.authorized.length, 2, 'unit 2 was never even asked for')
  assert.deepEqual([h.log.done[0].reason, h.log.done[0].total.units], ['disconnected', 2])
  assert.equal(h.authority.store.get(TREE.id).stock, 1)
  assert.equal(h.authority.actions.size, 0)
})

test('reconnecting at the waiting tile before the unit ends continues the sequence', async () => {
  const h = harness()
  const started = await h.work()
  await h.run(WORK_TICK_MS)
  h.authority.ownerLeft('a')
  h.authority.reconcileActor(h.actors.get('a'))
  await h.run(4 * UNIT)
  assert.equal(h.log.settled.length, 3)
  assert.deepEqual([h.log.done[0].reason, h.log.done[0].total.units], ['depleted', 3])
  assert.equal(h.log.done[0].actionId, started.actionId)
})

test('reconnecting after the unit ended is too late: the sequence already stopped', async () => {
  const h = harness({ latency: [400] })
  await h.work()
  await h.run(WORK_TICK_MS)
  h.authority.ownerLeft('a')
  await h.run(UNIT)
  h.authority.reconcileActor(h.actors.get('a'))
  await h.run(4 * UNIT)
  assert.equal(h.log.settled.length, 1)
  assert.equal(h.log.authorized.length, 1, 'a disconnected player never starts another unit')
  assert.equal(h.log.done[0].reason, 'disconnected')
})

// ── Partial nodes ────────────────────────────────────────────────────────────

test('the next sequence on a partial continues its generation: token and stock from the partial, no new draw', async () => {
  const h = harness()
  const first = await h.work()
  await h.run(UNIT + WORK_TICK_MS)
  h.authority.cancel('a', first.actionId)
  await h.run(STEP)
  const second = await h.work('b')
  assert.equal(second.ok, true)
  await h.run(4 * UNIT)
  const b = h.log.calls.filter(c => c.id.startsWith(second.actionId)).map(c => c.settlement.world)
  assert.deepEqual(b.map(w => [w.expectedToken, w.stock.before, w.stock.after]), [[sid(first.actionId, 0), 2, 1], [sid(second.actionId, 0), 1, 0]])
  assert.equal(b[0].reservedAt, second.startedAt)
  assert.equal(h.log.draws, 1, 'one generation, one draw: 3 units between two players')
  assert.equal(h.log.settled.length, 3)
  assert.equal(h.authority.store.get(TREE.id).state, 'depleted')
})

test('a partial refills silently 90 s after its last settled unit; a cancellation does not extend it', async () => {
  const h = harness()
  const first = await h.work()
  await h.run(UNIT + WORK_TICK_MS)
  h.authority.cancel('a', first.actionId)
  await h.run(STEP)
  const refillAt = h.authority.store.get(TREE.id).respawnAt
  assert.equal(refillAt, first.startedAt + UNIT + REFILL_MS)
  // Someone reserves and cancels before the success: the refill instant does not move.
  const other = await h.work('b')
  await h.run(WORK_TICK_MS)
  h.authority.cancel('b', other.actionId)
  await h.run(STEP)
  assert.equal(h.authority.store.get(TREE.id).respawnAt, refillAt)
  const published = h.log.nodes.length
  h.clock.set(refillAt - STEP)
  await h.run(STEP)
  assert.equal(h.authority.store.get(TREE.id), null, 'full again')
  assert.equal(h.log.nodes.length, published, 'nothing to publish: to everyone it was already full')
  assert.equal(h.authority.metrics.refilled, 1)
  // A new generation: fresh draw, no token.
  h.actors.get('a').tx = SPOT_A.tx; h.actors.get('a').ty = SPOT_A.ty
  const next = await h.work('a', 25, 2)
  await h.run(UNIT)
  assert.equal(h.log.calls.find(c => c.id === sid(next.actionId, 0)).settlement.world.expectedToken, null)
  assert.equal(h.log.draws, 2)
})

test('rule B: a reservation just before expiry keeps the generation (checked at reservedAt); at the instant it is a new one', async () => {
  const h = harness()
  const first = await h.work()
  await h.run(UNIT + WORK_TICK_MS)
  h.authority.cancel('a', first.actionId)
  await h.run(STEP)
  const refillAt = h.authority.store.get(TREE.id).respawnAt
  h.clock.set(refillAt - 1)
  const before = await h.work('b')
  await h.run(UNIT)
  const world = h.log.calls.find(c => c.id === sid(before.actionId, 0)).settlement.world
  assert.deepEqual([world.expectedToken, world.reservedAt], [sid(first.actionId, 0), refillAt - 1], 'the unit ends after expiry; the CAS uses the reservation instant')

  // At the instant itself (the refill timer not run yet): a new generation.
  const h2 = harness()
  const f2 = await h2.work()
  await h2.run(UNIT + WORK_TICK_MS)
  h2.authority.cancel('a', f2.actionId)
  await h2.run(STEP)
  h2.clock.set(h2.authority.store.get(TREE.id).respawnAt)
  const at = await h2.authority.requestWork(h2.actors.get('b'), { nodeId: TREE.id, pokemonInstanceId: 6, requestId: 1 })
  await h2.run(UNIT)
  assert.equal(h2.log.calls.find(c => c.id === sid(at.actionId, 0)).settlement.world.expectedToken, null)
})

test('restart: persisted partials come back private with their token; expired ones are full', async () => {
  const h = harness()
  const token = '00000000-0000-4000-8000-00000000abcd-01'
  const now = h.clock.now()
  h.authority.restore([{ nodeId: TREE.id, state: 'available', stockRemaining: 2, actionId: token, respawnAt: now + 30_000, plot: null }], now)
  const restored = h.authority.store.get(TREE.id)
  assert.deepEqual([restored.stock, restored.token], [2, token])
  assert.deepEqual(publicNode(restored), { id: TREE.id, state: 'available', version: restored.version, base: true })
  assert.deepEqual(h.authority.store.inChunk(TREE.areaId, TREE.chunkId), [], 'never in a snapshot')
  const next = await h.work()
  await h.run(UNIT)
  assert.deepEqual(h.log.calls[0].settlement.world.expectedToken, token)
  assert.notEqual(next.actionId, '00000000-0000-4000-8000-00000000abcd', 'a new sequence id')

  const h2 = harness()
  h2.authority.restore([{ nodeId: TREE.id, state: 'available', stockRemaining: 2, actionId: token, respawnAt: h2.clock.now(), plot: null }], h2.clock.now())
  assert.equal(h2.authority.store.get(TREE.id), null, 'expired at restore: full')
})

// ── Leaks and concurrency ────────────────────────────────────────────────────

test('no leak: yields carry no stock or timing, observers see a flash, the working node carries no stock', async () => {
  const h = harness()
  await h.work()
  await h.run(4 * UNIT)
  for (const unit of h.log.yields) {
    const { playerId: _p, at: _a, ...message } = unit
    assert.deepEqual(Object.keys(message).sort(), ['actionId', 'index', 'summary'])
  }
  const projected = h.log.nodes.map(publicNode)
  const keys = keysDeep(projected)
  for (const key of ['stock', 'token', 'stockRemaining', 'settlementId', 'endsAt', 'durationMs', 'attempts', 'refillAt']) assert.equal(keys.has(key), false, key)
  const flashes = projected.filter(node => node.yieldAt !== undefined).map(node => node.yieldAt)
  assert.equal(flashes.length, 3, 'one flash per confirmed unit, the last one included (then the node depletes)')
  for (const text of projected.map(node => JSON.stringify(node))) assert.equal(/-0[0-9a-f]"/.test(text), false, 'no settlement id')
})

test('one worker per node: another player is refused between units too', async () => {
  const h = harness()
  await h.work()
  await h.run(UNIT)
  const refused = await h.work('b')
  assert.deepEqual([refused.ok, refused.reason], [false, 'busy'])
})

// ── Recovery: ambiguous and stale commits resync from the database (YIELD-2 recovery) ──

const DOWN = { ok: false, retryable: true, reason: 'store-unavailable' }
const STALE = { ok: false, retryable: false, reason: 'stale-node' }
const TRIES = SETTLE_RETRY_DELAYS_MS.length + 1
const callsFor = (h, id) => h.log.calls.filter(c => c.id === id)
/** A database row as world_load_nodes gives it (normalized by playerData.nodeOverride). */
const dbRow = fields => ({ nodeId: TREE.id, areaId: TREE.areaId, chunkId: TREE.chunkId, plot: null, stockRemaining: null, ...fields })
const baseOf = settlementId => settlementId.slice(0, -3)

test('ambiguous unit 1: every retry and the resync reuse its id; dedupe confirms it; one yield; the node is what the database says', async () => {
  // Unit 1 was written by the database, but every reply of the ordered retries is lost.
  let lost = TRIES
  const h = harness({
    commit: settlement => {
      if (!settlement.actionId.endsWith('-01')) return null
      if (lost-- > 0) return DOWN
      return { ok: true, status: 'duplicate', summary: { ...SUMMARY, rewards: [{ itemId: 'log', quantity: 2 }], duplicate: true } }
    },
    loadNodes: (log, clock) => [dbRow({ state: 'available', stockRemaining: 1, actionId: sid(baseOf(log.calls[0].id), 1), respawnAt: clock.now() + 60_000 })],
  })
  const started = await h.work()
  const id = started.actionId
  await h.run(6 * UNIT)
  const unit1 = callsFor(h, sid(id, 1))
  assert.equal(unit1.length, TRIES + 1, 'the ordered retries, then one resync step: always the same settlement id')
  assert.ok(unit1.every(c => c.settlement === unit1[0].settlement), 'the very same settlement, never a new one')
  assert.deepEqual(callsFor(h, sid(id, 2)), [], 'unit 2 never reaches the database')
  assert.deepEqual(h.log.yields.map(y => y.index), [0, 1], 'exactly one yield per confirmed unit')
  assert.ok(h.log.yields[1].at >= unit1.at(-1).resolvedAt, 'unit 1 yields only once dedupe confirmed it')
  assert.deepEqual(h.log.done.map(d => [d.reason, d.total]), [['error', { units: 2, xpGained: 20, rewards: [{ itemId: 'log', quantity: 3 }] }]], 'the total counts the stored original')
  assert.deepEqual(h.log.cancelled, [sid(id, 2)], 'the doubtful unit is never closed; the aborted one is, once')
  assert.equal(h.log.loads, 1)
  const node = h.authority.store.get(TREE.id)
  assert.deepEqual([node.state, node.stock, node.token, node.syncing], ['available', 1, sid(id, 1), false])
  assert.equal(h.authority.syncing.size, 0)
  const m = h.authority.metrics
  assert.deepEqual([m.ambiguousCommits, m.resyncs, m.resynced, m.recoveredUnits, m.duplicateSettlements], [1, 1, 1, 1, 1])
})

test('ambiguous, then the database says stale: never paid, closed once, the node follows the database', async () => {
  let lost = TRIES
  const h = harness({
    commit: settlement => (settlement.actionId.endsWith('-01') ? (lost-- > 0 ? DOWN : STALE) : null),
    loadNodes: (log, clock) => [dbRow({ state: 'depleted', actionId: 'ffffffff-0000-4000-8000-000000000009-00', respawnAt: clock.now() + 120_000 })],
  })
  const started = await h.work()
  const id = started.actionId
  await h.run(6 * UNIT)
  assert.equal(callsFor(h, sid(id, 1)).length, TRIES + 1)
  assert.deepEqual(h.log.yields.map(y => y.index), [0])
  assert.deepEqual([...h.log.cancelled].sort(), [sid(id, 1), sid(id, 2)].sort())
  assert.deepEqual([h.log.done[0].total.units, h.log.done[0].reason], [1, 'error'])
  assert.equal(h.authority.store.get(TREE.id).state, 'depleted', 'another writer depleted it: memory follows')
  const refused = await h.work('b')
  assert.deepEqual([refused.ok, refused.reason], [false, 'depleted'])
})

test('stale_node resyncs at once from the database: full, partial, depleted or expired — whatever it holds', async () => {
  const cases = [
    ['full (no row)', () => [], node => assert.equal(node, null)],
    ['expired (dropped by the database clock)', () => [], node => assert.equal(node, null)],
    ['partial', (log, clock) => [dbRow({ state: 'available', stockRemaining: 2, actionId: 'eeeeeeee-0000-4000-8000-000000000001-00', respawnAt: clock.now() + 50_000 })],
      node => assert.deepEqual([node.state, node.stock, node.token], ['available', 2, 'eeeeeeee-0000-4000-8000-000000000001-00'])],
    ['depleted', (log, clock) => [dbRow({ state: 'depleted', actionId: 'eeeeeeee-0000-4000-8000-000000000001-01', respawnAt: clock.now() + 50_000 })],
      node => assert.deepEqual([node.state, node.stock], ['depleted', null])],
  ]
  for (const [name, rows, check] of cases) {
    const h = harness({ commit: settlement => (settlement.actionId.endsWith('-01') ? STALE : null), loadNodes: rows })
    const started = await h.work()
    await h.run(3 * UNIT)
    assert.equal(h.log.loads, 1, name)
    assert.equal(callsFor(h, sid(started.actionId, 1)).length, 1, `${name}: stale is final, no resettle`)
    check(h.authority.store.get(TREE.id))
    assert.equal(h.authority.actions.size, 0, name)
  }
})

test('the read is filtered by node id: other nodes’ rows are never applied', async () => {
  const other = praderaNodesNearSpawn()[1]?.node
  assert.ok(other && other.id !== TREE.id)
  const h = harness({
    commit: settlement => (settlement.actionId.endsWith('-01') ? STALE : null),
    loadNodes: (log, clock) => [
      { ...dbRow({ state: 'depleted', actionId: 'aaaaaaaa-0000-4000-8000-000000000001-00', respawnAt: clock.now() + 9_000 }), nodeId: other.id },
      dbRow({ state: 'available', stockRemaining: 1, actionId: 'dddddddd-0000-4000-8000-000000000001-00', respawnAt: clock.now() + 9_000 }),
    ],
  })
  await h.work()
  await h.run(3 * UNIT)
  assert.equal(h.authority.store.get(other.id), null)
  assert.equal(h.authority.store.get(TREE.id).stock, 1)
})

test('while resyncing the node takes no work, and nothing private reaches any client', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const h = harness({
    commit: settlement => (settlement.actionId.endsWith('-01') ? STALE : null),
    loadNodes: async (log, clock) => { await gate; return [dbRow({ state: 'available', stockRemaining: 1, actionId: 'cccccccc-0000-4000-8000-000000000001-00', respawnAt: clock.now() + 9_000 })] },
  })
  const started = await h.work()
  await h.run(3 * UNIT)
  assert.equal(h.authority.syncing.has(TREE.id), true)
  assert.equal(h.authority.actionOf('a').phase, 'resyncing')
  assert.equal(h.authority.cancel('a', started.actionId), false, 'nothing is attempting any more')
  const refused = await h.work('b')
  assert.deepEqual([refused.ok, refused.reason], [false, 'busy'], 'no one loses time on a node whose stock is unknown')
  release()
  await h.run(STEP)
  assert.equal(h.authority.syncing.size, 0)
  const keys = keysDeep(h.log.nodes.map(publicNode))
  for (const key of ['stock', 'token', 'stockRemaining', 'syncing', 'settlementId']) assert.equal(keys.has(key), false, key)
  for (const unit of h.log.yields) {
    const { playerId: _p, at: _a, ...message } = unit
    assert.deepEqual(Object.keys(message).sort(), ['actionId', 'index', 'summary'])
  }
  const ok = await h.work('b', 6, 2)
  assert.equal(ok.ok, true, 'free again once the database answered')
})

test('database down: the worker waits a few steps, then player and Pokémon are freed; the node stays held until the database answers', async () => {
  let up = false
  const h = harness({
    commit: settlement => (!settlement.actionId.endsWith('-01') ? null : up ? { ok: true, status: 'duplicate', summary: SUMMARY } : DOWN),
    loadNodes: (log, clock) => {
      if (!up) throw new Error('down')
      return [dbRow({ state: 'available', stockRemaining: 1, actionId: sid(baseOf(log.calls[0].id), 1), respawnAt: clock.now() + 60_000 })]
    },
  })
  const started = await h.work()
  const id = started.actionId
  await h.run(3 * UNIT)
  assert.equal(h.log.done.length, 0, 'held: the owner waits for the first steps')
  const holdMs = RESYNC_DELAYS_MS.slice(0, RESYNC_HOLD_STEPS - 1).reduce((a, b) => a + b, 0)
  await h.run(holdMs + STEP)
  assert.deepEqual(h.log.done.map(d => [d.reason, d.total.units]), [['error', 1]], 'freed, with the confirmed units only')
  assert.equal(h.authority.actions.size, 0)
  assert.equal(h.authority.byPokemon.size, 0)
  assert.deepEqual([h.authority.store.get(TREE.id).syncing, h.authority.store.get(TREE.id).base], [true, false])
  assert.equal((await h.work('b')).reason, 'busy', 'the node itself is still held')
  const steps = h.authority.metrics.resyncSteps
  await h.run(5 * 60_000)
  assert.ok(h.authority.metrics.resyncSteps > steps && h.authority.metrics.resyncSteps < steps + 12, 'bounded backoff, never a tight loop')
  assert.deepEqual([...new Set(h.log.calls.map(c => c.id))], [sid(id, 0), sid(id, 1)], 'only units 0 and 1 ever reach the database')
  const unit1 = callsFor(h, sid(id, 1))
  assert.ok(unit1.every(c => c.settlement === unit1[0].settlement))
  assert.deepEqual(h.log.cancelled, [sid(id, 2)], 'the doubtful unit stays open while the database may still confirm it')
  up = true
  await h.run(RESYNC_DELAYS_MS.at(-1) + STEP)
  assert.equal(h.authority.syncing.size, 0)
  assert.deepEqual([h.authority.store.get(TREE.id).stock, h.authority.store.get(TREE.id).syncing], [1, false])
  assert.equal(h.authority.metrics.lateConfirmations, 1, 'paid in the database, reported late')
  assert.deepEqual(h.log.yields.map(y => y.index), [0], 'never a yield after the sequence was reported done')
  assert.equal(h.log.done.length, 1)
  assert.equal((await h.work('b', 6, 3)).ok, true)
})

test('authorizations (M-5): success, duplicate, ambiguous, stale and cancellation — each closed exactly when it can no longer be paid', async () => {
  const run = async (commit, after = async () => {}) => {
    const h = harness({ stock: { min: 1, max: 1 }, commit, loadNodes: () => [] })
    const started = await h.work()
    await after(h, started)
    await h.run(3 * UNIT)
    assert.equal(h.log.done.length, 1)
    return { h, id: sid(started.actionId, 0) }
  }
  let r = await run(null)
  assert.deepEqual(r.h.log.cancelled, [], 'applied: settled, nothing to close')
  r = await run(() => ({ ok: true, status: 'duplicate', summary: SUMMARY }))
  assert.deepEqual(r.h.log.cancelled, [], 'duplicate: settled, nothing to close')
  let n = 0
  r = await run(() => (n++ < TRIES ? DOWN : { ok: true, status: 'duplicate', summary: SUMMARY }))
  assert.deepEqual(r.h.log.cancelled, [], 'ambiguous then confirmed: never closed')
  n = 0
  r = await run(() => (n++ < TRIES ? DOWN : STALE))
  assert.deepEqual(r.h.log.cancelled, [r.id], 'ambiguous then stale: closed once, after the answer')
  r = await run(() => STALE)
  assert.deepEqual(r.h.log.cancelled, [r.id], 'stale: closed once')
  r = await run(() => ({ ok: false, retryable: false, reason: 'expired' }))
  assert.deepEqual(r.h.log.cancelled, [r.id], 'refused for good: closed once')
  r = await run(null, async (h, started) => { h.authority.cancel('a', started.actionId); h.authority.cancel('a', started.actionId) })
  assert.deepEqual([r.h.log.cancelled, r.h.log.calls.length], [[r.id], 0], 'cancelled: closed once, never settled')
})

test('without a database (no loadNodes) a stale unit ends from memory, as before', async () => {
  const h = harness({ commit: settlement => (settlement.actionId.endsWith('-01') ? STALE : null) })
  const started = await h.work()
  await h.run(3 * UNIT)
  assert.equal(h.authority.syncing.size, 0)
  assert.deepEqual([h.authority.store.get(TREE.id).stock, h.authority.store.get(TREE.id).token], [2, sid(started.actionId, 0)])
})
