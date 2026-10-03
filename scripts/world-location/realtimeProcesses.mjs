// WORLD LOCATION-2/4 — real realtime PROCESSES and real @colyseus/sdk sockets for the local
// harnesses (two-instances.mjs, ordering-harness.mjs). LOCAL ONLY.
//
// The processes run the unmodified entry point of the tree under test
// (services/realtime/src/index.js) in development mode. Sockets authenticate like a
// browser: an allowed Origin header and a token the local authority knows (no benchmark
// identities, which never persist and never run a presence host).

import { spawn } from 'node:child_process'
import net from 'node:net'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(new URL('../..', import.meta.url))
const preload = pathToFileURL(fileURLToPath(new URL('./shutdownOnStdin.mjs', import.meta.url))).href
export const ORIGIN = 'http://127.0.0.1:5173'
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

// Node's global WebSocket cannot send an Origin header: the SDK falls back to `ws`, which can.
delete globalThis.WebSocket
const { Client } = await import('@colyseus/sdk')

/** Resolves once the port accepts connections, or as soon as `stopped()` (the process ended). */
async function waitForPort(port, stopped = () => false, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (stopped()) return
    const open = await new Promise(resolve => {
      const socket = net.createConnection({ host: '127.0.0.1', port })
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('error', () => resolve(false))
    })
    if (open) return
    await delay(100)
  }
  throw new Error(`no realtime on ${port}`)
}

/** Starts `services/realtime/src/index.js` of `tree` on `port` (health on port + 1). */
export async function startRealtime({ tree = here, name, port, env, waitForListen = true }) {
  const child = spawn(process.execPath, ['--import', preload, `${tree}services/realtime/src/index.js`], {
    cwd: tree,
    env: { ...process.env, PORT: String(port), HEALTH_PORT: String(port + 1), NODE_ENV: 'development', ALLOWED_ORIGINS: ORIGIN, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout.on('data', chunk => { log += chunk })
  child.stderr.on('data', chunk => { log += chunk })
  const exited = new Promise(resolve => child.once('exit', code => resolve(code)))
  const health = async path => {
    // Bounded: a process that is dying or restarting must never stall the caller.
    try { const response = await fetch(`http://127.0.0.1:${port + 1}${path}`, { signal: AbortSignal.timeout(2_000) }); return { status: response.status, body: await response.json().catch(() => null) } } catch { return { status: 0, body: null } }
  }
  const server = {
    name, port, child, exited,
    log: () => log,
    metrics: async () => (await health('/metrics')).body,
    ready: async () => (await health('/readyz')).status,
    /** Graceful shutdown (SIGTERM through the preload); resolves with the exit code. */
    async shutdown() { child.stdin.write('shutdown\n'); return exited },
    async kill() { if (child.exitCode === null) child.kill('SIGKILL'); return exited },
  }
  // A process may legitimately end right after listening (WORLD LOCATION-4: in `on`, a refused
  // activation exits with code 0): that is a start outcome for the caller to check, not an error.
  if (waitForListen) await waitForPort(port, () => child.exitCode !== null)
  return server
}

/**
 * A player (or guest) socket: { room, self, left, closing, refused, errors }. `refused` is the
 * ServerError code of a refused join (the socket never opened). `presenceProtocol` 3 sends a
 * tab id, and `resume` when asked, as the browser client does.
 */
export async function connect(server, token, { presenceProtocol = 3, tabId = null, resume = false, waitSelf = true } = {}) {
  const state = { room: null, self: null, left: null, closing: [], refused: null, errors: [], joinedAt: null }
  try {
    const joining = new Client(`ws://127.0.0.1:${server.port}`, { headers: { Origin: ORIGIN } }).joinOrCreate('presence', {
      token, presenceProtocol, worldProtocol: 3,
      ...(tabId ? { tabId } : {}), ...(resume ? { resume: true } : {}),
    })
    // Bounded too: a join against a process that dies mid-handshake counts as refused ('timeout').
    state.room = await Promise.race([joining, delay(10_000).then(() => { throw Object.assign(new Error('join timeout'), { code: 'timeout' }) })])
  } catch (error) {
    state.refused = error?.code ?? -1
    return state
  }
  const room = state.room
  state.joinedAt = Date.now()
  room.reconnection.enabled = false
  room.onMessage('presence:snapshot', payload => { if (payload.self) state.self = payload.self; state.serverProtocol = payload.presenceProtocol ?? null })
  room.onMessage('presence:self', payload => { state.self = payload })
  room.onMessage('presence:error', payload => state.errors.push(payload.reason))
  room.onMessage('presence:closing', payload => state.closing.push(payload.reason))
  room.onMessage('*', () => {})
  room.onLeave(code => { state.left = code })
  room.send('presence:ready')
  if (waitSelf) {
    for (let i = 0; i < 200 && !state.self && state.left === null; i++) await delay(25)
    if (!state.self && state.left === null) throw new Error(`no snapshot from ${server.name}`)
  }
  return state
}

/** One step in a direction the tree's own geometry says is open; resolves once the server confirmed it. */
export async function nudge(state, openDirection) {
  if (!state.room || state.left !== null || !state.self) return false
  const direction = openDirection(state.self.areaId, state.self, ['right', 'left', 'up', 'down'])
  const sequence = state.self.moveSequence + 1
  state.room.send('move', { direction, running: false, sequence })
  for (let i = 0; i < 200 && state.self.moveSequence < sequence && state.left === null; i++) await delay(10)
  return state.self.moveSequence >= sequence
}

export async function leave(state) {
  if (!state.room || state.left !== null) return
  await state.room.leave().catch(() => {})
}
