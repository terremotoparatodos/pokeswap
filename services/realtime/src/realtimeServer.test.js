import test from 'node:test'
import assert from 'node:assert/strict'

// WORLD LOCATION-4: the real process bootstrap, in-process, on the local stack (PGlite running
// the real migrations): acquire before listen, activate after, a real SDK client, graceful
// shutdown. The env must be set before the room module is imported (it reads it once).
process.env.NODE_ENV = 'development'
process.env.WORLD_PLAYERDATA = 'pglite'
process.env.WORLD_WILD_CATALOG = 'synthetic'
process.env.WORLD_LOCATION_PERSISTENCE = 'shadow'
process.env.ALLOWED_ORIGINS = 'http://127.0.0.1:5173'
process.env.SUPABASE_URL = 'http://127.0.0.1:9'
process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable'

delete globalThis.WebSocket // the SDK's `ws` fallback sends the Origin header
const { Client } = await import('@colyseus/sdk')
const { startRealtimeServer } = await import('./realtimeServer.js')
const room = await import('./rooms/PresenceRoom.js')

const PORT = 2600 + Math.floor(Math.random() * 300)
const ORIGIN = { headers: { Origin: 'http://127.0.0.1:5173' } }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

let started = null
test.after(async () => {
  await started?.gameServer.gracefullyShutdown(false).catch(() => {})
  started?.health.close()
})

test('bootstrap: the host acquires before listen (starting), activates after listen, serves, and stops on shutdown', async () => {
  const order = []
  started = await startRealtimeServer({ port: PORT, healthPort: PORT + 1, log: () => {}, trace: (event, state) => order.push(`${event}:${state}`) })
  const { host, gameServer } = started
  assert.ok(host, 'shadow with a store that supports it: this process is a presence host')
  assert.equal(host.state, 'active')
  assert.ok(Number.isSafeInteger(host.generation))
  assert.equal(host.stats().activation, 'active')
  assert.deepEqual(order, ['acquired:starting', 'listening:starting', 'activated:active'], 'a generation before listen; active only after it')
  assert.equal(typeof room.configurePresenceHost, 'function')

  // /readyz follows the host.
  const ready = await fetch(`http://127.0.0.1:${PORT + 1}/readyz`)
  assert.equal(ready.status, 200)

  // Two guests join and get a snapshot (the room accepts once active): one of today's clients
  // (presenceProtocol 2) and one that speaks the WORLD LOCATION-4 close codes (3).
  const guests = []
  for (const presenceProtocol of [2, 3]) {
    const room = await new Client(`ws://127.0.0.1:${PORT}`, ORIGIN).joinOrCreate('presence', { token: null, presenceProtocol, tabId: `tab-guest-${presenceProtocol}000` })
    room.reconnection.enabled = false
    const seen = { protocol: presenceProtocol, snapshot: null, closing: [], code: null, order: [] }
    room.onMessage('presence:snapshot', s => { seen.snapshot = s })
    room.onMessage('presence:closing', m => { seen.closing.push(m.reason); seen.order.push('closing') })
    room.onMessage('*', () => {})
    room.onLeave(code => { seen.code = code; seen.order.push('close') })
    room.send('presence:ready')
    guests.push(seen)
  }
  for (let i = 0; i < 100 && guests.some(g => !g.snapshot); i++) await wait(20)
  assert.ok(guests.every(g => g.snapshot), 'both guests were served')
  assert.equal(guests[1].snapshot.presenceProtocol, 3)

  // C11: a graceful shutdown (deploy, restart) closes every socket with 4503, never with
  // Colyseus' default 4001 (which clients read as "replaced" and stop); `presence:closing`
  // reaches only the protocol-3 client, before its close. A join that arrives while the
  // process drains is refused with 4503 too (it reconnects to the next host).
  // The drain is slowed (an authority that takes 300 ms to answer), so the join below lands
  // while the process drains: Colyseus keeps the transport open during onBeforeShutdown.
  const drain = host.drain.bind(host)
  host.drain = async () => { await wait(300); return drain() }
  const shutting = gameServer.gracefullyShutdown(false)
  await wait(20)
  const joiner = await new Client(`ws://127.0.0.1:${PORT}`, ORIGIN).joinOrCreate('presence', { token: null, presenceProtocol: 3, tabId: 'tab-joiner-0000' })
    .then(late => ({ joined: true, room: late }), error => ({ joined: false, code: error?.code }))
  await shutting
  assert.deepEqual(joiner, { joined: false, code: 4503 }, 'a join during the shutdown is refused with 4503, never 4001')
  for (let i = 0; i < 100 && guests.some(g => g.code === null); i++) await wait(20)
  assert.deepEqual(guests.map(g => g.code), [4503, 4503], 'every client reconnects: 4503 host-draining, never 4001')
  assert.deepEqual(guests[0].closing, [])
  assert.deepEqual(guests[1].order, ['closing', 'close'])
  assert.deepEqual(guests[1].closing, ['draining'])
  assert.equal(host.state, 'stopped', 'onShutdown stops the host (terminal)')
  started.health.close()
  started = null
})
