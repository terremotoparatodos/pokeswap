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

test('a synthetic player starts in its area by crossing the real portals (CAVES-4)', async () => {
  const { MESSAGE } = await import('../protocol/messages.js')
  const { ARRIVALS } = await import('../protocol/arrival.js')
  const { caveInterior } = await import('../world/caveLayouts.js')
  const room = new BenchmarkPresenceRoom()
  const sockets = []
  try {
    for (const area of ['pradera', 'cueva-inicial']) {
      const messages = []
      const client = { sessionId: `bench-${area}`, userData: undefined, messages, send: (type, payload) => messages.push({ type, payload }), leave() {} }
      sockets.push(client)
      const options = { benchmark: { id: `cross-${area}`, username: 'Carga', area } }
      await room.onJoin(client, options, await room.onAuth(client, options))
      const snapshot = [...messages].reverse().find(m => m.type === MESSAGE.SNAPSHOT).payload.self
      const expected = area === 'pradera' ? ARRIVALS.pradera : caveInterior(area).arrival
      assert.deepEqual({ areaId: snapshot.areaId, tx: snapshot.tx, ty: snapshot.ty }, { areaId: area, tx: expected.tx, ty: expected.ty })
      assert.equal(messages.filter(m => m.type === MESSAGE.ERROR).length, 0)
    }
  } finally {
    for (const client of sockets) room.onLeave(client)
  }
})
