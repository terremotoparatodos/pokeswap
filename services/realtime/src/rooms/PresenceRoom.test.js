import test from 'node:test'
import assert from 'node:assert/strict'
import { PresenceRoom } from './PresenceRoom.js'
import { MAX_VIA_STEPS, MESSAGE } from '../protocol/messages.js'
import { RETAIN_MARGIN_TILES } from '../presence/interest.js'
import { metrics } from '../observability/metrics.js'

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

test('wild interest sends a leave once an actor is past the retention margin and out of the viewer sectors', async () => {
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
    // Both start at (-5, -69). The sectors alone would drop the traveller at
    // x = 12, 17 tiles away and on screen; now it stays until 20 + 6 tiles.
    for (let step = 0; step < 30; step++) {
      room.move(traveller, { direction: 'right', running: true })
      now += 125
    }
  } finally {
    Date.now = realNow
  }
  assert.deepEqual(watcher.messages.at(-1), {
    type: MESSAGE.DELTA,
    payload: { type: 'leave', actor: { id: 'traveller', areaId: 'pradera', tx: 22, ty: -69, username: 'Traveller', characterId: 'lucas', companionId: null, dir: 'right', speed: 7.5, moveSequence: 27 } },
  })
  room.onLeave(watcher)
  room.onLeave(traveller)
})

test('moving the viewer reconciles stationary town actors at the interest boundary, with hysteresis', async () => {
  const room = new PresenceRoom()
  const watcher = client('town-watcher-client')
  const traveller = client('town-traveller-client')
  await room.onJoin(watcher, {}, { kind: 'player', userId: 'town-watcher', username: 'Watcher', token: null })
  await room.onJoin(traveller, {}, { kind: 'player', userId: 'town-traveller', username: 'Traveller', token: null })
  room.ready(watcher)
  room.ready(traveller)

  const realNow = Date.now
  let now = 10_000
  Date.now = () => now
  const deltas = () => watcher.messages.filter(message => message.type === MESSAGE.DELTA).map(message => message.payload.type)
  try {
    // Traveller remains just inside the 20-tile town radius.
    for (let step = 0; step < 20; step++) {
      room.move(traveller, { direction: 'right', running: false })
      now += 250
    }
    const seen = deltas().length
    // Only the watcher moves. Within the retention margin the traveller stays.
    for (let step = 0; step < RETAIN_MARGIN_TILES; step++) {
      room.move(watcher, { direction: 'left', running: false })
      now += 250
    }
    assert.equal(deltas().length, seen)
    // One more tile and it is gone, even while stationary.
    room.move(watcher, { direction: 'left', running: false })
    assert.equal(lastOf(watcher, MESSAGE.DELTA).payload.type, 'leave')
    assert.equal(lastOf(watcher, MESSAGE.DELTA).payload.actor.id, 'town-traveller')

    // Coming back, it reappears only once inside the entry radius again.
    for (let step = 0; step < RETAIN_MARGIN_TILES; step++) {
      now += 250
      room.move(watcher, { direction: 'right', running: false })
    }
    assert.equal(lastOf(watcher, MESSAGE.DELTA).payload.type, 'leave')
    now += 250
    room.move(watcher, { direction: 'right', running: false })
    assert.equal(lastOf(watcher, MESSAGE.DELTA).payload.type, 'upsert')
    assert.equal(lastOf(watcher, MESSAGE.DELTA).payload.actor.id, 'town-traveller')
  } finally {
    Date.now = realNow
  }
  room.onLeave(watcher)
  room.onLeave(traveller)
})

test('production batching coalesces repeated actor movement into one socket message', async () => {
  const room = new PresenceRoom()
  const watcher = client('batch-watcher-client')
  const traveller = client('batch-traveller-client')
  await room.onJoin(watcher, {}, { kind: 'player', userId: 'batch-watcher', username: 'Watcher', token: null })
  await room.onJoin(traveller, {}, { kind: 'player', userId: 'batch-traveller', username: 'Traveller', token: null })
  room.ready(watcher)
  room.ready(traveller)
  room.deltaBatching = true

  const deltasBefore = watcher.messages.filter(message => message.type === MESSAGE.DELTA).length
  const realNow = Date.now
  let now = 20_000
  Date.now = () => now
  try {
    room.move(traveller, { direction: 'right', running: true })
    now += 125
    room.move(traveller, { direction: 'right', running: true })
  } finally {
    Date.now = realNow
  }

  assert.equal(watcher.messages.filter(message => message.type === MESSAGE.DELTA).length, deltasBefore)
  room.flushDeltaBatches()
  const batch = lastOf(watcher, MESSAGE.BATCH)
  assert.equal(batch.payload.length, 1)
  assert.equal(batch.payload[0].type, 'upsert')
  assert.equal(batch.payload[0].actor.id, 'batch-traveller')
  assert.equal(batch.payload[0].actor.tx, 33)

  room.onLeave(watcher)
  room.onLeave(traveller)
})

test('a step over a queued step in the same window keeps the earlier one in via', async () => {
  const room = new PresenceRoom()
  const watcher = client('metrics-watcher-client')
  const traveller = client('metrics-traveller-client')
  await room.onJoin(watcher, { presenceProtocol: 2 }, { kind: 'player', userId: 'metrics-watcher', username: 'Watcher', token: null })
  await room.onJoin(traveller, {}, { kind: 'player', userId: 'metrics-traveller', username: 'Traveller', token: null })
  room.ready(watcher)
  room.ready(traveller)
  room.deltaBatching = true
  room.flushDeltaBatches()

  const before = { ...metrics.batching }
  const realNow = Date.now
  let now = 40_000
  Date.now = () => now
  try {
    room.move(traveller, { direction: 'right', running: true, sequence: 1 })
    now += 20
    room.move(traveller, { direction: 'right', running: true, sequence: 2 })
  } finally {
    Date.now = realNow
  }
  room.flushDeltaBatches()

  assert.equal(metrics.batching.stepStacked - before.stepStacked, 1)
  assert.equal(metrics.batching.batches - before.batches, 1)
  const batch = lastOf(watcher, MESSAGE.BATCH)
  assert.deepEqual(batch.payload.map(delta => [delta.type, delta.actor.tx, delta.actor.moveSequence]), [['step', 33, 2]])
  assert.deepEqual(batch.payload[0].via, [{ tx: 32, ty: 20, dir: 'right', speed: 7.5, moveSequence: 1 }])

  room.onLeave(watcher)
  room.onLeave(traveller)
})

test('a stalled uplink keeps every step of the window, bounded', async () => {
  const room = new PresenceRoom()
  const watcher = client('via-watcher-client')
  const traveller = client('via-traveller-client')
  await room.onJoin(watcher, { presenceProtocol: 2 }, { kind: 'player', userId: 'via-watcher', username: 'Watcher', token: null })
  await room.onJoin(traveller, {}, { kind: 'player', userId: 'via-traveller', username: 'Traveller', token: null })
  room.ready(watcher)
  room.ready(traveller)
  room.deltaBatching = true
  room.flushDeltaBatches()

  const realNow = Date.now
  Date.now = () => 60_000
  try {
    // Moves queued behind a stall reach the server together: one window.
    const directions = ['right', 'right', 'down', 'down']
    directions.forEach((direction, i) => room.move(traveller, { direction, running: true, sequence: i + 1 }))
    room.flushDeltaBatches()
    const [delta] = lastOf(watcher, MESSAGE.BATCH).payload
    assert.deepEqual([delta.actor.tx, delta.actor.ty, delta.actor.moveSequence], [33, 22, 4])
    assert.deepEqual(delta.via.map(step => [step.tx, step.ty, step.moveSequence]), [[32, 20, 1], [33, 20, 2], [33, 21, 3]])

    for (let i = 5; i <= 5 + MAX_VIA_STEPS + 1; i++) room.move(traveller, { direction: 'left', running: true, sequence: i })
    room.flushDeltaBatches()
    const [bounded] = lastOf(watcher, MESSAGE.BATCH).payload
    assert.equal(bounded.via.length, MAX_VIA_STEPS)
    assert.equal(bounded.via.at(-1).moveSequence, bounded.actor.moveSequence - 1)
  } finally {
    Date.now = realNow
  }

  room.onLeave(watcher)
  room.onLeave(traveller)
})

test('an area snapshot discards queued deltas from the previous area', async () => {
  const room = new PresenceRoom()
  const watcher = client('batch-area-watcher-client')
  const traveller = client('batch-area-traveller-client')
  await room.onJoin(watcher, {}, { kind: 'player', userId: 'batch-area-watcher', username: 'Watcher', token: null })
  await room.onJoin(traveller, {}, { kind: 'player', userId: 'batch-area-traveller', username: 'Traveller', token: null })
  room.ready(watcher)
  room.ready(traveller)
  room.deltaBatching = true

  const realNow = Date.now
  Date.now = () => 30_000
  try {
    room.move(traveller, { direction: 'right', running: true })
    room.changeArea(watcher, { areaId: 'pradera' })
  } finally {
    Date.now = realNow
  }
  const batchesBefore = watcher.messages.filter(message => message.type === MESSAGE.BATCH).length
  room.flushDeltaBatches()
  assert.equal(watcher.messages.filter(message => message.type === MESSAGE.BATCH).length, batchesBefore)
  assert.deepEqual(lastOf(watcher, MESSAGE.SNAPSHOT).payload.actors, [])

  room.onLeave(watcher)
  room.onLeave(traveller)
})

test('area changes place the actor exactly where the client arrives, never on Pradera solid terrain', async () => {
  const room = new PresenceRoom()
  const traveller = client('arrival-traveller')
  await room.onJoin(traveller, {}, { kind: 'player', userId: 'arrival-user', username: 'Arrival', token: null })
  room.ready(traveller)
  // Town -> Pradera: the client stands on WildArea.arrival(), not the town gate tile (8, 41).
  room.changeArea(traveller, { areaId: 'pradera' })
  assert.deepEqual(pick(lastOf(traveller, MESSAGE.SNAPSHOT).payload.self), { areaId: 'pradera', tx: -5, ty: -69, dir: 'down' })
  // A same-area request (client safe-spawn repair) must land on the same safe tile, not loop.
  room.changeArea(traveller, { areaId: 'pradera' })
  assert.deepEqual(pick(lastOf(traveller, MESSAGE.SNAPSHOT).payload.self), { areaId: 'pradera', tx: -5, ty: -69, dir: 'down' })
  // Pradera -> town via the return pad: the client lands by the west gate.
  room.changeArea(traveller, { areaId: 'ciudad-corazon' })
  assert.deepEqual(pick(lastOf(traveller, MESSAGE.SNAPSHOT).payload.self), { areaId: 'ciudad-corazon', tx: 8, ty: 41, dir: 'right' })
  // The "Ciudad" escape hatch inside town resets to the town spawn.
  room.changeArea(traveller, { areaId: 'ciudad-corazon' })
  assert.deepEqual(pick(lastOf(traveller, MESSAGE.SNAPSHOT).payload.self), { areaId: 'ciudad-corazon', tx: 31, ty: 20, dir: 'down' })
  room.onLeave(traveller)
})

function pick(actor) { return { areaId: actor.areaId, tx: actor.tx, ty: actor.ty, dir: actor.dir } }

test('a rate-refused move is answered with the unchanged authoritative actor', async () => {
  const room = new PresenceRoom()
  const mover = client('rate-refused-mover')
  await room.onJoin(mover, {}, { kind: 'player', userId: 'rate-refused-user', username: 'Rate', token: null })
  room.ready(mover)
  const realNow = Date.now
  Date.now = () => 5_000
  try {
    for (let sequence = 1; sequence <= 16; sequence++) room.move(mover, { direction: 'right', running: true, sequence })
  } finally {
    Date.now = realNow
  }
  const errors = mover.messages.filter(entry => entry.type === MESSAGE.ERROR)
  assert.equal(errors.length, 1)
  const self = lastOf(mover, MESSAGE.SELF).payload
  assert.equal(self.moveSequence, 16)
  assert.equal(self.tx, 31 + 15)
  room.onLeave(mover)
})

test('compact-protocol viewers get step deltas for known actors; legacy viewers keep full upserts', async () => {
  const room = new PresenceRoom()
  const mover = client('step-mover')
  const modern = client('step-modern')
  const legacy = client('step-legacy')
  await room.onJoin(mover, {}, { kind: 'player', userId: 'step-mover-user', username: 'Mover', token: null })
  await room.onJoin(modern, { presenceProtocol: 2 }, { kind: 'player', userId: 'step-modern-user', username: 'Modern', token: null })
  await room.onJoin(legacy, {}, { kind: 'player', userId: 'step-legacy-user', username: 'Legacy', token: null })
  for (const socket of [mover, modern, legacy]) room.ready(socket)
  room.deltaBatching = false
  room.move(mover, { direction: 'right', running: false, sequence: 1 })
  assert.deepEqual(modern.messages.at(-1), {
    type: MESSAGE.DELTA,
    payload: { type: 'step', actor: { id: 'step-mover-user', tx: 32, ty: 20, dir: 'right', speed: 3.75, moveSequence: 1 } },
  })
  assert.equal(legacy.messages.at(-1).payload.type, 'upsert')
  assert.equal(legacy.messages.at(-1).payload.actor.username, 'Mover')
  for (const socket of [mover, modern, legacy]) room.onLeave(socket)
})

test('a step never erases a full upsert queued in the same batch window', async () => {
  const room = new PresenceRoom()
  const viewer = client('fold-viewer')
  await room.onJoin(viewer, { presenceProtocol: 2 }, { kind: 'player', userId: 'fold-viewer-user', username: 'Viewer', token: null })
  room.ready(viewer)
  room.deltaBatching = true
  const identity = { id: 'fold-actor', areaId: 'ciudad-corazon', tx: 32, ty: 20, username: 'Fold', characterId: 'lucas', companionId: 25, dir: 'down', speed: 3.75, moveSequence: 3 }
  room.sendDelta(viewer, { type: 'upsert', actor: identity })
  room.sendDelta(viewer, { type: 'step', actor: { id: 'fold-actor', tx: 33, ty: 20, dir: 'right', speed: 3.75, moveSequence: 4 } })
  room.flushDeltaBatches()
  assert.deepEqual(lastOf(viewer, MESSAGE.BATCH).payload, [{ type: 'upsert', actor: { ...identity, tx: 33, dir: 'right', moveSequence: 4 } }])
  room.onLeave(viewer)
})

test('an area change reaches observers as one coherent update: a leave in the old area, the arrival in the new one', async () => {
  const room = new PresenceRoom()
  const townWatcher = client('area-town-watcher')
  const wildWatcher = client('area-wild-watcher')
  const traveller = client('area-traveller')
  await room.onJoin(townWatcher, { presenceProtocol: 2 }, { kind: 'guest', token: null })
  await room.onJoin(wildWatcher, { presenceProtocol: 2 }, { kind: 'guest', token: null })
  await room.onJoin(traveller, {}, { kind: 'player', userId: 'area-traveller-user', username: 'Traveller', token: null })
  room.ready(traveller)
  room.observe(townWatcher, { areaId: 'ciudad-corazon', tx: 20, ty: 30 })
  room.observe(wildWatcher, { areaId: 'pradera', tx: -5, ty: -66 })
  // Only what follows the trip counts: before it the Pradera guest was still in town.
  const from = new Map([townWatcher, wildWatcher].map(w => [w, w.messages.length]))
  const seen = watcher => watcher.messages.slice(from.get(watcher)).filter(m => m.type === MESSAGE.DELTA && m.payload.actor.id === 'area-traveller-user')
    .map(m => [m.payload.type, m.payload.actor.areaId, m.payload.actor.tx, m.payload.actor.ty])

  const realNow = Date.now
  let now = 70_000
  Date.now = () => now
  try {
    room.changeArea(traveller, { areaId: 'pradera' })
    // Every update the Pradera watcher gets names Pradera and Pradera coordinates.
    assert.deepEqual(seen(wildWatcher), [['upsert', 'pradera', -5, -69]])
    assert.deepEqual(seen(townWatcher).at(-1)[0], 'leave')

    now += 500
    room.changeArea(traveller, { areaId: 'ciudad-corazon' })
    assert.deepEqual(seen(wildWatcher).at(-1)[0], 'leave')
    // Back in town: it reappears at the gate arrival and keeps walking from there.
    assert.deepEqual(seen(townWatcher).at(-1), ['upsert', 'ciudad-corazon', 8, 41])
    now += 300
    room.move(traveller, { direction: 'right', running: false, sequence: 1 })
    const last = townWatcher.messages.filter(m => m.type === MESSAGE.DELTA).at(-1).payload
    assert.deepEqual([last.type, last.actor.tx, last.actor.ty], ['step', 9, 41])
  } finally {
    Date.now = realNow
  }
  room.onLeave(townWatcher)
  room.onLeave(wildWatcher)
  room.onLeave(traveller)
})
