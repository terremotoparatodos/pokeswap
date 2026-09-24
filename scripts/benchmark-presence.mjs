import { spawn } from 'node:child_process'
import net from 'node:net'
import { performance } from 'node:perf_hooks'
import { Client } from '@colyseus/sdk'

const MESSAGE_TYPES = [
  'presence:snapshot', 'presence:self', 'presence:delta', 'presence:batch',
  'presence:error', 'chat:history', 'chat:line',
]
const DIRECTIONS = ['right', 'down', 'left', 'up']

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isInteger(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback
}

function percentile(values, fraction) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]
}

function round(value) { return Math.round(value * 100) / 100 }
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

async function waitForPort(port, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const open = await new Promise(resolve => {
      const socket = net.createConnection({ host: '127.0.0.1', port })
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('error', () => resolve(false))
      socket.setTimeout(250, () => { socket.destroy(); resolve(false) })
    })
    if (open) return
    await delay(100)
  }
  throw new Error(`realtime did not listen on port ${port}`)
}

const players = boundedInteger(option('players', process.argv[2]), 50, 1, 100)
const durationSeconds = boundedInteger(option('duration', process.argv[3]), 30, 3, 3600)
const warmupSeconds = boundedInteger(option('warmup', '3'), 3, 0, 30)
const port = boundedInteger(option('port', '2568'), 2568, 1024, 65535)
const url = option('url', `ws://127.0.0.1:${port}`)
const requestedArea = option('area', 'ciudad-corazon')
const area = requestedArea === 'wild' ? 'pradera' : requestedArea
if (!['ciudad-corazon', 'pradera'].includes(area)) throw new Error(`unsupported area: ${requestedArea}`)
const identityPrefix = option('prefix', 'player')
if (!/^[a-z0-9][a-z0-9-]{0,24}$/.test(identityPrefix)) throw new Error(`invalid identity prefix: ${identityPrefix}`)
// Omitted = legacy clients (no `presenceProtocol`), as before; 2 = compact `step` deltas.
const presenceProtocol = option('protocol') === undefined ? undefined : boundedInteger(option('protocol'), 1, 1, 9)
const externalServer = process.argv.includes('--external-server')
let server = null

if (!externalServer) {
  server = spawn(process.execPath, ['services/realtime/src/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      HEALTH_PORT: String(port + 1),
      NODE_ENV: 'development',
      PRESENCE_BENCHMARK: 'on',
      ALLOWED_ORIGINS: 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5175,http://127.0.0.1:5175',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let serverError = ''
  server.stderr.on('data', chunk => { serverError += chunk.toString() })
  server.once('exit', code => {
    if (code && serverError) process.stderr.write(serverError)
  })
  await waitForPort(port)
}

const rooms = []
const stats = []
const eventLoopLag = []
let lagExpected = performance.now() + 100
const lagTimer = setInterval(() => {
  const now = performance.now()
  eventLoopLag.push(Math.max(0, now - lagExpected))
  lagExpected = now + 100
}, 100)

try {
  const joinStarted = performance.now()
  for (let index = 0; index < players; index++) {
    const room = await new Client(url).joinOrCreate('presence', {
      benchmark: { id: `${identityPrefix}-${index}`, username: `Carga ${index}`, area },
      visual: { characterId: index % 3 === 0 ? 'dawn-pink' : index % 3 === 1 ? 'dawn-yellow' : 'lucas' },
      ...(presenceProtocol === undefined ? {} : { presenceProtocol }),
    })
    room.reconnection.enabled = false
    const current = {
      room, bytes: 0, wireBytes: 0, wireFrames: 0, physicalMessages: 0, logicalUpdates: 0, snapshots: 0,
      selfAcks: 0, errors: 0, sequence: 0, sentAt: new Map(), rtt: [],
    }
    // Real received payload bytes (Colyseus msgpack frames), not the JSON estimate.
    room.connection.transport.ws.addEventListener('message', event => {
      current.wireFrames++
      current.wireBytes += event.data.byteLength ?? Buffer.byteLength(event.data)
    })
    for (const type of MESSAGE_TYPES) {
      room.onMessage(type, payload => {
        current.physicalMessages++
        current.bytes += Buffer.byteLength(JSON.stringify([type, payload]))
        if (type === 'presence:batch') current.logicalUpdates += payload.length
        else if (type === 'presence:delta') current.logicalUpdates++
        else if (type === 'presence:snapshot') current.snapshots++
        else if (type === 'presence:error') current.errors++
        else if (type === 'presence:self') {
          current.selfAcks++
          const sent = current.sentAt.get(payload.moveSequence)
          if (sent !== undefined) {
            current.rtt.push(performance.now() - sent)
            current.sentAt.delete(payload.moveSequence)
          }
        }
      })
    }
    room.send('presence:ready')
    rooms.push(room)
    stats.push(current)
  }
  const joinedAt = performance.now()
  if (warmupSeconds > 0) await delay(warmupSeconds * 1000)

  for (const current of stats) {
    current.bytes = 0; current.wireBytes = 0; current.wireFrames = 0; current.physicalMessages = 0; current.logicalUpdates = 0
    current.snapshots = 0; current.selfAcks = 0; current.errors = 0; current.rtt.length = 0
  }
  eventLoopLag.length = 0
  lagExpected = performance.now() + 100

  let tick = 0
  const movementStarted = performance.now()
  const movementTimer = setInterval(() => {
    const now = performance.now()
    for (let index = 0; index < stats.length; index++) {
      const current = stats[index]
      const direction = DIRECTIONS[Math.floor((tick + index % 4) / 5) % DIRECTIONS.length]
      current.sequence++
      current.sentAt.set(current.sequence, now)
      current.room.send('move', { direction, running: true, sequence: current.sequence })
    }
    tick++
  }, 140)
  await delay(durationSeconds * 1000)
  clearInterval(movementTimer)
  await delay(150)
  const finishedAt = performance.now()

  const allRtt = stats.flatMap(current => current.rtt)
  const clientMessages = stats.map(current => current.physicalMessages)
  const clientUpdates = stats.map(current => current.logicalUpdates)
  const totalBytes = stats.reduce((sum, current) => sum + current.bytes, 0)
  const totalMessages = stats.reduce((sum, current) => sum + current.physicalMessages, 0)
  const totalUpdates = stats.reduce((sum, current) => sum + current.logicalUpdates, 0)
  const totalWireBytes = stats.reduce((sum, current) => sum + current.wireBytes, 0)
  const elapsedSeconds = (finishedAt - movementStarted) / 1000
  const clientWireKiBPerSecond = stats.map(current => current.wireBytes / 1024 / elapsedSeconds)
  const result = {
    benchmark: 'presence-websocket-v1',
    players,
    area,
    presenceProtocol: presenceProtocol ?? null,
    warmupSeconds,
    identityPrefix,
    durationSeconds: round(elapsedSeconds),
    joinMs: round(joinedAt - joinStarted),
    transport: url,
    totals: {
      socketMessages: totalMessages,
      logicalUpdates: totalUpdates,
      estimatedBytes: totalBytes,
      socketMessagesPerSecond: round(totalMessages / elapsedSeconds),
      logicalUpdatesPerSecond: round(totalUpdates / elapsedSeconds),
      estimatedKiBPerSecond: round(totalBytes / 1024 / elapsedSeconds),
      wireFrames: stats.reduce((sum, current) => sum + current.wireFrames, 0),
      wireBytes: totalWireBytes,
      wireKiBPerSecond: round(totalWireBytes / 1024 / elapsedSeconds),
    },
    perClient: {
      wireKiBPerSecondP50: round(percentile(clientWireKiBPerSecond, 0.5)),
      wireKiBPerSecondP95: round(percentile(clientWireKiBPerSecond, 0.95)),
      wireKiBPerSecondMax: round(Math.max(...clientWireKiBPerSecond)),
      messagesP50: percentile(clientMessages, 0.5),
      messagesP95: percentile(clientMessages, 0.95),
      messagesMax: Math.max(...clientMessages),
      updatesP50: percentile(clientUpdates, 0.5),
      updatesP95: percentile(clientUpdates, 0.95),
      updatesMax: Math.max(...clientUpdates),
    },
    acknowledgementRttMs: {
      samples: allRtt.length,
      p50: round(percentile(allRtt, 0.5)),
      p95: round(percentile(allRtt, 0.95)),
      p99: round(percentile(allRtt, 0.99)),
      max: round(Math.max(0, ...allRtt)),
    },
    driverEventLoopLagMs: {
      p95: round(percentile(eventLoopLag, 0.95)),
      p99: round(percentile(eventLoopLag, 0.99)),
      max: round(Math.max(0, ...eventLoopLag)),
    },
    rejectedMoves: stats.reduce((sum, current) => sum + current.errors, 0),
  }
  console.log(JSON.stringify(result, null, 2))
  if (allRtt.length < players) process.exitCode = 1
  if (result.rejectedMoves > 0) process.exitCode = 1
} finally {
  clearInterval(lagTimer)
  await Promise.allSettled(rooms.map(room => room.leave()))
  if (server) server.kill()
}
