import test from 'node:test'
import assert from 'node:assert/strict'
import { LOCATION_MODES, LocationService, locationMode } from './locationService.js'
import { PRESENCE_PROTOCOL_REVISION, versionInfo } from '../observability/version.js'
import { PresenceMetrics } from '../observability/metrics.js'

// WORLD LOCATION-2, commit 8: the WORLD_LOCATION_PERSISTENCE gate (D-L4, D-L5)
// and the rollback (matrix case 24).

const store = { locationClaim: async () => ({ status: 'claimed', epoch: 1, location: null }), locationSave: async rows => new Map(rows.map(r => [r.userId, 'applied'])) }

test('the flag: exactly off, shadow or on; anything else (missing, cased, padded, boolean) is off', () => {
  assert.deepEqual(LOCATION_MODES, ['off', 'shadow', 'on'])
  for (const value of ['off', 'shadow', 'on']) assert.equal(locationMode(value), value)
  for (const value of [undefined, null, '', 'ON', 'Shadow', ' on', 'on ', 'true', '1', 'yes', true, 1, {}]) assert.equal(locationMode(value), 'off', String(value))
})

test('effective mode: shadow/on need a store with both location operations, otherwise "unavailable" (= off)', () => {
  assert.equal(new LocationService({ mode: 'on', store }).effective, 'on')
  assert.equal(new LocationService({ mode: 'shadow', store }).effective, 'shadow')
  for (const partial of [null, {}, { locationClaim: store.locationClaim }, { locationSave: store.locationSave }]) {
    const service = new LocationService({ mode: 'on', store: partial })
    assert.equal(service.effective, 'unavailable')
    assert.equal(service.active, false)
    assert.equal(service.journal, null)
  }
  const off = new LocationService({ mode: 'off', store })
  assert.equal(off.effective, 'off')
  assert.equal(off.persists('11111111-1111-4111-8111-111111111111'), false)
})

test('the process reads WORLD_LOCATION_PERSISTENCE once, at load: on alone → unavailable; shadow + a local database → shadow; garbage → off', async () => {
  const saved = { ...process.env }
  try {
    process.env.WORLD_LOCATION_PERSISTENCE = 'on'
    delete process.env.WORLD_PLAYERDATA
    const { metrics } = await import('../observability/metrics.js')
    await import(new URL('../rooms/PresenceRoom.js?flag=on-without-store', import.meta.url).href)
    assert.deepEqual({ mode: metrics.location().mode, effective: metrics.location().effective }, { mode: 'on', effective: 'unavailable' })
    process.env.WORLD_PLAYERDATA = 'pglite'
    process.env.WORLD_LOCATION_PERSISTENCE = 'shadow'
    const withStore = await import(new URL('../rooms/PresenceRoom.js?flag=shadow-pglite', import.meta.url).href)
    assert.deepEqual({ mode: metrics.location().mode, effective: metrics.location().effective }, { mode: 'shadow', effective: 'shadow' })
    withStore.configureLocationPersistence({ mode: 'off' })
    process.env.WORLD_LOCATION_PERSISTENCE = 'definitely-not-a-mode'
    await import(new URL('../rooms/PresenceRoom.js?flag=garbage', import.meta.url).href)
    assert.deepEqual({ mode: metrics.location().mode, effective: metrics.location().effective }, { mode: 'off', effective: 'off' })
  } finally {
    for (const key of ['WORLD_LOCATION_PERSISTENCE', 'WORLD_PLAYERDATA']) if (key in saved) process.env[key] = saved[key]; else delete process.env[key]
  }
})

test('D-L5: the flag and its counters are on /metrics only; /version does not change with the flag', () => {
  const metrics = new PresenceMetrics({ loopDelay: { percentile: () => 0, max: 0 } })
  const service = new LocationService({ mode: 'shadow', store })
  metrics.location = () => service.stats()
  const snapshot = metrics.snapshot()
  assert.equal(snapshot.location.mode, 'shadow')
  assert.equal(snapshot.location.effective, 'shadow')
  assert.ok(snapshot.location.journal)
  assert.deepEqual(Object.keys(versionInfo({ commit: 'abcdef1', startedAt: 'x' })).sort(), ['commit', 'protocol', 'service', 'startedAt'])
  // Revision 6 is WORLD LOCATION-4's close codes (4409 / 4503), the same in every mode: the flag itself changes nothing a client sees.
  assert.equal(PRESENCE_PROTOCOL_REVISION, 6)
  assert.deepEqual(versionInfo({ commit: 'abcdef1', startedAt: 'x' }), { service: 'pokeswap-presence', commit: 'abcdef1', protocol: 6, startedAt: 'x' })
  assert.doesNotMatch(JSON.stringify(versionInfo({ commit: 'abcdef1', startedAt: 'x' })), /location|shadow|epoch/)
})

test('/metrics location section is aggregates only (no ids, areas, tiles, epochs or layout versions)', async () => {
  const service = new LocationService({ mode: 'on', store, now: () => 1_000 })
  const userId = '11111111-1111-4111-8111-111111111111'
  const session = service.begin(userId)
  await service.claim(session)
  service.note(session, { areaId: 'cueva-inicial', tx: 1234, ty: 4321 }, { urgent: true })
  service.journal.tick()
  await service.journal.idle()
  const text = JSON.stringify(service.stats())
  assert.doesNotMatch(text, /1111|cueva|pradera|ciudad|1234|4321|1\.[0-9a-f]{12}/)
})

test('active persistence makes at most one location_save per second and pays the layout fingerprints at start', async () => {
  const { LOCATION_TICK_MS } = await import('./locationJournal.js')
  const { layoutVersion } = await import('../world/layoutVersion.js')
  assert.equal(LOCATION_TICK_MS, 1_000, 'one batch per tick, one in flight: <= 1 invocation/s')
  const realSetInterval = globalThis.setInterval
  const intervals = []
  globalThis.setInterval = (fn, ms) => { intervals.push(ms); return realSetInterval(fn, 1e9) }
  let service
  try {
    service = new LocationService({ mode: 'shadow', store })
    service.start()
  } finally {
    globalThis.setInterval = realSetInterval
    service?.journal.stop()
  }
  assert.deepEqual(intervals, [1_000])
  const started = performance.now()
  layoutVersion('pradera')
  assert.ok(performance.now() - started < 10, 'already computed when the service was built')
})
