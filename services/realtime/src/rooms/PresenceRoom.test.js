import test from 'node:test'
import assert from 'node:assert/strict'
import { PresenceRoom } from './PresenceRoom.js'
import { MESSAGE } from '../protocol/messages.js'

function client(id) {
  const messages = []
  const leaves = []
  return {
    sessionId: id, userData: undefined, send: (type, payload) => messages.push({ type, payload }), messages,
    leave: code => leaves.push(code), leaves,
  }
}

/**
 * The last message of a given type.
 *
 * These assertions used to read `messages.at(-1)` and so depended on the
 * snapshot being the final thing a join sends. Community Playtest 0.1 sends
 * the area's chat history right after it, which is a protocol addition and not
 * a regression — asking for the message by name says what the test means and
 * does not break the next time the handshake grows.
 */
const lastOf = (target, type) => [...target.messages].reverse().find(entry => entry.type === type)

test('guest receives a read-only snapshot and never receives an actor', async () => {
  const room = new PresenceRoom()
  const guest = client('guest-test')
  await room.onJoin(guest, {}, { kind: 'guest', token: null })
  assert.deepEqual(guest.userData, { observer: { areaId: 'ciudad-corazon', tx: 31, ty: 20 } })
  assert.equal(guest.messages.length, 0)
  room.ready(guest)
  assert.equal(guest.messages[0].type, MESSAGE.SNAPSHOT)
  assert.equal(guest.messages[0].payload.access, 'guest')
  assert.equal('self' in guest.messages[0].payload, false)
  room.move(guest, { direction: 'right', running: false })
  assert.equal(guest.messages.at(-1).type, MESSAGE.ERROR)
  room.onLeave(guest)
})

test('guest observation validates its payload and stays read-only', async () => {
  const room = new PresenceRoom()
  const guest = client('guest-observe-test')
  await room.onJoin(guest, {}, { kind: 'guest', token: null })
  room.ready(guest)
  room.observe(guest, { areaId: 'pradera', tx: 12, ty: -3 })
  assert.deepEqual(guest.userData, { observer: { areaId: 'pradera', tx: 12, ty: -3 } })
  room.observe(guest, { areaId: 'not-an-area', tx: 0, ty: 0 })
  assert.equal(guest.messages.at(-1).type, MESSAGE.ERROR)
  room.onLeave(guest)
})

test('a second session replaces the prior actor for the same authenticated user', async () => {
  const room = new PresenceRoom()
  const first = client('first-session')
  const second = client('second-session')
  const auth = { kind: 'player', userId: 'same-user', username: 'Entrenador', token: null }
  await room.onJoin(first, {}, auth)
  await room.onJoin(second, {}, auth)
  assert.deepEqual(first.leaves, [4001])
  assert.deepEqual(second.userData, { actorId: 'same-user' })
  room.onLeave(first)
  room.onLeave(second)
})

test('an authenticated snapshot includes only its server-authoritative self actor', async () => {
  const room = new PresenceRoom()
  const player = client('authoritative-self')
  await room.onJoin(player, {}, { kind: 'player', userId: 'self-user', username: 'Self', token: null })
  assert.equal(player.messages.length, 0)
  room.ready(player)
  assert.deepEqual(lastOf(player, MESSAGE.SNAPSHOT), {
    type: MESSAGE.SNAPSHOT,
    payload: {
      access: 'player',
      actors: [],
      self: { id: 'self-user', areaId: 'ciudad-corazon', tx: 31, ty: 20, username: 'Self', characterId: 'lucas', companionId: null, dir: 'down', speed: 3.75, moveSequence: 0 },
    },
  })
  room.onLeave(player)
})

test('a move acknowledges only the authoritative actor, not a full scene snapshot', async () => {
  const room = new PresenceRoom()
  const player = client('self-move')
  await room.onJoin(player, {}, { kind: 'player', userId: 'self-move-user', username: 'Self', token: null })
  room.ready(player)
  const realNow = Date.now
  Date.now = () => 1_000
  try {
    room.move(player, { direction: 'right', running: true, sequence: 1 })
  } finally {
    Date.now = realNow
  }
  assert.deepEqual(player.messages.at(-1), {
    type: MESSAGE.SELF,
    payload: { id: 'self-move-user', areaId: 'ciudad-corazon', tx: 32, ty: 20, username: 'Self', characterId: 'lucas', companionId: null, dir: 'right', speed: 7.5, moveSequence: 1 },
  })
  room.onLeave(player)
})

test('a reload replaces presence before an optional companion lookup resolves', async () => {
  const room = new PresenceRoom()
  const first = client('reload-first')
  const second = client('reload-second')
  const auth = { kind: 'player', userId: 'reload-user', username: 'Reload', token: null }
  await room.onJoin(first, {}, auth)
  await room.onJoin(second, { visual: { companionPokemonId: 25 } }, auth)
  room.onLeave(first)
  assert.deepEqual(second.userData, { actorId: 'reload-user' })
  room.ready(second)
  assert.equal(lastOf(second, MESSAGE.SNAPSHOT)?.type, MESSAGE.SNAPSHOT)
  room.onLeave(second)
})

test('a browser refresh recovers only the same player’s short-lived server position', async () => {
  const room = new PresenceRoom()
  const first = client('refresh-first')
  const second = client('refresh-second')
  const auth = { kind: 'player', userId: 'refresh-user', username: 'Refresh', token: null }
  const realNow = Date.now
  Date.now = () => 1_000
  try {
    await room.onJoin(first, {}, auth)
    room.move(first, { direction: 'right', running: false, sequence: 1 })
    room.onLeave(first)
    await room.onJoin(second, {}, auth)
    room.ready(second)
  } finally {
    Date.now = realNow
  }
  assert.deepEqual(lastOf(second, MESSAGE.SNAPSHOT).payload.self, {
    id: 'refresh-user', areaId: 'ciudad-corazon', tx: 32, ty: 20, username: 'Refresh', characterId: 'lucas', companionId: null, dir: 'right', speed: 3.75, moveSequence: 1,
  })
  room.onLeave(second)
})

test('chat reaches everyone in the area, and nobody outside it', async () => {
  const room = new PresenceRoom()
  const speaker = client('chat-speaker')
  const neighbour = client('chat-neighbour')
  const elsewhere = client('chat-elsewhere')
  await room.onJoin(speaker, {}, { kind: 'player', userId: 'chat-a', username: 'Ash', token: null })
  await room.onJoin(neighbour, {}, { kind: 'player', userId: 'chat-b', username: 'Misty', token: null })
  await room.onJoin(elsewhere, {}, { kind: 'player', userId: 'chat-c', username: 'Brock', token: null })
  room.ready(speaker)
  room.ready(neighbour)
  // Brock walks off to the wild; the other two stay in the city.
  room.changeArea(elsewhere, { areaId: 'pradera' })

  room.chat(speaker, { text: '  hola   a todos  ' })

  const heard = lastOf(neighbour, MESSAGE.CHAT_LINE)
  assert.equal(heard.payload.text, 'hola a todos')
  assert.equal(heard.payload.username, 'Ash')
  assert.equal(heard.payload.areaId, 'ciudad-corazon')
  // The speaker hears their own line, so the log is the same for everyone.
  assert.equal(lastOf(speaker, MESSAGE.CHAT_LINE).payload.text, 'hola a todos')
  assert.equal(lastOf(elsewhere, MESSAGE.CHAT_LINE), undefined)

  room.onLeave(speaker)
  room.onLeave(neighbour)
  room.onLeave(elsewhere)
})

test('a guest may read the area but not speak into it', async () => {
  const room = new PresenceRoom()
  const guest = client('chat-guest')
  await room.onJoin(guest, {}, { kind: 'guest', token: null })
  room.ready(guest)
  room.chat(guest, { text: 'hola' })
  assert.equal(guest.messages.at(-1).type, MESSAGE.ERROR)
  assert.equal(lastOf(guest, MESSAGE.CHAT_LINE), undefined)
  room.onLeave(guest)
})

test('an empty message is refused rather than broadcast', async () => {
  const room = new PresenceRoom()
  const player = client('chat-empty')
  await room.onJoin(player, {}, { kind: 'player', userId: 'chat-empty-user', username: 'Ash', token: null })
  room.ready(player)
  room.chat(player, { text: '   ' })
  assert.equal(player.messages.at(-1).type, MESSAGE.ERROR)
  assert.equal(lastOf(player, MESSAGE.CHAT_LINE), undefined)
  room.onLeave(player)
})

test('a second message in the same instant is rate limited', async () => {
  const room = new PresenceRoom()
  const player = client('chat-flood')
  await room.onJoin(player, {}, { kind: 'player', userId: 'chat-flood-user', username: 'Ash', token: null })
  room.ready(player)
  const realNow = Date.now
  Date.now = () => 5_000_000
  try {
    room.chat(player, { text: 'uno' })
    room.chat(player, { text: 'dos' })
  } finally {
    Date.now = realNow
  }
  assert.equal(lastOf(player, MESSAGE.CHAT_LINE).payload.text, 'uno')
  assert.equal(player.messages.at(-1).type, MESSAGE.ERROR)
  room.onLeave(player)
})

test('somebody arriving mid-conversation is handed the area history', async () => {
  const room = new PresenceRoom()
  const early = client('chat-early')
  const late = client('chat-late')
  await room.onJoin(early, {}, { kind: 'player', userId: 'chat-early-user', username: 'Ash', token: null })
  room.ready(early)
  room.chat(early, { text: 'alguien vio una cueva?' })

  await room.onJoin(late, {}, { kind: 'player', userId: 'chat-late-user', username: 'Misty', token: null })
  room.ready(late)
  const history = lastOf(late, MESSAGE.CHAT_HISTORY)
  assert.equal(history.payload.areaId, 'ciudad-corazon')
  assert.ok(history.payload.lines.some(line => line.text === 'alguien vio una cueva?'))

  // And changing area hands over that area's history instead, not the old one.
  room.changeArea(late, { areaId: 'pradera' })
  assert.equal(lastOf(late, MESSAGE.CHAT_HISTORY).payload.areaId, 'pradera')

  room.onLeave(early)
  room.onLeave(late)
})

test('capacity rejects a new connection before it can create presence', async () => {
  const room = new PresenceRoom()
  const guest = client('over-capacity')
  const previous = PresenceRoom.connections
  PresenceRoom.connections = 100
  try {
    await assert.rejects(() => room.onJoin(guest, {}, { kind: 'guest', token: null }), /capacity reached/)
    assert.equal(guest.userData, undefined)
  } finally {
    PresenceRoom.connections = previous
  }
})

test('wild interest sends a leave when an actor exits the viewer sector', async () => {
  const room = new PresenceRoom()
  const watcher = client('wild-watcher')
  const traveller = client('wild-traveller')
  const watcherAuth = { kind: 'player', userId: 'watcher', username: 'Watcher', token: null }
  const travellerAuth = { kind: 'player', userId: 'traveller', username: 'Traveller', token: null }
  await room.onJoin(watcher, {}, watcherAuth)
  await room.onJoin(traveller, {}, travellerAuth)
  room.ready(watcher)
  room.ready(traveller)
  room.changeArea(watcher, { areaId: 'pradera' })
  room.changeArea(traveller, { areaId: 'pradera' })
  const realNow = Date.now
  let now = 1_000
  Date.now = () => now
  try {
    for (let step = 0; step < 24; step++) {
      room.move(traveller, { direction: 'right', running: true })
      now += 125
    }
  } finally {
    Date.now = realNow
  }
  assert.deepEqual(watcher.messages.at(-1), {
    type: MESSAGE.DELTA,
    payload: { type: 'leave', actor: { id: 'traveller', areaId: 'pradera', tx: 24, ty: 41, username: 'Traveller', characterId: 'lucas', companionId: null, dir: 'right', speed: 7.5, moveSequence: 16 } },
  })
  room.onLeave(watcher)
  room.onLeave(traveller)
})
