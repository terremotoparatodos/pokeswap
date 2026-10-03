import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createEdgePlayerData } from './playerData.js'
import { LocationJournal } from '../../presence/locationJournal.js'
import { HostLifecycle } from '../../presence/hostLifecycle.js'
import { ARRIVALS } from '../../protocol/arrival.js'
import { MESSAGE } from '../../protocol/messages.js'
import { createDemoSkillPolicy } from '../demoSkillPolicy.js'
import { layoutVersion } from '../layoutVersion.js'
import { portalTo } from '../navigation.js'
import { createStaticOwnership } from '../pokemonOwnership.js'
import { lastMessage, routeBetween, settle } from '../testing.js'
import { WORLD_PROTOCOL } from '../worldProtocol.js'

// WORLD LOCATION-2 staging gate, against a REAL local Supabase stack
// (Postgres, PostgREST, Auth, Edge Runtime) with the new migration applied and
// the world-authority function served locally (see scripts/integration/
// rc03-staging/README.md; the location migration runs after multi-yield).
//
// LOCAL STACK ONLY: it creates users and refuses any URL that is not
// 127.0.0.1/localhost. Same variables as staging.test.js:
//   RC03_SUPABASE_URL RC03_ANON_KEY RC03_SERVICE_KEY RC03_AUTHORITY_SECRET
// Without them every test here is skipped.
//
// Matrix cases (WORLD_LOCATION_1_AUDIT §7): 1, 3, 5, 11, 14, 15, 16, 27, plus
// real concurrency (claims and crossing batches) and two room instances over
// the real Edge path.
//
// WORLD LOCATION-4: keyed claims through presence hosts (acquired and activated on the stack),
// plus Q6 — real concurrency on Postgres that PGlite cannot run: concurrent activations of two
// candidates, concurrent claims with distinct keys and with one key.

const env = process.env
const BASE = env.RC03_SUPABASE_URL ?? ''
const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)
const skip = LOCAL && env.RC03_ANON_KEY && env.RC03_SERVICE_KEY && env.RC03_AUTHORITY_SECRET
  ? false : 'WORLD LOCATION-2 staging: needs a LOCAL Supabase stack (RC03_* variables)'
const ANON = env.RC03_ANON_KEY
const SERVICE = env.RC03_SERVICE_KEY
const FUNCTION_URL = `${BASE}/functions/v1/world-authority`
const DEAD_URL = 'http://127.0.0.1:9/functions/v1/world-authority' // nothing listens: refused at once

async function http(path, { method = 'GET', key = ANON, jwt = null, body, prefer } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { apikey: key, authorization: `Bearer ${jwt ?? key}`, 'content-type': 'application/json', ...(prefer ? { prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: response.status, body: json, text }
}
const asService = (path, options = {}) => http(path, { ...options, key: SERVICE })
const denied = status => status === 401 || status === 403 || status === 404
const edge = (overrides = {}) => createEdgePlayerData({ url: FUNCTION_URL, secret: env.RC03_AUTHORITY_SECRET, publishableKey: ANON, ...overrides })
/** A presence host on the stack, acquired and activated now (newer than every earlier one). */
async function activeHost(data = edge()) {
  const host = new HostLifecycle({ store: data, renewMs: 600_000, log: () => {} })
  await host.acquire()
  assert.equal(await host.activate(), 'active')
  return host
}
let shared = null
/** What a new session does: claim once with its key (WORLD LOCATION-4). */
async function claim(userId, data = edge()) {
  shared ??= await activeHost()
  return data.locationClaim(userId, shared.sessionKey())
}

async function user() {
  const email = `wloc2-${randomUUID().slice(0, 8)}@example.test`
  const password = `pw-${randomUUID()}`
  const created = await asService('/auth/v1/admin/users', { method: 'POST', body: { email, password, email_confirm: true } })
  assert.equal(created.status, 200, created.text)
  const session = await http('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } })
  assert.equal(session.status, 200, session.text)
  return { id: created.body.id, jwt: session.body.access_token }
}

async function stored(userId) {
  const { status, body, text } = await asService(`/rest/v1/world_player_locations?select=area_id,tx,ty,layout_version,epoch,seq&user_id=eq.${userId}`)
  assert.equal(status, 200, text)
  return body[0] ?? null
}

const row = (userId, epoch, seq, extra = {}) => ({ userId, epoch, seq, areaId: 'pradera', tx: 1, ty: -60, layoutVersion: layoutVersion('pradera'), ...extra })

// ── Trust boundary (case 11) ───────────────────────────────────────────────

test('clients (anon and a signed-in player) cannot read, write or call anything of the location store', { skip }, async () => {
  const a = await user()
  const b = await user()
  await claim(b.id)
  await edge().locationSave([row(b.id, 1, 1)], shared.identity)
  for (const [who, jwt] of [['anon', null], ['authenticated', a.jwt], ['the owner', b.jwt]]) {
    const read = await http(`/rest/v1/world_player_locations?select=*`, { jwt })
    assert.ok(denied(read.status) || (read.status === 200 && read.body.length === 0), `${who} SELECT → ${read.status} ${read.text}`)
    const insert = await http('/rest/v1/world_player_locations', { method: 'POST', jwt, body: { user_id: a.id } })
    assert.ok(denied(insert.status), `${who} INSERT → ${insert.status}`)
    await http(`/rest/v1/world_player_locations?user_id=eq.${b.id}`, { method: 'PATCH', jwt, body: { tx: 99 } })
    await http(`/rest/v1/world_player_locations?user_id=eq.${b.id}`, { method: 'DELETE', jwt })
    const H = randomUUID()
    for (const [fn, args] of [
      ['world_location_claim', { p_user_id: b.id, p_expected_epoch: 1 }], ['world_location_save', { p_rows: [row(b.id, 9, 9)] }],
      ['world_location_claim_keyed', { p_user_id: b.id, p_generation: 1, p_seq: 1, p_session: randomUUID(), p_host_id: H }],
      ['world_location_save_keyed', { p_rows: [row(b.id, 9, 9)], p_generation: 1, p_host_id: H }],
      ['world_presence_acquire', { p_host_id: H, p_lease_ms: 15000 }], ['world_presence_activate', { p_generation: 1, p_host_id: H, p_lease_ms: 15000 }],
      ['world_presence_renew', { p_generation: 1, p_host_id: H, p_lease_ms: 15000 }], ['world_presence_drain', { p_generation: 1, p_host_id: H, p_drain_ms: 10000 }],
      ['world_presence_stop', { p_generation: 1, p_host_id: H }],
    ]) {
      const call = await http(`/rest/v1/rpc/${fn}`, { method: 'POST', jwt, body: args })
      assert.ok(denied(call.status), `${who} ${fn} → ${call.status} ${call.text}`)
      assert.equal(call.body?.code, '42501', `${who} ${fn}: refused by the ACL`)
    }
  }
  for (const [who, jwt] of [['anon', null], ['authenticated', a.jwt]]) {
    const hosts = await http('/rest/v1/world_presence_hosts?select=*', { jwt })
    assert.ok(denied(hosts.status) || (hosts.status === 200 && hosts.body.length === 0), `${who} hosts SELECT → ${hosts.status}`)
    const insert = await http('/rest/v1/world_presence_hosts', { method: 'POST', jwt, body: { host_id: randomUUID(), lease_expires_at: new Date().toISOString() } })
    assert.ok(denied(insert.status), `${who} hosts INSERT → ${insert.status}`)
  }
  assert.deepEqual(await stored(b.id), { area_id: 'pradera', tx: 1, ty: -60, layout_version: layoutVersion('pradera'), epoch: 1, seq: 1 }, 'untouched')
})

test('world-authority: location operations need the secret; a malformed batch never reaches the database', { skip }, async () => {
  const a = await user()
  shared ??= await activeHost()
  await assert.rejects(edge({ secret: 'w'.repeat(48) }).locationClaim(a.id, shared.sessionKey()), /401/)
  assert.equal(await stored(a.id), null)
  await claim(a.id)
  await assert.rejects(edge().locationSave([row(a.id, 1, 1, { tx: 0.5 })], shared.identity), /400/)
  await assert.rejects(edge().locationSave([row(a.id, 1, 1, { areaId: 'dg:x:1' })], shared.identity), /400/)
  assert.equal((await stored(a.id)).seq, 0)
})

// ── CAS on real Postgres ───────────────────────────────────────────────────

test('Q6: 20 concurrent claims with distinct keys: the greatest key owns the row, whatever order they commit in', { skip }, async () => {
  const a = await user()
  const host = await activeHost()
  const keys = Array.from({ length: 20 }, () => host.sessionKey())
  const answers = await Promise.all([...keys].reverse().map(key => edge().locationClaim(a.id, key)))
  assert.ok(answers.every(c => c.status === 'claimed' || c.status === 'superseded'))
  const owner = await asService(`/rest/v1/world_player_locations?select=owner_generation,owner_seq,epoch&user_id=eq.${a.id}`)
  assert.equal(owner.body[0].owner_seq, keys.at(-1).seq, 'the greatest key')
  assert.deepEqual(await edge().locationClaim(a.id, keys[0]), { status: 'superseded', newerActive: false }, 'a smaller key, later: final')
})

test('Q6: 20 concurrent claims with ONE key (retries of one session): one epoch bump, everyone adopts the same epoch', { skip }, async () => {
  const a = await user()
  const host = await activeHost()
  const key = host.sessionKey()
  const answers = await Promise.all(Array.from({ length: 20 }, () => edge().locationClaim(a.id, key)))
  assert.ok(answers.every(c => c.status === 'claimed'))
  assert.equal(new Set(answers.map(c => c.epoch)).size, 1)
  assert.equal((await stored(a.id)).epoch, answers[0].epoch)
  const results = await Promise.all([answers[0].epoch, answers[0].epoch + 1].map(epoch => edge().locationSave([row(a.id, epoch, 1, { tx: epoch })], host.identity)))
  assert.deepEqual(results.map(r => r.results.get(a.id)), ['applied', 'stale'])
})

test('Q6: two candidates activating at once: never two activations with the older after the newer; the older learns', { skip }, async () => {
  for (let round = 0; round < 10; round++) {
    const data = edge()
    const older = new HostLifecycle({ store: data, renewMs: 600_000, log: () => {} })
    const newer = new HostLifecycle({ store: data, renewMs: 600_000, log: () => {} })
    await older.acquire(); await newer.acquire()
    const [o, n] = await Promise.all([data.presenceActivate(older.generation, older.hostId, 15_000), data.presenceActivate(newer.generation, newer.hostId, 15_000)])
    assert.equal(n.status, 'active', 'the newer candidate is never refused')
    assert.ok(o.status === 'active' || o.status === 'newer_active', JSON.stringify(o))
    if (o.status === 'active') assert.equal((await data.presenceRenew(older.generation, older.hostId, 15_000)).newerActive, true, 'it learns at its next renew')
    await data.presenceStop(older.generation, older.hostId); await data.presenceStop(newer.generation, newer.hostId)
  }
})

test('Q6: a claim racing a drain of its host either lands before the drain or is refused; never after it', { skip }, async () => {
  const a = await user()
  for (let round = 0; round < 10; round++) {
    const data = edge()
    const host = await activeHost(data)
    const key = host.sessionKey()
    const [claimed, drained] = await Promise.all([data.locationClaim(a.id, key), data.presenceDrain(host.generation, host.hostId, 10_000)])
    assert.equal(drained.state, 'draining')
    assert.ok(claimed.status === 'claimed' || (claimed.status === 'host_inactive' && claimed.state === 'draining'), JSON.stringify(claimed))
    await data.presenceStop(host.generation, host.hostId)
  }
})

test('T4 on real Postgres: a claim of an older session given up by the realtime that lands late never fences the live one', { skip }, async () => {
  const a = await user()
  const host = await activeHost()
  const abandoned = host.sessionKey() // accepted first; its claim was given up before reaching the database
  const journal = new LocationJournal({ store: edge(), host, locate: actor => ({ ...actor, layoutVersion: layoutVersion(actor.areaId) }), log: () => {} })
  const s = journal.beginSession(a.id, host.sessionKey()); await journal.claim(s)
  assert.equal(s.epoch, 1)
  assert.deepEqual(await edge().locationClaim(a.id, abandoned), { status: 'superseded', newerActive: false })
  journal.note(s, { areaId: 'pradera', tx: 4, ty: -60 }, { urgent: true }); journal.tick(); await journal.idle()
  assert.deepEqual({ tx: (await stored(a.id)).tx, epoch: (await stored(a.id)).epoch }, { tx: 4, epoch: 1 })
  assert.equal(journal.stats().fenced, 0)
})

test('two overlapping batches written at once, in opposite orders, never deadlock and answer per user', { skip }, async () => {
  const players = await Promise.all(Array.from({ length: 40 }, () => user()))
  for (const p of players) await claim(p.id)
  const forward = players.map(p => row(p.id, 1, 1, { tx: 1 }))
  const backward = [...players].reverse().map(p => row(p.id, 1, 2, { tx: 2 }))
  const [first, second] = await Promise.all([edge().locationSave(forward, shared.identity), edge().locationSave(backward, shared.identity)])
  for (const p of players) {
    assert.ok(['applied', 'duplicate'].includes(first.results.get(p.id)))
    assert.equal(second.results.get(p.id), 'applied', 'seq 2 always wins over seq 1')
    assert.equal((await stored(p.id)).tx, 2)
  }
})

test('two instances (two journals over the real Edge path): the newer claim fences the older writer (case 5)', { skip }, async () => {
  const a = await user()
  const fenced = []
  const make = async name => {
    const host = await activeHost()
    const journal = new LocationJournal({ store: edge(), host, locate: actor => ({ ...actor, layoutVersion: layoutVersion(actor.areaId) }), log: () => {}, onFenced: (u, e) => fenced.push({ name, epoch: e }) })
    journal.begin = userId => journal.beginSession(userId, host.sessionKey())
    return journal
  }
  const old = await make('old'), next = await make('new')
  const s1 = old.begin(a.id); await old.claim(s1)
  old.note(s1, { areaId: 'pradera', tx: 2, ty: -60 }, { urgent: true }); old.tick(); await old.idle()
  const s2 = next.begin(a.id); await next.claim(s2)
  old.note(s1, { areaId: 'pradera', tx: 3, ty: -60 }, { urgent: true }); old.tick(); await old.idle()
  assert.deepEqual(fenced, [{ name: 'old', epoch: 1 }])
  assert.equal((await stored(a.id)).tx, 2)
  next.note(s2, { areaId: 'ciudad-corazon', tx: 31, ty: 21 }, { urgent: true }); next.tick(); await next.idle()
  assert.deepEqual(await stored(a.id), { area_id: 'ciudad-corazon', tx: 31, ty: 21, layout_version: layoutVersion('ciudad-corazon'), epoch: 2, seq: 1 })
})

test('authority down while saving, then back: the same row applies once, with no duplicate (case 15)', { skip }, async () => {
  const a = await user()
  let current = edge({ url: DEAD_URL })
  const store = { locationClaim: (id, key) => edge().locationClaim(id, key), locationSave: (rows, host) => current.locationSave(rows, host) }
  let now = 1_000_000
  const host = await activeHost()
  const journal = new LocationJournal({ store, host, locate: actor => ({ ...actor, layoutVersion: layoutVersion(actor.areaId) }), now: () => now, log: () => {} })
  const s = journal.beginSession(a.id, host.sessionKey()); await journal.claim(s)
  journal.note(s, { areaId: 'pradera', tx: 5, ty: -60 }, { urgent: true })
  journal.tick(); await journal.idle()
  assert.equal(journal.stats().saves.failedBatches, 1)
  current = edge()
  now += 1_000; journal.tick(); await journal.idle()
  assert.deepEqual({ tx: (await stored(a.id)).tx, seq: (await stored(a.id)).seq }, { tx: 5, seq: 1 })
  assert.equal(journal.stats().pending, 0)
})

test('deleting the auth user deletes its location row (case 27)', { skip }, async () => {
  const a = await user()
  await claim(a.id)
  const removed = await asService(`/auth/v1/admin/users/${a.id}`, { method: 'DELETE' })
  assert.ok(removed.status < 300, removed.text)
  assert.equal(await stored(a.id), null)
  assert.deepEqual(await edge().locationClaim(a.id, shared.sessionKey()), { status: 'unknown_user' })
})

// ── Room instances over the real Edge path (cases 1, 3, 14, 16) ────────────

async function roomOn(t, name, store, { hydrationTimeoutMs = 1_500 } = {}) {
  const module = await import(new URL(`../../rooms/PresenceRoom.js?staging=${name}`, import.meta.url).href)
  module.configureWorld({ skills: createDemoSkillPolicy({ durationMs: 3_000 }), ownership: createStaticOwnership({}) })
  const host = await activeHost()
  module.configurePresenceHost(host)
  const service = module.configureLocationPersistence({ mode: 'on', store, host, hydrationTimeoutMs })
  service.journal.stop()
  const room = new module.PresenceRoom()
  room.onCreate()
  const sockets = []
  t.after(() => { for (const c of sockets) room.onLeave(c); room.setSimulationInterval(null); room.clock.clear(); module.configureLocationPersistence({ mode: 'off' }); module.configurePresenceHost(null); void host.stop() })
  const join = async userId => {
    const messages = [], leaves = []
    const c = { sessionId: `${name}-${sockets.length}`, userData: undefined, messages, leaves, send: (type, payload) => messages.push({ type, payload }), leave: (code, reason) => leaves.push([code, reason]) }
    sockets.push(c)
    await room.onJoin(c, { worldProtocol: WORLD_PROTOCOL, presenceProtocol: 2 }, { kind: 'player', userId, username: 'S', token: null })
    room.ready(c)
    const started = Date.now()
    while (!lastMessage(c, MESSAGE.SNAPSHOT)?.self) { if (Date.now() - started > 5_000) throw new Error('not placed'); await new Promise(r => setTimeout(r, 10)) }
    return c
  }
  const self = c => { const e = [...c.messages].reverse().find(m => m.type === MESSAGE.SELF || (m.type === MESSAGE.SNAPSHOT && m.payload.self)); return e.type === MESSAGE.SELF ? e.payload : e.payload.self }
  let seq = 0
  const walk = (c, to) => { const at = self(c); for (const direction of routeBetween(at.areaId, at, to)) { const realNow = Date.now; let fake = realNow() + (++seq) * 300; Date.now = () => fake; try { room.move(c, { direction, running: false, sequence: self(c).moveSequence + 1 }) } finally { Date.now = realNow } } }
  const cross = (c, to) => { walk(c, portalTo(self(c).areaId, to)); room.changeArea(c, { areaId: to }); assert.equal(self(c).areaId, to) }
  const flush = async () => { service.journal.tick(); await service.journal.idle(); await settle() }
  return { module, room, service, join, self, cross, flush }
}

test('rooms over the real Edge path: restore after a restart, and two instances fence with 4001 (cases 1, 3, 5, 16)', { skip }, async t => {
  const a = await user()
  const one = await roomOn(t, 'one', edge())
  const first = await one.join(a.id)
  assert.equal(one.self(first).areaId, 'ciudad-corazon')
  one.cross(first, 'pradera')
  await one.flush()
  assert.equal((await stored(a.id)).area_id, 'pradera')
  // A second instance (a deploy): the player's new socket lands there.
  const two = await roomOn(t, 'two', edge())
  const second = await two.join(a.id)
  assert.deepEqual({ areaId: two.self(second).areaId, tx: two.self(second).tx, ty: two.self(second).ty }, { areaId: 'pradera', tx: ARRIVALS.pradera.tx, ty: ARRIVALS.pradera.ty })
  // The old instance still writes (it has not noticed): stale → its socket is closed with 4001 session-replaced.
  one.cross(first, 'ciudad-corazon')
  await one.flush()
  assert.deepEqual(first.leaves, [[4001, 'session-replaced']])
  assert.equal((await stored(a.id)).area_id, 'pradera', 'the old instance changed nothing')
  assert.deepEqual(second.leaves, [])
})

test('authority down at join: the player enters in < 1.6 s at Ciudad, unclaimed, then claims when it is back (case 14)', { skip }, async t => {
  const a = await user()
  await claim(a.id)
  await edge().locationSave([row(a.id, 1, 1, { areaId: 'pradera', tx: ARRIVALS.pradera.tx, ty: ARRIVALS.pradera.ty })], shared.identity)
  let current = edge({ url: DEAD_URL })
  const store = { locationClaim: (id, key) => current.locationClaim(id, key), locationSave: (rows, host) => current.locationSave(rows, host) }
  const r = await roomOn(t, 'down', store)
  const started = performance.now()
  const c = await r.join(a.id)
  assert.ok(performance.now() - started < 1_600, `entered in ${Math.round(performance.now() - started)} ms`)
  assert.equal(r.self(c).areaId, 'ciudad-corazon')
  current = edge()
  for (let i = 0; i < 40 && r.service.journal.stats().sessions.live.claimed === 0; i++) { r.service.journal.tick(Date.now() + 2_000 * (i + 1)); await new Promise(res => setTimeout(res, 50)) }
  assert.equal(r.service.journal.stats().sessions.live.claimed, 1)
  assert.equal((await stored(a.id)).epoch, 2)
})
