import test from 'node:test'
import assert from 'node:assert/strict'
import { LocationJournal } from './locationJournal.js'
import { openLocalDatabase, serviceQuery } from '../world/persistence/dev/localDatabase.js'
import { createSqlPlayerData } from '../world/persistence/playerData.js'
import { manualClock, settle } from '../world/testing.js'

// WORLD LOCATION-2 (case 5): two realtime "instances" — two journals, each
// with its own adapter — writing the same players through the real SQL.

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const locate = actor => ({ areaId: actor.areaId, tx: actor.tx, ty: actor.ty, layoutVersion: 'v1' })

async function twoInstances() {
  const db = await openLocalDatabase()
  await db.exec(`INSERT INTO auth.users VALUES ('${A}'), ('${B}')`)
  const clock = manualClock()
  const make = name => {
    const fenced = []
    const data = createSqlPlayerData(serviceQuery(db))
    const journal = new LocationJournal({ store: data, locate, now: clock.now, log: () => {}, onFenced: (userId, epoch) => fenced.push({ name, userId, epoch }) })
    return { journal, fenced }
  }
  const stored = async userId => (await serviceQuery(db)('SELECT area_id, tx, epoch::int, seq::int FROM public.world_player_locations WHERE user_id = $1', [userId])).rows[0]
  const flush = async journal => { journal.tick(); await settle(); await journal.idle() }
  return { db, clock, old: make('old'), next: make('new'), stored, flush }
}

test('two instances: once the newer one claims, every write of the older is stale and fences it; the newer one wins', async () => {
  const { db, old, next, stored, flush } = await twoInstances()
  const actorOld = { areaId: 'pradera', tx: 1, ty: -60 }
  const sOld = old.journal.beginSession(A)
  await old.journal.claim(sOld)
  old.journal.note(sOld, actorOld, { urgent: true })
  await flush(old.journal)
  assert.deepEqual(await stored(A), { area_id: 'pradera', tx: 1, epoch: 1, seq: 1 })
  // The player opens the game on the new instance (a deploy, or a second tab routed elsewhere).
  const sNew = next.journal.beginSession(A)
  assert.equal((await next.journal.claim(sNew)).location.tx, 1, 'the new session restores what the old one saved')
  // The old instance still holds a write (a late checkpoint, its disconnect, its shutdown flush).
  actorOld.tx = 2
  old.journal.note(sOld, actorOld, { urgent: true })
  await flush(old.journal)
  assert.deepEqual(old.fenced, [{ name: 'old', userId: A, epoch: 1 }])
  assert.equal(old.journal.statusOf(sOld), 'fenced')
  assert.deepEqual(await stored(A), { area_id: 'pradera', tx: 1, epoch: 2, seq: 0 }, 'the late write changed nothing')
  next.journal.note(sNew, { areaId: 'cueva-inicial', tx: 10, ty: 11 }, { urgent: true })
  await flush(next.journal)
  assert.deepEqual(await stored(A), { area_id: 'cueva-inicial', tx: 10, epoch: 2, seq: 1 })
  // Even a shutdown flush of the fenced instance writes nothing.
  old.journal.note(sOld, actorOld, { urgent: true })
  await old.journal.flushAll(200)
  assert.deepEqual(await stored(A), { area_id: 'cueva-inicial', tx: 10, epoch: 2, seq: 1 })
  assert.deepEqual(next.fenced, [])
  await db.close()
})

test('two instances, two players: fencing one player never touches the other', async () => {
  const { db, old, next, stored, flush } = await twoInstances()
  const sa = old.journal.beginSession(A); await old.journal.claim(sa)
  const sb = old.journal.beginSession(B); await old.journal.claim(sb)
  await next.journal.claim(next.journal.beginSession(A)) // only A moved to the new instance
  old.journal.note(sa, { areaId: 'pradera', tx: 3, ty: -60 }, { urgent: true })
  old.journal.note(sb, { areaId: 'pradera', tx: 4, ty: -60 }, { urgent: true })
  await flush(old.journal)
  assert.deepEqual(old.fenced.map(f => f.userId), [A])
  assert.equal(old.journal.statusOf(sb), 'claimed')
  assert.deepEqual(await stored(B), { area_id: 'pradera', tx: 4, epoch: 1, seq: 1 })
  await db.close()
})

test('restart: a fresh journal (seq back to 0) still writes, because its new claim brings a new epoch', async () => {
  const { db, old, next, stored, flush } = await twoInstances()
  const s1 = old.journal.beginSession(A); await old.journal.claim(s1)
  for (let tx = 1; tx <= 5; tx++) { old.journal.note(s1, { areaId: 'pradera', tx, ty: -60 }, { urgent: true }); await flush(old.journal) }
  assert.equal((await stored(A)).seq, 5)
  // The process dies; the new one starts with an empty journal (seq counter at 0).
  const s2 = next.journal.beginSession(A)
  assert.equal((await next.journal.claim(s2)).location.tx, 5)
  next.journal.note(s2, { areaId: 'pradera', tx: 9, ty: -60 }, { urgent: true })
  await flush(next.journal)
  assert.deepEqual(await stored(A), { area_id: 'pradera', tx: 9, epoch: 2, seq: 1 })
  await db.close()
})
