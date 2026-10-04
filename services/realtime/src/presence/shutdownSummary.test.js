import test from 'node:test'
import assert from 'node:assert/strict'
import { shutdownFlushLine, shutdownFlushSummary } from './shutdownSummary.js'
import { LocationJournal } from './locationJournal.js'
import { activeHost } from './hostLifecycle.js'

// WORLD LOCATION-4 (design L1): a row refused because another session owns it is never
// reported as saved.

const A = 'aaaaaaaa-0000-4000-8000-000000000001'
const empty = { sent: 0, applied: 0, duplicate: 0, stale: 0, hostRefused: 0, left: 0, timedOut: false }

test('L1: a flush whose only row is stale logs «0 guardadas, 1 rechazada»', async () => {
  const host = activeHost({ generation: 1 })
  const store = {
    async locationClaim() { return { status: 'claimed', epoch: 1, location: null } },
    async locationSave(rows) { return { status: 'ok', results: new Map(rows.map(r => [r.userId, 'stale'])) } },
  }
  const journal = new LocationJournal({ store, host, locate: a => ({ areaId: a.areaId, tx: a.tx, ty: a.ty, layoutVersion: 'v' }), log: () => {} })
  journal.stop()
  const session = journal.beginSession(A, host.sessionKey())
  await journal.claim(session)
  journal.note(session, { areaId: 'pradera', tx: 1, ty: 2 }, { urgent: true })
  const drained = await journal.flushAll(1_000)
  assert.deepEqual(drained, { ...empty, sent: 1, stale: 1 })
  const late = await journal.flushAll(1_000)
  assert.deepEqual(shutdownFlushSummary(drained, late), { saved: 0, refused: 1, unsaved: 0, timedOut: false })
  assert.equal(shutdownFlushLine(drained, late), '[location] shutdown flush: 0 guardadas, 1 rechazada (otra sesión ya reclamó), 0 sin guardar')
})

test('L1: saved counts applied and duplicate; unsaved is what the last pass left plus host refusals; the deadline is named', () => {
  const drained = { ...empty, sent: 5, applied: 3, duplicate: 1, stale: 1, left: 2, timedOut: true }
  const late = { ...empty, sent: 2, applied: 1, hostRefused: 0, left: 1 }
  assert.deepEqual(shutdownFlushSummary(drained, late), { saved: 5, refused: 1, unsaved: 1, timedOut: true })
  assert.equal(shutdownFlushLine(drained, late), '[location] shutdown flush: 5 guardadas, 1 rechazada (otra sesión ya reclamó), 1 sin guardar (plazo vencido)')
  assert.equal(shutdownFlushLine(null, { ...empty, hostRefused: 2 }), '[location] shutdown flush: 0 guardadas, 0 rechazadas (otra sesión ya reclamó), 2 sin guardar')
  assert.equal(shutdownFlushLine(null, empty), null, 'nothing to say')
  assert.equal(shutdownFlushLine(null, { sent: 0, left: 0, timedOut: false }), null, 'location off: the service answers without a journal')
})
