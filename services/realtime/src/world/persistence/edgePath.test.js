import test from 'node:test'
import assert from 'node:assert/strict'
import { openLocalDatabase, serviceQuery } from './dev/localDatabase.js'
import { createEdgePlayerData } from './playerData.js'

// The production path end to end, minus the network: the realtime's Edge
// adapter → the real world-authority handler → the real SQL functions as
// service_role. Needs a Node that can load TypeScript (22.18+/24); older
// runtimes skip it and the handler keeps its own Deno tests.

const HANDLER = new URL('../../../../../supabase/functions/world-authority/handler.ts', import.meta.url)
const SECRET = 's'.repeat(48)
const USER = '11111111-1111-4111-8111-111111111111'

async function loadHandler() {
  try { return await import(HANDLER.href) } catch { return null }
}

test('realtime → Edge Function handler → SQL: settle once, read back, refuse without the secret', async t => {
  const handler = await loadHandler()
  if (!handler) return t.skip('this Node cannot load TypeScript; covered by `deno test supabase/functions/world-authority/`')
  const db = await openLocalDatabase()
  await db.exec(`INSERT INTO auth.users VALUES ('${USER}'); INSERT INTO public.slots VALUES (68, '${USER}', false);`)
  const query = serviceQuery(db)
  // supabase-js `rpc(fn, namedArgs)`, reproduced over SQL.
  const rpc = async (fn, args) => {
    try {
      const names = Object.keys(args)
      const sql = fn === 'world_load_nodes'
        ? 'SELECT coalesce(json_agg(n), \'[]\'::json) AS data FROM public.world_load_nodes() n'
        : `SELECT public.${fn}(${names.map((name, i) => `${name} => $${i + 1}`).join(', ')}) AS data`
      const values = names.map(name => (args[name] !== null && typeof args[name] === 'object' ? JSON.stringify(args[name]) : args[name]))
      const { rows } = await query(sql, values)
      return { data: rows[0]?.data ?? null, error: null }
    } catch (error) {
      return { data: null, error: { message: error.message } }
    }
  }
  const fetcher = async (_url, init) => handler.handleWorldAuthority(new Request('https://local/world-authority', init), { secret: SECRET, rpc })
  const data = createEdgePlayerData({ url: 'https://local/world-authority', secret: SECRET, publishableKey: 'anon', fetcher })

  assert.deepEqual(await data.ownsPokemon(USER, 68), { instanceId: 68, speciesId: 68 })
  const commit = {
    actionId: '00000000-0000-4000-8000-00000000abcd', userId: USER, skillId: 'mining', outcome: 'completed', xpGained: 10,
    rewards: [{ itemId: 'stone', quantity: 1, bonus: false }], levelBefore: 1, levelAfter: 1, rulesVersion: 'skills-1.0',
    node: { nodeId: 'pradera:-5:-77:rock', areaId: 'pradera', chunkId: '-1,-5', state: 'depleted', respawnAt: Date.now() + 90_000, plot: null, base: false },
  }
  assert.equal((await data.commitWork(commit)).applied, true)
  assert.equal((await data.commitWork(commit)).applied, false)
  const state = await data.playerState(USER)
  assert.equal(state.xp.mining, 10)
  assert.deepEqual(state.materials, { stone: 1 })
  assert.equal((await data.loadNodes())[0].nodeId, 'pradera:-5:-77:rock')

  const stranger = createEdgePlayerData({ url: 'x', secret: 'not-the-secret-but-long-enough-to-pass-length', publishableKey: 'anon', fetcher: async (_u, init) => handler.handleWorldAuthority(new Request('https://local/x', init), { secret: SECRET, rpc }) })
  await assert.rejects(stranger.playerState(USER), /401/)
  await db.close()
})
