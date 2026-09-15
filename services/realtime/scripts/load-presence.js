import { performance } from 'node:perf_hooks'
import { PresenceRoom } from '../src/rooms/PresenceRoom.js'

const PLAYERS = 50
const room = new PresenceRoom()
const clients = []

function client(id) {
  let messages = 0
  return { sessionId: id, userData: undefined, send: () => { messages++ }, leave: () => undefined, get messages() { return messages } }
}

const started = performance.now()
for (let index = 0; index < PLAYERS; index++) {
  const current = client(`load-${index}`)
  clients.push(current)
  await room.onJoin(current, {}, { kind: 'player', userId: `load-user-${index}`, username: `Load ${index}`, token: null })
  if (index % 2 === 1) room.changeArea(current, { areaId: 'pradera' })
}
const joinedAt = performance.now()
for (const current of clients) room.move(current, { direction: 'right' })
const movedAt = performance.now()
const messages = clients.reduce((sum, current) => sum + current.messages, 0)
for (const current of clients) room.onLeave(current)

console.log(JSON.stringify({
  players: PLAYERS,
  joinMs: Math.round((joinedAt - started) * 100) / 100,
  moveMs: Math.round((movedAt - joinedAt) * 100) / 100,
  messages,
  connectionsAfterCleanup: PresenceRoom.connections,
}))
if (PresenceRoom.connections !== 0) process.exitCode = 1
