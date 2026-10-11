import test from 'node:test'
import assert from 'node:assert/strict'
import { LimitedAdmission } from './limitedAdmission.js'
import { limitedPresenceRoom } from '../rooms/limitedPresenceRoom.js'
import { limitedRelease } from './limitedRelease.js'
import { originPolicy, allowedOrigins } from './originPolicy.js'

const A = '11111111-1111-4111-8111-111111111111'
const config = { testerIds: [A], origins: ['https://eco-scripted.invalid'], expiresAt: 1_000 }
const player = { kind: 'player', userId: A }
const ORIGIN = config.origins[0]

test('only authenticated operator UUIDs enter; Origin and protocol declarations cannot grant access', () => {
  const admission = new LimitedAdmission(config, { now: () => 0 })
  admission.assert(player, {}, ORIGIN)
  for (const auth of [null, { kind: 'guest' }, { kind: 'player', userId: 'benchmark-one' }, { kind: 'player', userId: '22222222-2222-4222-8222-222222222222' }]) {
    assert.throws(() => admission.assert(auth, { userId: A, ecoProtocol: 1, worldProtocol: 3 }, ORIGIN), { code: 4403 })
  }
  for (const origin of [null, 'https://pokeswap.lol', 'https://www.pokeswap.lol', 'http://localhost:5173']) {
    assert.throws(() => admission.assert(player, {}, origin), { code: 4403 })
  }
  for (const benchmark of [null, {}, { id: 'one' }]) assert.throws(() => admission.assert(player, { benchmark }, ORIGIN), { code: 4403 })
})

test('expiry closes existing sockets, blocks admissions, latches closed and cancels timers', () => {
  let now = 0, callback, cleared = 0
  const admission = new LimitedAdmission(config, { now: () => now, set: fn => { callback = fn; return 1 }, clear: () => cleared++ })
  const closes = [], client = { leave: code => closes.push(code) }
  admission.track(client); now = 1_000; callback()
  assert.deepEqual(closes, [4408])
  assert.equal(admission.clients.size, 0)
  assert.throws(() => admission.assert(player, {}, ORIGIN), { code: 4408 })
  now = 0; assert.throws(() => admission.assert(player, {}, ORIGIN), { code: 4408 })
  admission.closeExpired(); assert.deepEqual(closes, [4408])
  const open = new LimitedAdmission(config, { now: () => 0, set: () => 2, clear: () => cleared++ })
  open.track(client); open.untrack(client); assert.equal(cleared, 1)
})

test('expiry is rechecked after slow Auth; a late answer creates no authenticated seat', async () => {
  let now = 0, resolve
  const admission = new LimitedAdmission(config, { now: () => now })
  const original = globalThis.fetch
  globalThis.fetch = () => new Promise(done => { resolve = done })
  try {
    const Room = limitedPresenceRoom(class {}, admission, { SUPABASE_URL: 'https://auth-scripted.invalid', SUPABASE_PUBLISHABLE_KEY: 'SCRIPTED' })
    const result = Room.onAuth(null, { token: 'SCRIPTED-token' }, { headers: new Headers({ origin: ORIGIN }) })
    now = 1_000; resolve(Response.json({ id: A, user_metadata: { username: 'SCRIPTED' } }))
    await assert.rejects(result, { code: 410 })
  } finally { globalThis.fetch = original }
})

test('limited origins are exclusive; normal production origin assertions still hold', () => {
  const env = { NODE_ENV: 'production', WORLD_ECO_RELEASE: 'limited', WORLD_ECO_EXPERIMENT: 'on', WORLD_ECO_COMBATANT_MODE: 'owned',
    WORLD_ECO_TESTER_IDS: A, WORLD_ECO_EXPIRES_AT: new Date(Date.now() + 60_000).toISOString(), ALLOWED_ORIGINS: ORIGIN,
    SUPABASE_URL: 'https://auth-scripted.invalid', SUPABASE_PUBLISHABLE_KEY: 'SCRIPTED',
    WORLD_AUTHORITY_URL: 'https://edge-scripted.invalid', WORLD_AUTHORITY_SECRET: 'SCRIPTED-only-'.repeat(4) }
  assert.ok(limitedRelease(env))
  assert.deepEqual([...allowedOrigins(env)], [ORIGIN])
  assert.equal(originPolicy(env)(new Request('https://realtime-scripted.invalid', { headers: { origin: 'https://pokeswap.lol' } })).status, 403)
  assert.equal(originPolicy(env)(new Request('https://realtime-scripted.invalid', { headers: { origin: ORIGIN } })), undefined)
  assert.ok(allowedOrigins({ NODE_ENV: 'production' }).has('https://pokeswap.lol'))
})

test('private Auth envelope survives Colyseus serialization and rejects tampering before join', async () => {
  const admission = new LimitedAdmission(config, { now: () => 0 })
  const original = globalThis.fetch
  globalThis.fetch = async () => Response.json({ id: A, user_metadata: { username: 'SCRIPTED' } })
  try {
    const Room = limitedPresenceRoom(class {}, admission, { SUPABASE_URL: 'https://auth-scripted.invalid', SUPABASE_PUBLISHABLE_KEY: 'SCRIPTED' })
    const auth = JSON.parse(JSON.stringify(await Room.onAuth(null, { token: 'SCRIPTED-token' }, { headers: new Headers({ origin: ORIGIN }) })))
    new Room().assertAdmission(null, {}, auth)
    for (const [field, value] of [['userId', '22222222-2222-4222-8222-222222222222'], ['token', 'forged'], ['kind', 'guest'], ['username', 'forged'], ['limitedOrigin', 'https://pokeswap.lol'], ['limitedProof', 'bad']]) {
      assert.throws(() => new Room().assertAdmission(null, {}, { ...auth, [field]: value }), { code: 4403 })
    }
    assert.throws(() => new Room().assertAdmission(null, {}, { kind: 'player', userId: A }), { code: 4403 })
  } finally { globalThis.fetch = original }
})
