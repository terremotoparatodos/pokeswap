import { performance } from 'node:perf_hooks'
import { PresenceRoom } from '../src/rooms/PresenceRoom.js'

const PLAYERS = Math.max(1, Math.min(100, Number.parseInt(process.argv[2] ?? process.env.LOAD_PLAYERS ?? '50', 10) || 50))
const room = new PresenceRoom()
const clients = []

function client(id) {
  let messages = 0
  let batchItems = 0
  const byType = new Map()
  return {
    sessionId: id, userData: undefined,
    send: (type, payload) => {
      messages++; byType.set(type, (byType.get(type) ?? 0) + 1)
      if (type === 'presence:batch') batchItems += payload.length
    },
    leave: () => undefined,
    get messages() { return messages },
    get deltas() { return byType.get('presence:delta') ?? 0 },
    get batches() { return byType.get('presence:batch') ?? 0 },
    get batchItems() { return batchItems },
  }
}

const started = performance.now()
for (let index = 0; index < PLAYERS; index++) {
  const current = client(`load-${index}`)
  clients.push(current)
  await room.onJoin(current, {}, { kind: 'player', userId: `load-user-${index}`, username: `Load ${index}`, token: null })
  if (index % 2 === 1) room.changeArea(current, { areaId: 'pradera' })
}
const joinedAt = performance.now()
const messagesBeforeMove = clients.reduce((sum, current) => sum + current.messages, 0)
room.deltaBatching = true
for (const current of clients) room.move(current, { direction: 'right' })
room.flushDeltaBatches()
const movedAt = performance.now()
const messages = clients.reduce((sum, current) => sum + current.messages, 0)
const deltas = clients.map(current => current.deltas).sort((a, b) => a - b)
const batches = clients.reduce((sum, current) => sum + current.batches, 0)
const batchItems = clients.reduce((sum, current) => sum + current.batchItems, 0)
for (const current of clients) room.onLeave(current)

console.log(JSON.stringify({
  players: PLAYERS,
  joinMs: Math.round((joinedAt - started) * 100) / 100,
  moveMs: Math.round((movedAt - joinedAt) * 100) / 100,
  messages,
  moveSocketMessages: messages - messagesBeforeMove,
  batches,
  batchItems,
  deltaP50: deltas[Math.floor(deltas.length * 0.5)],
  deltaP95: deltas[Math.min(deltas.length - 1, Math.floor(deltas.length * 0.95))],
  deltaMax: deltas[deltas.length - 1],
  connectionsAfterCleanup: PresenceRoom.connections,
}))
if (PresenceRoom.connections !== 0) process.exitCode = 1
