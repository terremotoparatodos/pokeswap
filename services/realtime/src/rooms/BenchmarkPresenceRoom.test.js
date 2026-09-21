import assert from 'node:assert/strict'
import test from 'node:test'
import { BenchmarkPresenceRoom } from './BenchmarkPresenceRoom.js'

test('accepts a bounded synthetic identity in local benchmark mode', async () => {
  const room = new BenchmarkPresenceRoom()
  assert.deepEqual(await room.onAuth({}, { benchmark: { id: 'player-12', username: 'Carga 12' } }), {
    kind: 'player', userId: 'benchmark-player-12', username: 'Carga 12', token: null,
  })
})

test('rejects malformed synthetic identities', async () => {
  const room = new BenchmarkPresenceRoom()
  await assert.rejects(() => room.onAuth({}, { benchmark: { id: '../outside', username: 'Carga' } }))
  await assert.rejects(() => room.onAuth({}, { benchmark: { id: 'valid', username: 12 } }))
  await assert.rejects(() => room.onAuth({}, { benchmark: { id: 'valid', username: 'Carga', area: 'otra' } }))
})
