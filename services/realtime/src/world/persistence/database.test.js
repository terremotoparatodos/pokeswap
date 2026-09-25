import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { asRole, openLocalDatabase, serviceQuery } from './dev/localDatabase.js'
import { createSqlPlayerData } from './playerData.js'

// INTEGRATION-1: the real migration, on an embedded Postgres that starts with
// Supabase's worst-case default privileges (dev/supabaseStubs.sql).

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

async function setup(dataDir = null) {
  const db = await openLocalDatabase(dataDir)
  await db.exec(`INSERT INTO auth.users VALUES ('${A}'), ('${B}') ON CONFLICT DO NOTHING;
    INSERT INTO public.slots VALUES (68, '${A}', false), (123, '${A}', true), (25, '${B}', false) ON CONFLICT DO NOTHING;`)
  return { db, data: createSqlPlayerData(serviceQuery(db)) }
}

const node = (extra = {}) => ({ nodeId: 'pradera:-6:-64:tree', areaId: 'pradera', chunkId: '-1,-4', state: 'depleted', respawnAt: Date.now() + 90_000, plot: null, base: false, ...extra })
const commit = (actionId, extra = {}) => ({
  actionId, userId: A, skillId: 'woodcutting', outcome: 'completed', xpGained: 10,
  rewards: [{ itemId: 'common_log', quantity: 1, bonus: false }], levelBefore: 1, levelAfter: 1, rulesVersion: 'skills-1.0',
  node: node(), ...extra,
})

const WRITES = {
  player_skill_xp: [`INSERT INTO public.player_skill_xp (user_id, skill_id, xp) VALUES ('${A}', 'mining', 999999)`, 'UPDATE public.player_skill_xp SET xp = 999999'],
  player_materials: [`INSERT INTO public.player_materials (user_id, material_id, quantity) VALUES ('${A}', 'gold_ore', 999999)`, 'UPDATE public.player_materials SET quantity = 999999'],
  skill_work_settlements: [
    `INSERT INTO public.skill_work_settlements (action_id, user_id, skill_id, outcome, xp_gained, xp_after, level_before, level_after, rules_version) VALUES ('aaaaaaaa-1', '${A}', 'mining', 'completed', 999999, 999999, 1, 50, 'x')`,
    'UPDATE public.skill_work_settlements SET xp_gained = 999999',
  ],
  world_node_overrides: [`INSERT INTO public.world_node_overrides (node_id, area_id, chunk_id, state) VALUES ('pradera:1:1:tree', 'pradera', '0,0', 'available')`, "UPDATE public.world_node_overrides SET state = 'available'"],
}

test('clients cannot write XP, materials, settlements or world state, nor call the authority functions', async () => {
  const { db } = await setup()
  for (const role of ['anon', 'authenticated']) {
    for (const [table, [insert, update]] of Object.entries(WRITES)) {
      await assert.rejects(asRole(db, role, insert, [], A), /permission denied/, `${role} insert ${table}`)
      await assert.rejects(asRole(db, role, update, [], A), /permission denied/, `${role} update ${table}`)
      await assert.rejects(asRole(db, role, `DELETE FROM public.${table}`, [], A), /permission denied/, `${role} delete ${table}`)
    }
    for (const call of [
      `SELECT public.world_commit_work('bbbbbbbb-1', '${A}', 'mining', 'completed', 99999, '[]'::jsonb, 1::smallint, 50::smallint, 'x', NULL)`,
      `SELECT public.world_player_state('${A}')`, `SELECT public.world_owns_pokemon('${A}', 68)`, 'SELECT * FROM public.world_load_nodes()',
    ]) await assert.rejects(asRole(db, role, call, [], A), /permission denied/, `${role}: ${call.slice(0, 40)}`)
  }
  await db.close()
})

test('a player reads only their own XP and materials; nobody reads world overrides directly', async () => {
  const { db, data } = await setup()
  await data.commitWork(commit('cccccccc-1'))
  assert.equal((await asRole(db, 'authenticated', 'SELECT * FROM public.player_skill_xp', [], A)).rows.length, 1)
  assert.equal((await asRole(db, 'authenticated', 'SELECT * FROM public.player_skill_xp', [], B)).rows.length, 0)
  await assert.rejects(asRole(db, 'authenticated', 'SELECT * FROM public.world_node_overrides', [], A), /permission denied/)
  await assert.rejects(asRole(db, 'anon', 'SELECT * FROM public.player_skill_xp'), /permission denied/)
  await db.close()
})

test('one actionId settled twice → one reward, and the retry gets the stored result', async () => {
  const { db, data } = await setup()
  const first = await data.commitWork(commit('dddddddd-1'))
  const second = await data.commitWork(commit('dddddddd-1', { xpGained: 500, rewards: [{ itemId: 'gold_ore', quantity: 9, bonus: false }] }))
  assert.equal(first.applied, true)
  assert.equal(second.applied, false)
  assert.equal(second.settlement.xp_gained, 10, 'the stored settlement, not the retry')
  const state = await data.playerState(A)
  assert.equal(state.xp.woodcutting, 10)
  assert.deepEqual(state.materials, { common_log: 1 })
  await db.close()
})

test('two concurrent settlements of the same action → exactly one applies', async () => {
  const { db, data } = await setup()
  const results = await Promise.all([data.commitWork(commit('eeeeeeee-1')), data.commitWork(commit('eeeeeeee-1'))])
  assert.deepEqual(results.map(r => r.applied).sort(), [false, true])
  assert.equal((await data.playerState(A)).xp.woodcutting, 10)
  await db.close()
})

test('a settlement that cannot be written writes nothing (no XP without material, no reward with the node still up)', async () => {
  const { db, data } = await setup()
  await assert.rejects(data.commitWork(commit('ffffffff-1', { rewards: [{ itemId: 'common_log', quantity: 0, bonus: false }] })), /invalid_reward/)
  const state = await data.playerState(A)
  assert.equal(state.xp.woodcutting, 0)
  assert.deepEqual(state.materials, {})
  assert.deepEqual(await data.loadNodes(), [])
  assert.equal((await data.commitWork(commit('ffffffff-1'))).applied, true, 'and it can be retried with the same id')
  await db.close()
})

test('XP, material and the depleted node are one write; a respawned node disappears on load', async () => {
  const { db, data } = await setup()
  await data.commitWork(commit('abcdabcd-1'))
  const [loaded] = await data.loadNodes()
  assert.equal(loaded.nodeId, 'pradera:-6:-64:tree')
  assert.equal(loaded.state, 'depleted')
  assert.ok(loaded.respawnAt > Date.now())
  await data.commitWork(commit('abcdabcd-2', { node: node({ nodeId: 'pradera:5:5:rock', respawnAt: Date.now() - 1000 }) }))
  assert.deepEqual((await data.loadNodes()).map(n => n.nodeId), ['pradera:-6:-64:tree'])
  await data.commitWork(commit('abcdabcd-3', { node: node({ base: true }) }))
  assert.deepEqual(await data.loadNodes(), [])
  await db.close()
})

test('ownership and the player state come from server-side tables, locked Pokémon excluded', async () => {
  const { db, data } = await setup()
  assert.deepEqual(await data.ownsPokemon(A, 68), { instanceId: 68, speciesId: 68 })
  assert.equal(await data.ownsPokemon(A, 123), null, 'listed on the market')
  assert.equal(await data.ownsPokemon(A, 25), null, 'someone else’s')
  assert.deepEqual((await data.playerState(A)).pokemon, [{ instanceId: 68, speciesId: 68 }])
  await db.close()
})

test('state survives a database restart (on disk)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'world-db-'))
  try {
    const first = await setup(dir)
    await first.data.commitWork(commit('12341234-1'))
    await first.db.close()
    const again = await setup(dir)
    assert.equal((await again.data.loadNodes())[0].state, 'depleted')
    assert.equal((await again.data.playerState(A)).xp.woodcutting, 10)
    assert.equal((await again.data.commitWork(commit('12341234-1'))).applied, false)
    await again.db.close()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
