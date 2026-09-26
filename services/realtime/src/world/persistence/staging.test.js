import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createEdgePlayerData } from './playerData.js'
import { ownershipFromPlayerData } from '../pokemonOwnership.js'
import { PLOTS } from '../plots.js'
import { RESPAWN_MS } from '../resourceLayout.js'
import { createSkillsWorldPolicy, skillsResourceFor } from '../skills/skills.generated.js'
import { fakeClient, lastMessage, manualClock, praderaNodesNearSpawn, settle } from '../testing.js'
import { WORLD_MESSAGE } from '../worldProtocol.js'
import { WorldRoom } from '../worldRoom.js'

// RC-0.3 Security & Persistence Gate, against a REAL Supabase stack (Postgres,
// PostgREST, Auth, Edge Runtime): real HTTP requests as `anon`, as a signed-in
// user, and as the realtime server through the `world-authority` function.
//
// LOCAL STACK ONLY. It creates users and rewrites ownership rows, so it refuses
// any URL that is not 127.0.0.1/localhost. Run (see INTEGRATION_1_REPORT §19):
//   RC03_SUPABASE_URL=http://127.0.0.1:54321 RC03_ANON_KEY=… RC03_SERVICE_KEY=… \
//   RC03_AUTHORITY_SECRET=… node --test src/world/persistence/staging.test.js
// Without those variables every test here is skipped.

const env = process.env
const BASE = env.RC03_SUPABASE_URL ?? ''
const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)
const skip = LOCAL && env.RC03_ANON_KEY && env.RC03_SERVICE_KEY && env.RC03_AUTHORITY_SECRET
  ? false : 'RC-0.3 staging gate: needs a LOCAL Supabase stack (RC03_* variables)'
const ANON = env.RC03_ANON_KEY
const SERVICE = env.RC03_SERVICE_KEY
const FUNCTION_URL = `${BASE}/functions/v1/world-authority`

const SCYTHER = 123, DIGLETT = 50, MILTANK = 241 // A's workers
const PINSIR = 127, BELLOSSOM = 182 // B's workers
const UNOWNED = 129 // a slot row nobody owns (like most of production's)

// ── HTTP helpers ───────────────────────────────────────────────────────────

/** A request the way a browser (or an attacker with the public key) would make it. */
async function http(path, { method = 'GET', key = ANON, jwt = null, body, prefer, headers = {} } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      apikey: key, authorization: `Bearer ${jwt ?? key}`, 'content-type': 'application/json',
      ...(prefer ? { prefer } : {}), ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: response.status, body: json, text }
}
const asService = (path, options = {}) => http(path, { ...options, key: SERVICE })
const denied = status => status === 401 || status === 403 || status === 404

async function slot(pokemonId) {
  const { body } = await asService(`/rest/v1/slots?select=pokemon_id,owner_id,is_locked&pokemon_id=eq.${pokemonId}`)
  return body[0] ?? null
}

// ── Fixture: two real Auth users with real sessions and a few slots ───────

let fixture = null
async function users() {
  if (fixture) return fixture
  const make = async name => {
    const email = `rc03-${name}-${randomUUID().slice(0, 8)}@example.test`
    const password = `pw-${randomUUID()}`
    const created = await asService('/auth/v1/admin/users', { method: 'POST', body: { email, password, email_confirm: true } })
    assert.equal(created.status, 200, created.text)
    const session = await http('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } })
    assert.equal(session.status, 200, session.text)
    return { id: created.body.id, jwt: session.body.access_token, email, password }
  }
  const [a, b, c] = [await make('a'), await make('b'), await make('c')]
  const profiles = await asService('/rest/v1/profiles', {
    method: 'POST', prefer: 'return=minimal',
    body: [a, b, c].map((user, i) => ({ id: user.id, username: `rc03${'abc'[i]}${user.id.slice(0, 6)}`, tokens: 0 })),
  })
  assert.equal(profiles.status, 201, profiles.text)
  // A and B are WORLD x SKILLS testers; C is an ordinary player behind the closed gate.
  const testers = await asService('/rest/v1/world_skills_testers', { method: 'POST', prefer: 'return=minimal', body: [{ user_id: a.id }, { user_id: b.id }] })
  assert.equal(testers.status, 201, testers.text)
  fixture = { a, b, c }
  return fixture
}

/** Ownership and world tables back to a known state (local stack only). */
async function reset() {
  const { a, b } = await users()
  for (const table of ['skill_work_settlements', 'player_skill_xp', 'player_materials', 'world_node_overrides']) {
    const column = table === 'world_node_overrides' ? 'node_id' : table === 'skill_work_settlements' ? 'action_id' : 'user_id'
    const cleared = await asService(`/rest/v1/${table}?${column}=not.is.null`, { method: 'DELETE' })
    assert.ok(cleared.status < 300, cleared.text)
  }
  await asService('/rest/v1/market_listings?id=not.is.null', { method: 'DELETE' })
  await asService('/rest/v1/slots?pokemon_id=not.is.null', { method: 'DELETE' })
  const rows = [
    ...[SCYTHER, DIGLETT, MILTANK].map(id => ({ pokemon_id: id, owner_id: a.id, is_locked: false })),
    ...[PINSIR, BELLOSSOM].map(id => ({ pokemon_id: id, owner_id: b.id, is_locked: false })),
    { pokemon_id: UNOWNED, owner_id: null, is_locked: false },
  ]
  const seeded = await asService('/rest/v1/slots', { method: 'POST', body: rows, prefer: 'return=minimal' })
  assert.equal(seeded.status, 201, seeded.text)
  return fixture
}

// ── 1. slots: what a client can and cannot do ─────────────────────────────

test('slots: anon and a signed-in user cannot create, re-own, lock, move or delete a slot', { skip }, async () => {
  const { a, b } = await reset()
  for (const [who, jwt] of [['anon', null], ['authenticated', a.jwt]]) {
    const insert = await http('/rest/v1/slots', { method: 'POST', jwt, body: { pokemon_id: 7, owner_id: a.id } })
    assert.ok(denied(insert.status), `${who} INSERT → ${insert.status} ${insert.text}`)
    assert.equal(await slot(7), null, `${who} created no slot`)

    const upsert = await http('/rest/v1/slots?on_conflict=pokemon_id', { method: 'POST', jwt, prefer: 'resolution=merge-duplicates', body: { pokemon_id: PINSIR, owner_id: a.id } })
    assert.ok(denied(upsert.status), `${who} UPSERT → ${upsert.status}`)

    // Under RLS an UPDATE/DELETE with no matching policy "succeeds" on zero rows:
    // the proof is the row read back afterwards.
    await http(`/rest/v1/slots?pokemon_id=eq.${PINSIR}`, { method: 'PATCH', jwt, body: { owner_id: a.id } })
    await http(`/rest/v1/slots?pokemon_id=eq.${UNOWNED}`, { method: 'PATCH', jwt, body: { owner_id: a.id } })
    await http(`/rest/v1/slots?pokemon_id=eq.${SCYTHER}`, { method: 'PATCH', jwt, body: { is_locked: true, pokemon_id: 400 } })
    await http(`/rest/v1/slots?pokemon_id=eq.${PINSIR}`, { method: 'DELETE', jwt })
    await http(`/rest/v1/slots?pokemon_id=eq.${SCYTHER}`, { method: 'DELETE', jwt })
    assert.deepEqual(await slot(PINSIR), { pokemon_id: PINSIR, owner_id: b.id, is_locked: false }, `${who}: B keeps Pinsir`)
    assert.deepEqual(await slot(UNOWNED), { pokemon_id: UNOWNED, owner_id: null, is_locked: false }, `${who}: nobody got the free slot`)
    assert.deepEqual(await slot(SCYTHER), { pokemon_id: SCYTHER, owner_id: a.id, is_locked: false }, `${who}: A's own slot unchanged`)
  }
})

test('slots: the privileged ownership functions are not callable by clients', { skip }, async () => {
  const { a, b } = await reset()
  for (const jwt of [null, a.jwt]) {
    const claim = await http('/rest/v1/rpc/claim_slot', { method: 'POST', jwt, body: { p_pokemon_id: PINSIR, p_buyer_id: a.id, p_payment_provider: 'tokens', p_payment_id: 'x', p_is_free: true } })
    assert.ok(denied(claim.status), `claim_slot → ${claim.status}`)
    const confirm = await http('/rest/v1/rpc/confirm_payment', { method: 'POST', jwt, body: { p_transaction_id: randomUUID(), p_payment_id: 'x' } })
    assert.ok(denied(confirm.status), `confirm_payment → ${confirm.status}`)
  }
  assert.equal((await slot(PINSIR)).owner_id, b.id)
})

test('market: no session is an explicit refusal before anything is read or locked', { skip }, async () => {
  const { b } = await reset()
  const listing = await http('/rest/v1/rpc/publish_market_listing', { method: 'POST', jwt: b.jwt, body: { p_pokemon_id: PINSIR, p_price_tokens: 5 } })
  assert.equal(listing.status, 200, listing.text)
  const calls = [
    ['publish_market_listing', { p_pokemon_id: UNOWNED, p_price_tokens: 1 }],
    ['cancel_market_listing', { p_listing_id: listing.body.listing_id }],
    ['buy_market_listing', { p_listing_id: listing.body.listing_id }],
  ]
  for (const [fn, args] of calls) {
    // anon: no EXECUTE at all.
    const anon = await http(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args })
    assert.ok(denied(anon.status), `anon ${fn} -> ${anon.status}`)
    assert.equal(anon.body?.code, '42501', `anon ${fn}: ${anon.text}`)
    // A caller that has EXECUTE but no user (the service key): the body's own check.
    const sessionless = await asService(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args })
    assert.ok(sessionless.status >= 400, `sessionless ${fn} -> ${sessionless.status}`)
    assert.equal(sessionless.body?.message, 'not_authenticated', `sessionless ${fn}: ${sessionless.text}`)
  }
  assert.deepEqual(await slot(UNOWNED), { pokemon_id: UNOWNED, owner_id: null, is_locked: false })
  assert.deepEqual(await slot(PINSIR), { pokemon_id: PINSIR, owner_id: b.id, is_locked: true }, 'listing untouched')
  const cancelled = await http('/rest/v1/rpc/cancel_market_listing', { method: 'POST', jwt: b.jwt, body: { p_listing_id: listing.body.listing_id } })
  assert.equal(cancelled.status, 200, cancelled.text)
})

test('slots: the market functions only let the real owner list, and nobody buys without paying', { skip }, async () => {
  const { a, b } = await reset()
  // A cannot list B's Pokémon or a free one; anon cannot list anything.
  for (const [jwt, id] of [[a.jwt, PINSIR], [a.jwt, UNOWNED], [null, UNOWNED], [null, PINSIR]]) {
    const listing = await http('/rest/v1/rpc/publish_market_listing', { method: 'POST', jwt, body: { p_pokemon_id: id, p_price_tokens: 1 } })
    assert.ok(listing.status >= 400, `publish ${id} → ${listing.status} ${listing.text}`)
  }
  assert.equal((await slot(UNOWNED)).is_locked, false)
  assert.equal((await asService('/rest/v1/market_listings?select=id')).body.length, 0)

  // The legitimate path still works: B lists Pinsir (locked → WORLD stops using it).
  const listed = await http('/rest/v1/rpc/publish_market_listing', { method: 'POST', jwt: b.jwt, body: { p_pokemon_id: PINSIR, p_price_tokens: 5 } })
  assert.equal(listed.status, 200, listed.text)
  assert.equal((await slot(PINSIR)).is_locked, true)
  // Someone else cannot cancel it; A (0 tokens) and anon cannot buy it.
  for (const jwt of [a.jwt, null]) {
    const cancel = await http('/rest/v1/rpc/cancel_market_listing', { method: 'POST', jwt, body: { p_listing_id: listed.body.listing_id } })
    assert.ok(cancel.status >= 400, `cancel → ${cancel.status}`)
    const buy = await http('/rest/v1/rpc/buy_market_listing', { method: 'POST', jwt, body: { p_listing_id: listed.body.listing_id } })
    assert.ok(buy.status >= 400, `buy → ${buy.status}`)
  }
  assert.deepEqual(await slot(PINSIR), { pokemon_id: PINSIR, owner_id: b.id, is_locked: true })
  const cancelled = await http('/rest/v1/rpc/cancel_market_listing', { method: 'POST', jwt: b.jwt, body: { p_listing_id: listed.body.listing_id } })
  assert.equal(cancelled.status, 200, cancelled.text)
  assert.equal((await slot(PINSIR)).is_locked, false)
})

test('slots: what a legitimate client needs — reading ownership — still works', { skip }, async () => {
  const { a } = await reset()
  for (const jwt of [null, a.jwt]) {
    const read = await http(`/rest/v1/slots?select=pokemon_id,owner_id&owner_id=eq.${a.id}&order=pokemon_id`, { jwt })
    assert.equal(read.status, 200)
    assert.deepEqual(read.body.map(row => row.pokemon_id), [DIGLETT, SCYTHER, MILTANK])
  }
})

test('slots: GraphQL cannot change ownership either', { skip }, async () => {
  const { a, b } = await reset()
  const mutation = { query: `mutation { updateslotsCollection(set: { owner_id: "${a.id}" }, filter: { pokemon_id: { eq: ${PINSIR} } }) { affectedCount } }` }
  for (const jwt of [null, a.jwt]) {
    const result = await http('/graphql/v1', { method: 'POST', jwt, body: mutation })
    assert.ok(result.status >= 400 || result.body?.errors || result.body?.data?.updateslotsCollection?.affectedCount === 0, `graphql → ${result.status} ${result.text}`)
  }
  assert.equal((await slot(PINSIR)).owner_id, b.id)
})

// ── 2. The WORLD × SKILLS tables and functions ────────────────────────────

const WORLD_TABLES = {
  player_skill_xp: user => ({ user_id: user, skill_id: 'woodcutting', xp: 999999 }),
  player_materials: user => ({ user_id: user, material_id: 'gold_ore', quantity: 999999 }),
  skill_work_settlements: user => ({ action_id: randomUUID(), user_id: user, skill_id: 'mining', outcome: 'completed', xp_gained: 999999, xp_after: 999999, rewards: [], level_before: 1, level_after: 99, rules_version: 'x' }),
  world_node_overrides: () => ({ node_id: 'pradera:-6:-64:tree', area_id: 'pradera', chunk_id: '0,0', state: 'depleted', respawn_at: '2999-01-01T00:00:00Z' }),
}

const WORLD_PATCHES = {
  player_skill_xp: user => [`user_id=eq.${user}`, { xp: 999999 }],
  player_materials: user => [`user_id=eq.${user}`, { quantity: 999999 }],
  skill_work_settlements: user => [`user_id=eq.${user}`, { xp_gained: 999999, action_id: randomUUID(), outcome: 'cancelled' }],
  world_node_overrides: () => ['node_id=eq.pradera:-6:-64:tree', { state: 'available', respawn_at: null }],
}

test('world tables: clients cannot insert, update or delete XP, materials, settlements or node state', { skip }, async () => {
  const { a } = await reset()
  await commit(a.id, { actionId: randomUUID() }) // A has real rows to aim at
  for (const [who, jwt] of [['anon', null], ['authenticated', a.jwt]]) {
    for (const [table, row] of Object.entries(WORLD_TABLES)) {
      const insert = await http(`/rest/v1/${table}`, { method: 'POST', jwt, body: row(a.id) })
      assert.ok(denied(insert.status), `${who} INSERT ${table} → ${insert.status}`)
      const [filter, change] = WORLD_PATCHES[table](a.id)
      const update = await http(`/rest/v1/${table}?${filter}`, { method: 'PATCH', jwt, body: change })
      assert.ok(denied(update.status), `${who} UPDATE ${table} → ${update.status} ${update.text}`)
      const remove = await http(`/rest/v1/${table}?${filter}`, { method: 'DELETE', jwt })
      assert.ok(denied(remove.status), `${who} DELETE ${table} → ${remove.status} ${remove.text}`)
    }
  }
  const state = await edge('player_state', { userId: a.id })
  assert.deepEqual(state.body.state.xp, { woodcutting: 10 })
  assert.deepEqual(state.body.state.materials, { common_log: 1 })
  assert.equal((await asService('/rest/v1/skill_work_settlements?select=action_id')).body.length, 1)
  assert.equal((await asService('/rest/v1/world_node_overrides?select=node_id')).body.length, 1)
})

test('world functions: none is executable by anon or a signed-in user', { skip }, async () => {
  const { a } = await reset()
  const calls = {
    world_commit_work: { p_action_id: randomUUID(), p_user_id: a.id, p_skill_id: 'mining', p_outcome: 'completed', p_xp_gained: 999999, p_rewards: [], p_level_before: 1, p_level_after: 99, p_rules_version: 'x', p_node: null },
    world_player_state: { p_user_id: a.id },
    world_owns_pokemon: { p_user_id: a.id, p_pokemon_id: SCYTHER },
    world_load_nodes: {},
  }
  for (const jwt of [null, a.jwt]) {
    for (const [fn, args] of Object.entries(calls)) {
      const result = await http(`/rest/v1/rpc/${fn}`, { method: 'POST', jwt, body: args })
      assert.ok(denied(result.status), `${fn} → ${result.status} ${result.text}`)
    }
  }
  assert.equal((await asService('/rest/v1/player_skill_xp?select=xp')).body.length, 0)
})

test('world tables: a player reads only their own XP, materials and settlements; nobody reads node state', { skip }, async () => {
  const { a, b } = await reset()
  await commit(a.id, { actionId: randomUUID() })
  await commit(b.id, { actionId: randomUUID(), nodeId: 'pradera:-7:-64:tree' })
  const mine = await http('/rest/v1/player_skill_xp?select=user_id,xp', { jwt: a.jwt })
  assert.equal(mine.status, 200)
  assert.deepEqual(mine.body.map(row => row.user_id), [a.id])
  assert.deepEqual((await http('/rest/v1/skill_work_settlements?select=user_id', { jwt: a.jwt })).body.map(row => row.user_id), [a.id])
  assert.ok(denied((await http('/rest/v1/player_materials?select=user_id')).status), 'anon reads nothing')
  assert.ok(denied((await http('/rest/v1/player_skill_xp?select=user_id')).status), 'anon reads nothing')
  assert.ok(denied((await http('/rest/v1/world_node_overrides?select=node_id', { jwt: a.jwt })).status))
})

// ── 3. The world-authority function (the realtime server's only door) ─────

const edge = (op, body, secret = env.RC03_AUTHORITY_SECRET, extraHeaders = {}) => fetch(FUNCTION_URL, {
  method: 'POST',
  headers: { 'content-type': 'application/json', apikey: ANON, authorization: `Bearer ${ANON}`, ...(secret ? { 'x-world-authority-secret': secret } : {}), ...extraHeaders },
  body: JSON.stringify({ op, ...body }),
}).then(async response => ({ status: response.status, text: await response.clone().text(), body: await response.json().catch(() => null) }))

function commitBody(userId, { actionId, xp = 10, rewards = [{ itemId: 'common_log', quantity: 1, bonus: false }], nodeId = 'pradera:-6:-64:tree', state = 'depleted' } = {}) {
  return {
    actionId, userId, skillId: 'woodcutting', outcome: 'completed', xpGained: xp, rewards, levelBefore: 1, levelAfter: 1, rulesVersion: 'rc03',
    node: { nodeId, areaId: 'pradera', chunkId: '0,0', state, respawnAt: Date.now() + 90_000, plot: null, base: false },
  }
}
const commit = (userId, options) => edge('commit_work', { commit: commitBody(userId, options) })

test('world-authority: nothing works without the server secret; errors leak nothing', { skip }, async () => {
  const { a } = await reset()
  for (const [label, secret, headers] of [
    ['no secret', null, {}], ['wrong secret', 'x'.repeat(48), {}],
    ['a user session', null, { authorization: `Bearer ${a.jwt}` }], ['the service key as bearer', null, { authorization: `Bearer ${SERVICE}`, apikey: SERVICE }],
  ]) {
    const result = await edge('commit_work', { commit: commitBody(a.id, { actionId: randomUUID(), xp: 999999 }) }, secret, headers)
    assert.equal(result.status, 401, `${label} → ${result.status}`)
  }
  assert.equal((await asService('/rest/v1/player_skill_xp?select=xp')).body.length, 0)

  const invalid = [
    [{ commit: { ...commitBody(a.id, { actionId: 'not an id!' }) } }, 'invalid_commit'],
    [{ commit: { ...commitBody('someone', { actionId: randomUUID() }) } }, 'invalid_commit'],
    [{ commit: { ...commitBody(a.id, { actionId: randomUUID() }), skillId: 'fishing' } }, 'invalid_commit'],
  ]
  for (const [body, error] of invalid) {
    const result = await edge('commit_work', body)
    assert.equal(result.status, 400)
    assert.equal(result.body.error, error)
  }
  assert.equal((await edge('drop_table', {})).body.error, 'unknown_op')
  // A database error comes back as a bare code: no SQL, no key, no secret.
  const failing = await commit(a.id, { actionId: randomUUID(), rewards: [{ itemId: 'common_log', quantity: 0 }] })
  assert.equal(failing.status, 500)
  assert.deepEqual(failing.body, { error: 'authority_failed' })
  for (const leak of [env.RC03_AUTHORITY_SECRET, SERVICE, 'invalid_reward', 'service_role', 'postgres']) assert.ok(!failing.text.includes(leak))
})

test('settlement: X once → +10 XP, +1 material, one settlement, node persisted; X again → no-op', { skip }, async () => {
  const { a } = await reset()
  const actionId = randomUUID()
  const first = await commit(a.id, { actionId })
  assert.equal(first.status, 200, first.text)
  assert.equal(first.body.result.applied, true)
  // The same action again: identical, with other (valid) numbers, and with absurd ones.
  const same = await commit(a.id, { actionId })
  assert.equal(same.body.result.applied, false)
  const other = await commit(a.id, { actionId, xp: 50, rewards: [{ itemId: 'gold_ore', quantity: 5 }] })
  assert.equal(other.body.result.applied, false)
  assert.equal(other.body.result.settlement.xp_gained, 10, 'the stored settlement, not the retry’s numbers')
  const absurd = await commit(a.id, { actionId, xp: 999999, rewards: [{ itemId: 'gold_ore', quantity: 100 }] })
  assert.equal(absurd.status, 500, 'out of range: refused outright')
  const state = (await edge('player_state', { userId: a.id })).body.state
  assert.deepEqual(state.xp, { woodcutting: 10 })
  assert.deepEqual(state.materials, { common_log: 1 })
  assert.equal((await asService(`/rest/v1/skill_work_settlements?select=action_id&action_id=eq.${actionId}`)).body.length, 1)
  const nodes = (await edge('load_nodes', {})).body.nodes
  assert.deepEqual(nodes.map(n => [n.node_id, n.state, n.action_id]), [['pradera:-6:-64:tree', 'depleted', actionId]])
})

test('concurrency: the same action settled 2 and 20 times at once pays exactly once', { skip }, async () => {
  const { a } = await reset()
  for (const copies of [2, 20]) {
    const actionId = randomUUID()
    const results = await Promise.all(Array.from({ length: copies }, () => commit(a.id, { actionId, nodeId: `pradera:${copies}:-64:tree` })))
    assert.ok(results.every(r => r.status === 200), results.map(r => r.status).join())
    assert.equal(results.filter(r => r.body.result.applied).length, 1, `${copies} copies → one applied`)
  }
  const state = (await edge('player_state', { userId: a.id })).body.state
  assert.deepEqual(state.xp, { woodcutting: 20 })
  assert.deepEqual(state.materials, { common_log: 2 })
  assert.equal((await asService('/rest/v1/skill_work_settlements?select=action_id')).body.length, 2)
})

test('atomicity: a settlement that fails anywhere leaves no XP, no material, no settlement, no node change', { skip }, async () => {
  const { a } = await reset()
  await commit(a.id, { actionId: randomUUID(), nodeId: 'pradera:-7:-64:tree' })
  const before = (await edge('player_state', { userId: a.id })).body.state
  const failures = [
    // the 2nd reward is invalid: the 1st reward, the XP and the settlement were already written in this transaction
    { rewards: [{ itemId: 'common_log', quantity: 1 }, { itemId: 'stone', quantity: 0 }] },
    // the node state breaks its CHECK after XP and materials were written
    { state: 'NOT A STATE' },
    // a material id the table refuses
    { rewards: [{ itemId: 'DROP TABLE', quantity: 1 }] },
  ]
  for (const failure of failures) {
    const actionId = randomUUID()
    const result = await commit(a.id, { actionId, nodeId: 'pradera:-8:-64:tree', ...failure })
    assert.equal(result.status, 500, JSON.stringify(failure))
    assert.equal((await asService(`/rest/v1/skill_work_settlements?select=action_id&action_id=eq.${actionId}`)).body.length, 0)
  }
  assert.deepEqual((await edge('player_state', { userId: a.id })).body.state, before)
  assert.deepEqual((await edge('load_nodes', {})).body.nodes.map(n => n.node_id), ['pradera:-7:-64:tree'])
})

test('ownership through the function follows slots, and a listed (locked) Pokémon cannot work', { skip }, async () => {
  const { a, b } = await reset()
  const owns = async (user, id) => (await edge('owns_pokemon', { userId: user, instanceId: id })).body.owns
  assert.equal(await owns(a.id, SCYTHER), true)
  assert.equal(await owns(a.id, PINSIR), false)
  assert.equal(await owns(a.id, UNOWNED), false)
  await http('/rest/v1/rpc/publish_market_listing', { method: 'POST', jwt: b.jwt, body: { p_pokemon_id: PINSIR, p_price_tokens: 5 } })
  assert.equal(await owns(b.id, PINSIR), false)
  assert.deepEqual((await edge('player_state', { userId: b.id })).body.state.pokemon, [BELLOSSOM])
})

test('feature gate: closed users cannot work or settle; testers can; opening the gate opens it to all', { skip }, async () => {
  const { a, c } = await reset()
  await asService('/rest/v1/slots', { method: 'POST', prefer: 'return=minimal', body: [{ pokemon_id: 7, owner_id: c.id, is_locked: false }] })
  const access = async user => (await edge('access', { userId: user.id })).body.access
  assert.equal(await access(a), 'tester')
  assert.equal(await access(c), 'closed')
  const closedState = (await edge('player_state', { userId: c.id })).body
  assert.equal(closedState.access, 'closed')
  assert.deepEqual(closedState.state.pokemon, [], 'a closed player has no workable Pokemon')
  assert.equal((await edge('owns_pokemon', { userId: c.id, instanceId: 7 })).body.owns, false)
  const refused = await commit(c.id, { actionId: randomUUID() })
  assert.equal(refused.status, 403)
  assert.deepEqual(refused.body, { error: 'world_skills_closed' })
  assert.equal((await asService(`/rest/v1/player_skill_xp?select=xp&user_id=eq.${c.id}`)).body.length, 0)
  // The gate row and the testers list are invisible and unwritable for clients.
  for (const jwt of [null, c.jwt]) {
    assert.ok(denied((await http('/rest/v1/world_skills_gate?select=enabled', { jwt })).status))
    assert.ok(denied((await http('/rest/v1/world_skills_testers', { method: 'POST', jwt, body: { user_id: c.id } })).status))
    assert.ok(denied((await http('/rest/v1/world_skills_gate?id=eq.world-skills', { method: 'PATCH', jwt, body: { enabled: true } })).status))
    assert.ok(denied((await http('/rest/v1/rpc/world_skills_access', { method: 'POST', jwt, body: { p_user_id: c.id } })).status))
  }
  assert.equal(await access(c), 'closed')
  // Operator opens it: everyone; closes it again: back to testers only.
  const setGate = enabled => asService('/rest/v1/world_skills_gate?id=eq.world-skills', { method: 'PATCH', body: { enabled } })
  try {
    assert.ok((await setGate(true)).status < 300)
    assert.equal(await access(c), 'open')
    assert.deepEqual((await edge('player_state', { userId: c.id })).body.state.pokemon, [7])
    assert.equal((await commit(c.id, { actionId: randomUUID() })).status, 200)
  } finally {
    assert.ok((await setGate(false)).status < 300)
  }
  assert.equal(await access(c), 'closed')
  assert.equal(await access(a), 'tester')
})

// ── 4. The realtime world on the real database (production adapter) ──────

const TREE = praderaNodesNearSpawn(20).find(({ node }) => skillsResourceFor(node)?.id === 'common_tree')
const ROCK = praderaNodesNearSpawn(20).find(({ node }) => skillsResourceFor(node)?.id === 'stone_outcrop')
const PLOT = PLOTS[0]

async function world(clock) {
  const data = createEdgePlayerData({ url: FUNCTION_URL, secret: env.RC03_AUTHORITY_SECRET, publishableKey: ANON })
  const actors = new Map()
  const sockets = new Map()
  const room = new WorldRoom({
    skills: createSkillsWorldPolicy({ store: data, now: clock.now, growScale: 0.001 }), ownership: ownershipFromPlayerData(data, clock.now),
    playerData: data, now: clock.now, log: () => {}, lookupActor: id => actors.get(id) ?? null, clientForPlayer: id => sockets.get(id) ?? null,
  })
  await room.start()
  const join = async (id, spot) => {
    const client = fakeClient(id)
    const actor = { id, areaId: 'pradera', tx: spot.tx, ty: spot.ty }
    actors.set(id, actor); sockets.set(id, client)
    room.join(client, { worldProtocol: 1 }, { kind: 'player', userId: id, token: null })
    room.snapshot(client, actor)
    for (let i = 0; i < 40 && !lastMessage(client, WORLD_MESSAGE.PLAYER_STATE); i++) await new Promise(r => setTimeout(r, 25))
    return { client, actor }
  }
  const quiet = async () => {
    await settle()
    for (let i = 0; i < 400 && [...room.authority.actions.values()].some(a => a.phase === 'settling'); i++) await new Promise(r => setTimeout(r, 25))
    await settle()
  }
  const finish = async ms => { clock.advance(ms); room.tick(); await quiet(); room.flush() }
  return { room, data, join, finish, quiet }
}
const result = client => lastMessage(client, WORLD_MESSAGE.WORK_RESULT)
const nodeIn = (payload, id) => payload?.nodes?.find(node => node.id === id)

test('WORLD on Supabase: chop → one settlement → restart keeps the stump → respawn after respawnAt', { skip }, async () => {
  const { a, b } = await reset()
  const clock = manualClock(Date.now())
  const first = await world(clock)
  const pa = await first.join(a.id, TREE.stands[0])
  await first.room.work(pa.actor, { nodeId: TREE.node.id, pokemonInstanceId: SCYTHER, requestId: 1 })
  const started = result(pa.client)
  assert.equal(started.ok, true, JSON.stringify(started))
  await first.finish(started.endsAt - started.startedAt)
  assert.equal(lastMessage(pa.client, WORLD_MESSAGE.WORK_DONE).ok, true)
  assert.deepEqual((await first.data.playerState(a.id)).xp.woodcutting, 10)

  // Restart: a new room on the same database. While respawnAt > now the tree is a stump.
  const again = await world(clock)
  const pb = await again.join(b.id, TREE.stands[1])
  assert.equal(nodeIn(lastMessage(pb.client, WORLD_MESSAGE.SNAPSHOT), TREE.node.id).state, 'depleted')
  await again.room.work(pb.actor, { nodeId: TREE.node.id, pokemonInstanceId: PINSIR, requestId: 1 })
  assert.equal(result(pb.client).reason, 'depleted')
  // After respawnAt it is available again — no AVAILABLE row needed.
  clock.advance(RESPAWN_MS.tree + 1)
  const later = await world(clock)
  const pb2 = await later.join(b.id, TREE.stands[1])
  assert.equal(nodeIn(lastMessage(pb2.client, WORLD_MESSAGE.SNAPSHOT), TREE.node.id), undefined, 'base node: nothing to report')
  await later.room.work(pb2.actor, { nodeId: TREE.node.id, pokemonInstanceId: PINSIR, requestId: 2 })
  assert.equal(result(pb2.client).ok, true)
})

test('WORLD on Supabase: farming survives a restart and only the planter harvests, once', { skip }, async () => {
  const { a, b } = await reset()
  const clock = manualClock(Date.now())
  const first = await world(clock)
  const pa = await first.join(a.id, { tx: PLOT.tx - 1, ty: PLOT.ty })
  const pb = await first.join(b.id, { tx: PLOT.tx, ty: PLOT.ty - 1 })
  await first.room.work(pa.actor, { nodeId: PLOT.id, pokemonInstanceId: MILTANK, requestId: 1, cropId: 'oran' })
  const planting = result(pa.client)
  assert.equal(planting.ok, true, JSON.stringify(planting))
  await first.finish(planting.endsAt - planting.startedAt)
  // B cannot plant over it or harvest it.
  await first.room.work(pb.actor, { nodeId: PLOT.id, pokemonInstanceId: BELLOSSOM, requestId: 1, cropId: 'oran' })
  assert.equal(result(pb.client).reason, 'not-your-plot')

  const again = await world(clock)
  const pa2 = await again.join(a.id, { tx: PLOT.tx - 1, ty: PLOT.ty })
  const seen = nodeIn(lastMessage(pa2.client, WORLD_MESSAGE.SNAPSHOT), PLOT.id)
  assert.equal(seen.state, 'planted', 'not reset by the restart')
  assert.equal(seen.plot.ownerId, a.id)
  clock.set(seen.plot.readyAt)
  const ready = await world(clock)
  const pa3 = await ready.join(a.id, { tx: PLOT.tx - 1, ty: PLOT.ty })
  const pb3 = await ready.join(b.id, { tx: PLOT.tx, ty: PLOT.ty - 1 })
  assert.equal(nodeIn(lastMessage(pa3.client, WORLD_MESSAGE.SNAPSHOT), PLOT.id).state, 'ready', 'ready by the stored timestamps')
  await ready.room.work(pb3.actor, { nodeId: PLOT.id, pokemonInstanceId: BELLOSSOM, requestId: 1 })
  assert.equal(result(pb3.client).reason, 'not-your-plot')
  await ready.room.work(pa3.actor, { nodeId: PLOT.id, pokemonInstanceId: MILTANK, requestId: 1 })
  const harvesting = result(pa3.client)
  assert.equal(harvesting.farmAction, 'harvest')
  await ready.finish(harvesting.endsAt - harvesting.startedAt)
  const paid = lastMessage(pa3.client, WORLD_MESSAGE.WORK_DONE).summary.rewards[0].quantity
  await ready.room.work(pa3.actor, { nodeId: PLOT.id, pokemonInstanceId: MILTANK, requestId: 2 })
  assert.equal(result(pa3.client).reason, 'choose-crop', 'harvested: empty again')
  const saved = await ready.data.playerState(a.id)
  assert.equal(saved.xp.farming, 8 + 25)
  assert.equal(saved.materials.oran_berry, paid)
  assert.equal((await ready.data.playerState(b.id)).xp.farming ?? 0, 0)
})

test('WORLD on Supabase: hostile intents are ignored or refused', { skip }, async () => {
  const { a, b } = await reset()
  const clock = manualClock(Date.now())
  const w = await world(clock)
  const pa = await w.join(a.id, TREE.stands[0])
  await w.join(b.id, TREE.stands[1])
  await w.room.work(pa.actor, { nodeId: TREE.node.id, pokemonInstanceId: PINSIR, requestId: 1 })
  assert.equal(result(pa.client).reason, 'not-owner', 'someone else’s Pokémon')
  await w.room.work(pa.actor, { nodeId: `pradera:${TREE.node.tx}:${TREE.node.ty}:boulder`, pokemonInstanceId: SCYTHER, requestId: 2 })
  assert.equal(result(pa.client).reason, 'unknown-node', 'invented node')
  await w.room.work(pa.actor, { nodeId: ROCK.node.id, pokemonInstanceId: DIGLETT, requestId: 3 })
  assert.equal(result(pa.client).reason, 'too-far', 'real node, far away')
  const chosenId = randomUUID()
  await w.room.work(pa.actor, {
    nodeId: TREE.node.id, pokemonInstanceId: SCYTHER, requestId: 4,
    xp: 999999, materialQuantity: 999999, quantity: 999999, reward: { itemId: 'gold_ore', quantity: 999 }, userId: b.id, playerId: b.id, actionId: chosenId,
  })
  const started = result(pa.client)
  assert.equal(started.ok, true)
  assert.notEqual(started.actionId, chosenId, 'the server names the action, not the client')
  await w.finish(started.endsAt - started.startedAt)
  // What the server rolled (base 1, +1 on an aptitude bonus) — never the payload's 999999.
  const paid = lastMessage(pa.client, WORLD_MESSAGE.WORK_DONE).summary.rewards
  assert.deepEqual(paid.map(r => r.itemId), ['common_log'])
  assert.ok(paid[0].quantity <= 2)
  assert.deepEqual((await w.data.playerState(a.id)).xp, { woodcutting: 10, mining: 0, farming: 0 })
  assert.deepEqual((await w.data.playerState(a.id)).materials, { common_log: paid[0].quantity })
  assert.deepEqual((await w.data.playerState(b.id)).xp, { woodcutting: 0, mining: 0, farming: 0 }, 'the payload cannot name another player')
})

test('WORLD on Supabase: A and B race for one tree — one reservation, one reward', { skip }, async () => {
  const { a, b } = await reset()
  const clock = manualClock(Date.now())
  const w = await world(clock)
  const pa = await w.join(a.id, TREE.stands[0])
  const pb = await w.join(b.id, TREE.stands[1])
  await Promise.all([
    w.room.work(pa.actor, { nodeId: TREE.node.id, pokemonInstanceId: SCYTHER, requestId: 1 }),
    w.room.work(pb.actor, { nodeId: TREE.node.id, pokemonInstanceId: PINSIR, requestId: 1 }),
  ])
  const results = [result(pa.client), result(pb.client)]
  assert.deepEqual(results.map(r => r.ok).sort(), [false, true])
  const winner = results.find(r => r.ok)
  await w.finish(winner.endsAt - winner.startedAt)
  const total = (await w.data.playerState(a.id)).xp.woodcutting + (await w.data.playerState(b.id)).xp.woodcutting
  assert.equal(total, 10)
  assert.equal((await asService('/rest/v1/skill_work_settlements?select=action_id')).body.length, 1)
})

// ── 5. Identity: an expired or forged token is not an identity ────────────

test('identity: the realtime join accepts a live session and refuses a forged or expired one', { skip }, async () => {
  const { authenticateSupabase } = await import('../../auth/supabaseAuth.js')
  const { a } = await users()
  const authEnv = { SUPABASE_URL: BASE, SUPABASE_PUBLISHABLE_KEY: ANON }
  const username = `rc03a${a.id.slice(0, 6)}`
  // A fresh session (a new sign-in, like supabase-js hands the client on every (re)join).
  const fresh = await http('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: a.email, password: a.password } })
  assert.deepEqual(await authenticateSupabase(fresh.body.access_token, authEnv), { kind: 'player', userId: a.id, username })
  // A forged token (payload edited, signature kept) and an expired one are guests.
  const [header, payload, signature] = fresh.body.access_token.split('.')
  const forgedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), sub: randomUUID() })).toString('base64url')
  assert.equal((await authenticateSupabase(`${header}.${forgedPayload}.${signature}`, authEnv)).kind, 'guest')
  // Expired but otherwise genuine: the same claims and session, `exp` in the past,
  // correctly signed with the local stack's JWT secret (HS256 only).
  assert.ok(env.RC03_JWT_SECRET, 'set RC03_JWT_SECRET (the LOCAL stack’s JWT secret) to prove the expired-token refusal')
  const { createHmac } = await import('node:crypto')
  const claims = JSON.parse(Buffer.from(payload, 'base64url'))
  const hs256 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const sign = body => {
    const encoded = Buffer.from(JSON.stringify(body)).toString('base64url')
    return `${hs256}.${encoded}.${createHmac('sha256', env.RC03_JWT_SECRET).update(`${hs256}.${encoded}`).digest('base64url')}`
  }
  const now = Math.floor(Date.now() / 1000)
  // Control: the same claims re-signed with a future exp are accepted, so the refusal below is the expiry alone.
  assert.equal((await authenticateSupabase(sign({ ...claims, exp: now + 600 }), authEnv)).kind, 'player', 're-signed control')
  assert.equal((await authenticateSupabase(sign({ ...claims, iat: now - 7200, exp: now - 60 }), authEnv)).kind, 'guest', 'expired access token')
})
