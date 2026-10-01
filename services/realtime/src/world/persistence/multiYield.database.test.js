import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { openLocalDatabase, serviceQuery } from './dev/localDatabase.js'
import { createSqlPlayerData } from './playerData.js'

// RESOURCE YIELD-2: world_commit_work's stock contract on the real SQL
// (embedded Postgres): per-node lock, dedupe first, CAS on the generation
// token / stock / reservation instant, stale_node without an exception.

const A = '11111111-1111-4111-8111-111111111111'
const NODE = 'pradera:-6:-64:tree'
const BASE = '00000000-0000-4000-8000-0000000000'
const sid = (seq, index) => `${BASE}${seq.padStart(2, '0').slice(-2)}-${index.toString(16).padStart(2, '0')}`
// A day ahead of the real clock: only world_load_nodes compares with now(), and these rows must not expire mid-test.
const T0 = Math.floor(Date.now() / 1000) * 1000 + 86_400_000
const RESPAWN = 90_000

async function setup() {
  const db = await openLocalDatabase()
  await db.exec(`INSERT INTO auth.users VALUES ('${A}');`)
  return { db, data: createSqlPlayerData(serviceQuery(db)) }
}

/** One gathered unit's commit: stock before → before − 1, ending at `endsAt`. */
const unit = (settlementId, { before, token = null, reservedAt, endsAt, nodeId = NODE }) => {
  const after = before - 1
  return {
    actionId: settlementId, userId: A, skillId: 'woodcutting', outcome: 'completed', xpGained: 10,
    rewards: [{ itemId: 'common_log', quantity: 1, bonus: false }], levelBefore: 1, levelAfter: 1, rulesVersion: 'skills-1.3',
    node: {
      nodeId, areaId: 'pradera', chunkId: '-1,-4', plot: null, base: false,
      state: after === 0 ? 'depleted' : 'available', respawnAt: endsAt + RESPAWN,
      stock: { before, after }, expectedToken: token, reservedAt,
    },
  }
}

const row = async (db, nodeId = NODE) => (await db.query('SELECT state, stock_remaining, action_id, respawn_at, updated_at FROM public.world_node_overrides WHERE node_id = $1', [nodeId])).rows[0] ?? null
const xp = async db => Number((await db.query(`SELECT coalesce(sum(xp), 0) AS xp FROM public.player_skill_xp WHERE user_id = '${A}'`)).rows[0].xp)
const logs = async db => Number((await db.query(`SELECT coalesce(sum(quantity), 0) AS q FROM public.player_materials WHERE user_id = '${A}'`)).rows[0].q)
const settlements = async db => Number((await db.query('SELECT count(*) AS n FROM public.skill_work_settlements')).rows[0].n)
const ms = value => new Date(value).getTime()

test('a new generation, then its partial units, then depletion: one row, token = last settlement id, stock 2 → 1 → depleted', async () => {
  const { db, data } = await setup()
  const reservedAt = T0
  assert.equal((await data.commitWork(unit(sid('a1', 0), { before: 3, reservedAt, endsAt: T0 + 1_800 }))).applied, true)
  let r = await row(db)
  assert.deepEqual({ state: r.state, stock: r.stock_remaining, token: r.action_id, respawn: ms(r.respawn_at) }, { state: 'available', stock: 2, token: sid('a1', 0), respawn: T0 + 1_800 + RESPAWN })
  assert.equal((await data.commitWork(unit(sid('a1', 1), { before: 2, token: sid('a1', 0), reservedAt, endsAt: T0 + 3_000 }))).applied, true)
  r = await row(db)
  assert.deepEqual({ state: r.state, stock: r.stock_remaining, token: r.action_id }, { state: 'available', stock: 1, token: sid('a1', 1) })
  assert.equal((await data.commitWork(unit(sid('a1', 2), { before: 1, token: sid('a1', 1), reservedAt, endsAt: T0 + 4_200 }))).applied, true)
  r = await row(db)
  assert.deepEqual({ state: r.state, stock: r.stock_remaining, token: r.action_id, respawn: ms(r.respawn_at) }, { state: 'depleted', stock: null, token: sid('a1', 2), respawn: T0 + 4_200 + RESPAWN })
  assert.equal(await xp(db), 30)
  assert.equal(await logs(db), 3)
  const stored = (await db.query(`SELECT rules_version FROM public.skill_work_settlements WHERE action_id = $1`, [sid('a1', 2)])).rows[0]
  assert.equal(stored.rules_version, 'skills-1.3')
  await db.close()
})

test('stock 1: the first unit depletes the node', async () => {
  const { db, data } = await setup()
  assert.equal((await data.commitWork(unit(sid('b1', 0), { before: 1, reservedAt: T0, endsAt: T0 + 600 }))).applied, true)
  assert.deepEqual({ state: (await row(db)).state, stock: (await row(db)).stock_remaining }, { state: 'depleted', stock: null })
  await db.close()
})

test('dedupe first: the same unit committed 1, 2 or 20 times pays once and never touches the node again', async () => {
  for (const times of [1, 2, 20]) {
    const { db, data } = await setup()
    const first = unit(sid('c1', 0), { before: 3, reservedAt: T0, endsAt: T0 + 600 })
    assert.equal((await data.commitWork(first)).applied, true)
    const after = await row(db)
    for (let i = 1; i < times; i++) {
      // Even a retry carrying a different node payload changes nothing.
      const retry = await data.commitWork({ ...first, node: { ...first.node, respawnAt: T0 + 999_999 } })
      assert.equal(retry.applied, false)
      assert.equal(retry.rejected, undefined)
      assert.equal(retry.settlement.action_id, sid('c1', 0))
    }
    assert.deepEqual(await row(db), after, `${times}×: node, stock and timestamps untouched`)
    assert.equal(await xp(db), 10)
    assert.equal(await logs(db), 1)
    assert.equal(await settlements(db), 1)
    await db.close()
  }
})

test('a concurrent retry of the same unit pays once', async () => {
  const { db, data } = await setup()
  const commit = unit(sid('d1', 0), { before: 2, reservedAt: T0, endsAt: T0 + 600 })
  const results = await Promise.all(Array.from({ length: 20 }, () => data.commitWork(commit)))
  assert.equal(results.filter(result => result.applied).length, 1)
  assert.equal(await xp(db), 10)
  assert.equal(await settlements(db), 1)
  await db.close()
})

test('stale_node is an answer, not an exception: wrong token, wrong stock — nothing written, nothing paid', async () => {
  const { db, data } = await setup()
  await data.commitWork(unit(sid('e1', 0), { before: 3, reservedAt: T0, endsAt: T0 + 600 }))
  const before = await row(db)
  const wrongToken = await data.commitWork(unit(sid('e2', 0), { before: 2, token: sid('ff', 0), reservedAt: T0 + 700, endsAt: T0 + 1_300 }))
  assert.deepEqual(wrongToken, { applied: false, settlement: null, rejected: 'stale_node' })
  const wrongStock = await data.commitWork(unit(sid('e3', 0), { before: 3, token: sid('e1', 0), reservedAt: T0 + 700, endsAt: T0 + 1_300 }))
  assert.equal(wrongStock.rejected, 'stale_node')
  // A late "new generation" against a partial that is still valid at its reservation.
  const vigente = await data.commitWork(unit(sid('e4', 0), { before: 2, reservedAt: T0 + 700, endsAt: T0 + 1_300 }))
  assert.equal(vigente.rejected, 'stale_node')
  assert.deepEqual(await row(db), before)
  assert.equal(await settlements(db), 1)
  assert.equal(await xp(db), 10)
  await db.close()
})

test('a depleted node still inside its respawn rejects a new generation reserved before respawn_at', async () => {
  const { db, data } = await setup()
  await data.commitWork(unit(sid('f1', 0), { before: 1, reservedAt: T0, endsAt: T0 + 600 }))
  const early = await data.commitWork(unit(sid('f2', 0), { before: 2, reservedAt: T0 + 600 + RESPAWN - 1, endsAt: T0 + 100_000 }))
  assert.equal(early.rejected, 'stale_node')
  // Reserved at or after its respawn instant: the expired row counts as absent.
  const later = await data.commitWork(unit(sid('f3', 0), { before: 2, reservedAt: T0 + 600 + RESPAWN, endsAt: T0 + 100_000 }))
  assert.equal(later.applied, true)
  assert.deepEqual({ state: (await row(db)).state, stock: (await row(db)).stock_remaining }, { state: 'available', stock: 1 })
  await db.close()
})

test('ABA: T1 (stock 2) expires and returns to base, T2 lands on stock 2 again — a late commit expecting T1 is stale', async () => {
  const { db, data } = await setup()
  await data.commitWork(unit(sid('a1f', 0), { before: 3, reservedAt: T0, endsAt: T0 + 600 }))
  const t1 = (await row(db)).action_id
  // T1 expires; the loader drops expired non-plot rows: back to base.
  await db.exec(`UPDATE public.world_node_overrides SET respawn_at = now() - interval '1 second' WHERE node_id = '${NODE}'`)
  await data.loadNodes()
  assert.equal(await row(db), null)
  // T2: a new generation that happens to leave stock 2 again.
  await data.commitWork(unit(sid('a2f', 0), { before: 3, reservedAt: T0 + 200_000, endsAt: T0 + 200_600 }))
  assert.equal((await row(db)).stock_remaining, 2)
  const late = await data.commitWork(unit(sid('a1f', 1), { before: 2, token: t1, reservedAt: T0, endsAt: T0 + 1_200 }))
  assert.equal(late.rejected, 'stale_node')
  assert.equal((await row(db)).action_id, sid('a2f', 0))
  assert.equal(await settlements(db), 2)
  await db.close()
})

test('expiry during a unit: reserved before respawn_at, committed after it — settles and renews the clock', async () => {
  const { db, data } = await setup()
  await data.commitWork(unit(sid('b1f', 0), { before: 3, reservedAt: T0, endsAt: T0 + 600 }))
  const refillAt = T0 + 600 + RESPAWN
  // Reserved 1 ms before the refill instant; the unit ends (and commits) well after it.
  const commit = await data.commitWork(unit(sid('b2f', 0), { before: 2, token: sid('b1f', 0), reservedAt: refillAt - 1, endsAt: refillAt + 5_000 }))
  assert.equal(commit.applied, true)
  const r = await row(db)
  assert.deepEqual({ stock: r.stock_remaining, token: r.action_id, respawn: ms(r.respawn_at) }, { stock: 1, token: sid('b2f', 0), respawn: refillAt + 5_000 + RESPAWN })
  // Reserved after the (old) refill instant, a partial reservation is stale: WORLD must start a new generation.
  const { db: db2, data: data2 } = await setup()
  await data2.commitWork(unit(sid('b3f', 0), { before: 3, reservedAt: T0, endsAt: T0 + 600 }))
  const afterExpiry = await data2.commitWork(unit(sid('b4f', 0), { before: 2, token: sid('b3f', 0), reservedAt: refillAt, endsAt: refillAt + 600 }))
  assert.equal(afterExpiry.rejected, 'stale_node')
  const fresh = await data2.commitWork(unit(sid('b5f', 0), { before: 4, reservedAt: refillAt, endsAt: refillAt + 600 }))
  assert.equal(fresh.applied, true)
  assert.equal((await row(db2)).stock_remaining, 3)
  await db.close(); await db2.close()
})

test('two instances racing a new generation on the same node: one applies, the other is stale', async () => {
  const { db } = await setup()
  const one = createSqlPlayerData(serviceQuery(db))
  const two = createSqlPlayerData(serviceQuery(db))
  const [a, b] = await Promise.all([
    one.commitWork(unit(sid('c1f', 0), { before: 3, reservedAt: T0, endsAt: T0 + 600 })),
    two.commitWork(unit(sid('c2f', 0), { before: 4, reservedAt: T0, endsAt: T0 + 600 })),
  ])
  assert.deepEqual([a.applied, b.applied].sort(), [false, true])
  assert.equal([a, b].find(result => !result.applied).rejected, 'stale_node')
  assert.equal(await settlements(db), 1)
  await db.close()
})

test('a plot row never accepts a stocked unit; plots keep the previous contract', async () => {
  const { db, data } = await setup()
  const plotNode = 'pradera:-7:-73:plot'
  const plot = { cropId: 'oran', ownerId: A, plantedAt: T0, growingAt: T0 + 1, readyAt: T0 + 2, tended: false }
  const planted = await data.commitWork({
    actionId: sid('d1f', 0), userId: A, skillId: 'farming', outcome: 'completed', xpGained: 8, rewards: [], levelBefore: 1, levelAfter: 1, rulesVersion: 'skills-1.3',
    node: { nodeId: plotNode, areaId: 'pradera', chunkId: '-1,-5', state: 'planted', respawnAt: T0 + 1, plot, base: false },
  })
  assert.equal(planted.applied, true)
  assert.equal((await row(db, plotNode)).stock_remaining, null)
  const stocked = await data.commitWork(unit(sid('d2f', 0), { before: 2, reservedAt: T0 + 10_000, endsAt: T0 + 10_600, nodeId: plotNode }))
  assert.equal(stocked.rejected, 'stale_node')
  await db.close()
})

test('a malformed stock contract is a caller bug and raises', async () => {
  const { db, data } = await setup()
  const bad = unit(sid('e1f', 0), { before: 2, reservedAt: T0, endsAt: T0 + 600 })
  for (const node of [
    { ...bad.node, stock: { before: 2, after: 2 } },
    { ...bad.node, stock: { before: 5, after: 4 } },
    { ...bad.node, state: 'depleted' },
    { ...bad.node, reservedAt: 'soon' },
  ]) await assert.rejects(data.commitWork({ ...bad, node }), /invalid_stock/)
  assert.equal(await settlements(db), 0)
  await db.close()
})

test('existing rows stay valid, and the previous world_commit_work still works on the new table (logical rollback)', async () => {
  const { db, data } = await setup()
  // A pre-YIELD row: depleted, no stock.
  await db.exec(`INSERT INTO public.world_node_overrides (node_id, area_id, chunk_id, state, respawn_at, action_id) VALUES ('pradera:1:1:rock', 'pradera', '0,0', 'depleted', now() + interval '1 minute', 'aaaaaaaa-1')`)
  await data.commitWork(unit(sid('f1f', 0), { before: 3, reservedAt: T0, endsAt: T0 + 600 }))
  await assert.rejects(db.exec(`UPDATE public.world_node_overrides SET stock_remaining = 4 WHERE node_id = '${NODE}'`), /stock_remaining_check/)
  // Roll the function back to the previous migration's body.
  const previous = await readFile(new URL('../../../../../supabase/migrations/20260926002154_world_skills_authority.sql', import.meta.url), 'utf8')
  const fn = previous.slice(previous.indexOf('CREATE OR REPLACE FUNCTION public.world_commit_work('), previous.indexOf('-- ── world_player_state'))
  await db.exec(fn)
  const legacy = await data.commitWork({
    actionId: 'bbbbbbbb-0000-4000-8000-000000000001', userId: A, skillId: 'mining', outcome: 'completed', xpGained: 10,
    rewards: [{ itemId: 'stone', quantity: 1, bonus: false }], levelBefore: 1, levelAfter: 1, rulesVersion: 'skills-1.2',
    node: { nodeId: 'pradera:2:2:rock', areaId: 'pradera', chunkId: '0,0', state: 'depleted', respawnAt: Date.now() + RESPAWN, plot: null, base: false },
  })
  assert.equal(legacy.applied, true)
  const nodes = await data.loadNodes()
  assert.ok(nodes.some(node => node.nodeId === NODE && node.stockRemaining === 2), 'the partial row is still readable')
  assert.ok(nodes.some(node => node.nodeId === 'pradera:2:2:rock' && node.stockRemaining === null))
  await db.close()
})
