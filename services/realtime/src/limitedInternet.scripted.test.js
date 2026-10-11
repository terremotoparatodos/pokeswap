import test from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'

// SCRIPTED Auth/Edge, real HTTP matchmaking + WebSocket on loopback only.
// No SQL, hosted calls or real credentials. Refuse every non-fixture URL.
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'
const ORIGIN = 'https://eco-scripted.invalid'
Object.assign(process.env, {
  NODE_ENV: 'production', WORLD_ECO_RELEASE: 'limited', WORLD_ECO_EXPERIMENT: 'on', WORLD_ECO_COMBATANT_MODE: 'owned',
  WORLD_ECO_TESTER_IDS: `${A},${B}`, WORLD_ECO_EXPIRES_AT: new Date(Date.now() + 8_000).toISOString(),
  ALLOWED_ORIGINS: ORIGIN, SUPABASE_URL: 'https://auth-scripted.invalid', SUPABASE_PUBLISHABLE_KEY: 'SCRIPTED-public',
  WORLD_AUTHORITY_URL: 'https://edge-scripted.invalid', WORLD_AUTHORITY_SECRET: 'SCRIPTED-only-'.repeat(4), WORLD_LOCATION_PERSISTENCE: 'off',
})
for (const name of ['PRESENCE_BENCHMARK', 'WORLD_PLAYERDATA', 'WORLD_DEMO_SKILLS', 'WORLD_WILD_CATALOG', 'COLYSEUS_CLOUD', 'NODE_APP_INSTANCE']) delete process.env[name]
const realFetch = globalThis.fetch, calls = []
globalThis.fetch = async (url, options) => {
  const target = String(url)
  if (target.startsWith('http://127.0.0.1:')) return realFetch(url, options)
  if (target === 'https://auth-scripted.invalid/auth/v1/user') {
    const id = ({ 'Bearer SCRIPTED-A': A, 'Bearer SCRIPTED-B': B, 'Bearer SCRIPTED-C': C })[options.headers.authorization]
    calls.push({ op: 'SCRIPTED-auth', id })
    return id ? Response.json({ id, user_metadata: { username: 'SCRIPTED-tester' } }) : new Response(null, { status: 401 })
  }
  assert.equal(target, 'https://edge-scripted.invalid', 'no real or unexpected network target')
  const body = JSON.parse(options.body); calls.push(body)
  assert.equal(body.op, 'eco_combatants', 'read facade never sends persistent operations')
  const species = body.userId === A ? 25 : 43
  assert.ok([A, B].includes(body.userId))
  const rows = body.slotPokemonId === null || body.slotPokemonId === species ? [{
    slot: { pokemon_id: species, owner_id: body.userId, is_locked: false, first_owner_id: body.userId, owned_since: null },
    progression: { user_id: body.userId, pokemon_id: species, xp: 4356, level: 12, moves: species === 25 ? ['thunder-shock', 'quick-attack'] : ['absorb'] },
  }] : []
  return Response.json({ rows })
}
delete globalThis.WebSocket // existing SDK ws fallback explicitly supplies Origin
const { Client } = await import('@colyseus/sdk')
const { startRealtimeServer } = await import('./realtimeServer.js')
const { WORLD_PROTOCOL, ECO_PROTOCOL, ECO_COMBATANT_PROTOCOL, WORLD_MESSAGE: M } = await import('./world/worldProtocol.js')
const { PresenceRoom } = await import('./rooms/PresenceRoom.js')
let started
const clients = []
test.after(async () => {
  await started?.gameServer.gracefullyShutdown(false)
  await started?.health.close()
  globalThis.fetch = realFetch
})
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check) {
  const deadline = Date.now() + 3_000
  while (!check() && Date.now() < deadline) await wait(15)
  assert.ok(check(), 'SCRIPTED loopback condition reached')
}

test('SCRIPTED loopback: authenticated admission, owned privacy/read-only messages and automatic expiry of two idle sockets', async () => {
  started = await startRealtimeServer({ port: 0, healthPort: 0, hostname: '127.0.0.1', log: () => {} })
  assert.equal(started.host, null, 'no presence host acquired')
  assert.equal(started.health.server.address().address, '127.0.0.1')
  const port = started.gameServer.transport.server.address().port
  assert.equal(started.gameServer.transport.server.address().address, '127.0.0.1')
  const join = (token, extra = {}, origin = ORIGIN) => new Client(`ws://127.0.0.1:${port}`, { headers: { Origin: origin } }).joinOrCreate('presence', {
    token, presenceProtocol: 3, worldProtocol: WORLD_PROTOCOL, ecoProtocol: ECO_PROTOCOL, ecoCombatantProtocol: ECO_COMBATANT_PROTOCOL, ...extra,
  })
  assert.equal((await fetch(`http://127.0.0.1:${started.health.port}/readyz`)).status, 200)
  for (const origin of [null, 'https://pokeswap.lol']) {
    const status = await new Promise((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, path: '/forged/forged?sessionId=forged', headers: {
        connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': Buffer.alloc(16).toString('base64'), ...(origin ? { origin } : {}),
      } }, res => { res.resume(); resolve(res.statusCode) })
      req.on('error', reject); req.on('upgrade', (_res, socket) => { socket.destroy(); reject(new Error('unexpected upgrade')) }); req.end()
    })
    assert.equal(status, 403, 'WS upgrade refuses missing/public Origin before room lookup')
  }
  for (const [token, extra, origin] of [[null, { userId: A }], ['SCRIPTED-invalid', {}], ['SCRIPTED-C', { userId: A }], ['SCRIPTED-A', { benchmark: { id: 'forged' } }], ['SCRIPTED-A', {}, 'https://pokeswap.lol'], ['SCRIPTED-A', {}, 'null']]) {
    await assert.rejects(join(token, extra, origin), { code: 403 })
  }
  assert.equal(PresenceRoom.connections, 0)
  assert.equal(calls.filter(c => c.op === 'eco_combatants').length, 0, 'denied matchmaking creates no owned reads')
  const seen = []
  for (const [token, id, species] of [['SCRIPTED-A', A, 25], ['SCRIPTED-B', B, 43]]) {
    const r = await join(token); clients.push(r); r.reconnection.enabled = false
    const messages = [], state = { snapshot: null, code: null, messages }
    r.onMessage('*', (type, payload) => { messages.push({ type, payload }); if (type === 'presence:snapshot') state.snapshot = payload })
    r.onLeave(code => { state.code = code })
    r.send('presence:ready'); await until(() => state.snapshot)
    assert.equal(state.snapshot.access, 'player'); assert.equal(state.snapshot.self.id, id)
    r.send(M.ECO_COMBATANT_SELECT, { requestId: 1, slotPokemonId: species })
    await until(() => messages.some(m => m.type === M.ECO_COMBATANT_STATE && m.payload.requestId === 1))
    assert.equal(messages.find(m => m.type === M.ECO_COMBATANT_STATE && m.payload.requestId === 1).payload.speciesId, species)
    r.send(M.WORK, { requestId: 2, nodeId: 'forged', pokemonInstanceId: species })
    r.send(M.ECO_DEV_RETIRE, { requestId: 3, encounterId: 'forged' })
    await until(() => messages.some(m => m.type === M.ECO_DEV_RETIRE_RESULT))
    assert.equal(messages.find(m => m.type === M.WORK_RESULT).payload.reason, 'disabled')
    assert.equal(messages.find(m => m.type === M.ECO_DEV_RETIRE_RESULT).payload.reason, 'disabled')
    seen.push(state)
  }
  await wait(Math.max(0, Date.parse(process.env.WORLD_ECO_EXPIRES_AT) - Date.now()) + 100)
  await until(() => seen.every(s => s.code === 4408))
  await until(() => PresenceRoom.connections === 0)
  await assert.rejects(join('SCRIPTED-A'), { code: 410 })
  assert.equal((await fetch(`http://127.0.0.1:${started.health.port}/readyz`)).status, 503)
  for (const [index, s] of seen.entries()) {
    for (const m of s.messages.filter(m => m.type === M.ECO_COMBATANT_STATE)) {
      assert.ok(m.payload.options.every(o => o.speciesId === (index === 0 ? 25 : 43)), 'owned data is private')
    }
  }
  assert.ok(calls.some(c => c.op === 'eco_combatants'))
  assert.ok(calls.every(c => ['SCRIPTED-auth', 'eco_combatants'].includes(c.op)))
})
