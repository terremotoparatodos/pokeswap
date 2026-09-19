import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CHAT_BURST_LIMIT, CHAT_BURST_WINDOW_MS, CHAT_MIN_INTERVAL_MS, ChatLog, MAX_CHAT_LENGTH,
  acceptChat, chatIntent, chatMessage, sanitizeChat,
} from './chat.js'

test('an empty or blank message is not a message', () => {
  assert.equal(sanitizeChat(''), null)
  assert.equal(sanitizeChat('   \t\n  '), null)
  assert.equal(sanitizeChat(null), null)
  assert.equal(sanitizeChat(42), null)
  assert.equal(sanitizeChat({ text: 'hola' }), null)
})

test('newlines and tabs collapse instead of breaking the log out of its box', () => {
  assert.equal(sanitizeChat('hola\n\n\nmundo'), 'hola mundo')
  assert.equal(sanitizeChat('  hola \t mundo  '), 'hola mundo')
})

test('invisible characters are removed, because they are used to fake names', () => {
  assert.equal(sanitizeChat('ho​la﻿'), 'hola')
  assert.equal(sanitizeChat('‮hola'), 'hola')
  assert.equal(sanitizeChat('bip'), 'bip')
})

test('text that is really text survives untouched', () => {
  assert.equal(sanitizeChat('¿Dónde está la cueva? 🗿'), '¿Dónde está la cueva? 🗿')
  assert.equal(sanitizeChat('привет'), 'привет')
  // Escaping belongs to the renderer. Stripping angle brackets here would
  // quietly break "3 < 5" and buy nothing Vue interpolation does not give.
  assert.equal(sanitizeChat('3 < 5 & <b>hola</b>'), '3 < 5 & <b>hola</b>')
})

test('a very long message is cut, and cut by characters rather than code units', () => {
  assert.equal(sanitizeChat('x'.repeat(MAX_CHAT_LENGTH + 50)).length, MAX_CHAT_LENGTH)
  // Emoji are surrogate pairs; slicing the string would split one in half.
  const emoji = sanitizeChat('🙂'.repeat(MAX_CHAT_LENGTH + 10))
  assert.equal([...emoji].length, MAX_CHAT_LENGTH)
  assert.ok(!emoji.includes('�'))
})

test('chatIntent rejects anything that is not a sendable payload', () => {
  assert.deepEqual(chatIntent({ text: ' hola ' }), { text: 'hola' })
  assert.equal(chatIntent({ text: '   ' }), null)
  assert.equal(chatIntent({}), null)
  assert.equal(chatIntent(null), null)
  assert.equal(chatIntent('hola'), null)
})

test('a player cannot send two messages back to back', () => {
  const actor = { id: 'a' }
  assert.equal(acceptChat(actor, 1_000), true)
  assert.equal(acceptChat(actor, 1_000 + CHAT_MIN_INTERVAL_MS - 1), false)
  assert.equal(acceptChat(actor, 1_000 + CHAT_MIN_INTERVAL_MS), true)
})

test('and cannot ride the floor to spam the room', () => {
  const actor = { id: 'a' }
  // Someone hammering send for one whole burst window, as fast as the floor
  // allows. The floor alone would let fourteen through; the ceiling is what
  // holds it to six.
  const start = 1_000_000
  let sent = 0
  for (let now = start; now < start + CHAT_BURST_WINDOW_MS; now += 100) {
    if (acceptChat(actor, now)) sent++
  }
  assert.equal(sent, CHAT_BURST_LIMIT)
})

test('the burst ceiling is a window, not a ban', () => {
  const actor = { id: 'a' }
  let now = 1_000_000
  for (let i = 0; i < CHAT_BURST_LIMIT; i++) {
    acceptChat(actor, now)
    now += CHAT_MIN_INTERVAL_MS
  }
  assert.equal(acceptChat(actor, now), false)
  // Once the oldest message ages out of the window, the next one goes through.
  assert.equal(acceptChat(actor, now + CHAT_BURST_WINDOW_MS), true)
})

test('one player being throttled does not throttle another', () => {
  const a = { id: 'a' }
  const b = { id: 'b' }
  assert.equal(acceptChat(a, 1_000), true)
  assert.equal(acceptChat(a, 1_100), false)
  assert.equal(acceptChat(b, 1_100), true)
})

test('a message names its area, its sender and its moment', () => {
  const actor = { id: 'u1', areaId: 'pradera', username: 'ash' }
  const message = chatMessage(actor, 'hola', 1_700_000_000_000, 3)
  assert.deepEqual(message, {
    id: 'u1:3', areaId: 'pradera', from: 'u1', username: 'ash', text: 'hola', at: 1_700_000_000_000,
  })
})

test('history keeps the last lines of each area, and the areas do not mix', () => {
  const log = new ChatLog(3)
  for (let i = 1; i <= 5; i++) log.append({ areaId: 'pradera', text: `p${i}` })
  log.append({ areaId: 'ciudad-corazon', text: 'c1' })

  assert.deepEqual(log.recent('pradera').map(line => line.text), ['p3', 'p4', 'p5'])
  assert.deepEqual(log.recent('ciudad-corazon').map(line => line.text), ['c1'])
  assert.deepEqual(log.recent('desierto'), [])
})

test('history hands out copies, so a caller cannot edit the room', () => {
  const log = new ChatLog()
  log.append({ areaId: 'pradera', text: 'hola' })
  log.recent('pradera').push({ areaId: 'pradera', text: 'inyectado' })
  assert.equal(log.recent('pradera').length, 1)
})
