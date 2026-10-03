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

  // A guest joins and gets a snapshot (the room accepts once active).
  const guest = await new Client(`ws://127.0.0.1:${PORT}`, ORIGIN).joinOrCreate('presence', { token: null, presenceProtocol: 2 })
  guest.reconnection.enabled = false
  let snapshot = null
  guest.onMessage('presence:snapshot', s => { snapshot = s })
  guest.onMessage('*', () => {})
  guest.send('presence:ready')
  for (let i = 0; i < 100 && !snapshot; i++) await wait(20)
  assert.ok(snapshot, 'the guest was served')
  await guest.leave()

  await gameServer.gracefullyShutdown(false)
  assert.equal(host.state, 'stopped', 'onShutdown stops the host (terminal)')
  started.health.close()
  started = null
})
