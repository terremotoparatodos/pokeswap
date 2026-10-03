import { describe, expect, it } from 'vitest'
import { ENTRY_TIMEOUT_MS, RECONNECT_TIMEOUT_MS, initialWorldEntry, nextWorldEntry, waitLimitMs, type WorldEntryEvent, type WorldEntryState } from './worldEntry'

const run = (state: WorldEntryState, ...events: WorldEntryEvent['type'][]) =>
  events.reduce((current, type) => nextWorldEntry(current, { type } as WorldEntryEvent), state)
const online = () => initialWorldEntry(true)

describe('world entry machine (PRESENCE UX-1)', () => {
  it('starts offline without realtime and never leaves it', () => {
    const offline = initialWorldEntry(false)
    expect(offline.phase).toBe('offline')
    for (const type of ['snapshot', 'prepared', 'lost', 'timeout', 'replaced', 'retry', 'renew', 'prepare-failed'] as const) {
      expect(nextWorldEntry(offline, { type })).toBe(offline)
    }
    expect(waitLimitMs(offline)).toBeNull()
  })

  it('goes live only after a snapshot and the area being prepared, in that order', () => {
    expect(run(online(), 'prepared').phase).toBe('connecting')
    const received = run(online(), 'snapshot')
    expect(received).toMatchObject({ phase: 'connecting', authority: true, prepared: false, live: false })
    expect(run(received, 'prepared')).toMatchObject({ phase: 'ready', authority: true, prepared: true, live: true, sceneShown: true })
  })

  it('a loss while the area was being prepared voids that snapshot', () => {
    const state = run(online(), 'snapshot', 'lost', 'prepared')
    expect(state).toMatchObject({ phase: 'connecting', authority: false, live: false })
  })

  it('ignores snapshots once ready (area changes are the engine’s)', () => {
    const ready = run(online(), 'snapshot', 'prepared')
    expect(nextWorldEntry(ready, { type: 'snapshot' })).toBe(ready)
  })

  it('a lost room after entering is a reconnect that keeps the shown scene', () => {
    const state = run(online(), 'snapshot', 'prepared', 'lost')
    expect(state).toMatchObject({ phase: 'reconnecting', live: false, sceneShown: true })
    expect(run(state, 'snapshot', 'prepared').phase).toBe('ready')
  })

  it('times out with the wording of the wait that ran out', () => {
    expect(waitLimitMs(online())).toBe(ENTRY_TIMEOUT_MS)
    expect(ENTRY_TIMEOUT_MS).toBe(12_000)
    expect(RECONNECT_TIMEOUT_MS).toBe(15_000)
    expect(run(online(), 'timeout')).toMatchObject({ phase: 'connection-error', failed: 'entry' })
    const reconnecting = run(online(), 'snapshot', 'prepared', 'lost')
    expect(waitLimitMs(reconnecting)).toBe(RECONNECT_TIMEOUT_MS)
    expect(run(reconnecting, 'timeout')).toMatchObject({ phase: 'connection-error', failed: 'reconnect' })
  })

  it('no timeout once authority arrived (the area is being prepared)', () => {
    const received = run(online(), 'snapshot')
    expect(waitLimitMs(received)).toBeNull()
    expect(nextWorldEntry(received, { type: 'timeout' })).toBe(received)
  })

  it('a failed preparation is an error, not a reveal', () => {
    expect(run(online(), 'snapshot', 'prepare-failed')).toMatchObject({ phase: 'connection-error', failed: 'entry', live: false })
  })

  it('retry resumes the wait that failed and nothing else', () => {
    expect(run(online(), 'timeout', 'retry').phase).toBe('connecting')
    expect(run(online(), 'snapshot', 'prepared', 'lost', 'timeout', 'retry').phase).toBe('reconnecting')
    const ready = run(online(), 'snapshot', 'prepared')
    expect(nextWorldEntry(ready, { type: 'retry' })).toBe(ready)
  })

  it('out of connection-error only retry starts a new wait: a late snapshot or preparation changes nothing', () => {
    for (const error of [run(online(), 'timeout'), run(online(), 'snapshot', 'prepared', 'lost', 'timeout'), run(online(), 'snapshot', 'prepare-failed')]) {
      expect(error.phase).toBe('connection-error')
      for (const type of ['snapshot', 'prepared', 'lost', 'timeout', 'prepare-failed', 'renew'] as const) {
        expect(nextWorldEntry(error, { type })).toBe(error)
      }
      expect(nextWorldEntry(error, { type: 'retry' })).toMatchObject({ phase: error.failed === 'reconnect' ? 'reconnecting' : 'connecting', authority: false, live: false })
      // 4001 is final, not another attempt.
      expect(nextWorldEntry(error, { type: 'replaced' }).phase).toBe('replaced')
    }
  })

  it('a replaced session is final: no retry, no renew, no loss brings it back', () => {
    const replaced = run(online(), 'snapshot', 'prepared', 'replaced')
    expect(replaced).toMatchObject({ phase: 'replaced', live: false })
    for (const type of ['retry', 'renew', 'lost', 'timeout', 'snapshot', 'prepared'] as const) {
      expect(nextWorldEntry(replaced, { type }).phase).toBe('replaced')
    }
  })

  it('a session change waits again without going through an error', () => {
    expect(run(online(), 'snapshot', 'prepared', 'renew')).toMatchObject({ phase: 'reconnecting', live: false })
    const error = run(online(), 'timeout')
    expect(nextWorldEntry(error, { type: 'renew' })).toBe(error)
  })

  it('stores no place: no area, tile or coordinate in the state', () => {
    const keys = Object.keys(run(online(), 'snapshot', 'prepared'))
    expect(keys.sort()).toEqual(['authority', 'failed', 'live', 'phase', 'prepared', 'sceneShown'])
  })
})
