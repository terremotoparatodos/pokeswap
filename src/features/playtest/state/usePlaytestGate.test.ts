// The kill switch as a running tab sees it: first read, then the poll.
//
// `resolveAccess` is pure and tested on its own; what can still go wrong is the
// loop around it. A poll that fails must not turn a known CLOSED back into an
// open playtest, and a tab that never got an answer must not start playing.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaytestGateConfig } from '../domain/playtestGate'

const fetchGateConfig = vi.fn<() => Promise<PlaytestGateConfig | null>>()

vi.mock('../api/gateApi', () => ({ fetchGateConfig: () => fetchGateConfig(), GATE_POLL_MS: 45_000 }))
vi.mock('../playtestBuild', () => ({ isPlaytest: true, PLAYTEST_MODE: 'on' }))

const OPEN: PlaytestGateConfig = { state: 'open', message: null, accessCode: null }
const CLOSED: PlaytestGateConfig = { state: 'closed', message: 'Terminó', accessCode: null }

/** A fresh singleton per test: the composable keeps its state at module level. */
async function startGate() {
  vi.resetModules()
  const { usePlaytestGate } = await import('./usePlaytestGate')
  const gate = usePlaytestGate()
  gate.start()
  await vi.advanceTimersByTimeAsync(0)
  return gate
}

const poll = () => vi.advanceTimersByTimeAsync(45_000)

describe('usePlaytestGate poll', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fetchGateConfig.mockReset()
    sessionStorage.clear()
  })
  afterEach(() => vi.useRealTimers())

  it('closes an open tab on the next poll', async () => {
    fetchGateConfig.mockResolvedValueOnce(OPEN).mockResolvedValueOnce(CLOSED)
    const gate = await startGate()
    expect(gate.access.value.status).toBe('open')
    await poll()
    expect(gate.access.value).toEqual({ status: 'closed', message: 'Terminó' })
    gate.stop()
  })

  it('keeps a known CLOSED closed when later polls fail', async () => {
    fetchGateConfig.mockResolvedValueOnce(CLOSED).mockResolvedValue(null)
    const gate = await startGate()
    expect(gate.access.value.status).toBe('closed')
    await poll()
    await poll()
    await gate.recheck()
    expect(gate.access.value.status).toBe('closed')
    expect(fetchGateConfig).toHaveBeenCalledTimes(4)
    gate.stop()
  })

  it('keeps the last OPEN through a failed poll and still closes afterwards', async () => {
    fetchGateConfig.mockResolvedValueOnce(OPEN).mockResolvedValueOnce(null).mockResolvedValueOnce(CLOSED)
    const gate = await startGate()
    await poll()
    expect(gate.access.value.status).toBe('open')
    await poll()
    expect(gate.access.value.status).toBe('closed')
    gate.stop()
  })

  it('never opens without an answer: no network at all stays on the gate screen', async () => {
    fetchGateConfig.mockResolvedValue(null)
    const gate = await startGate()
    expect(gate.access.value.status).toBe('checking')
    await poll()
    expect(gate.access.value.status).toBe('checking')
    gate.stop()
  })

  it('opens once the gate finally answers open', async () => {
    fetchGateConfig.mockResolvedValueOnce(null).mockResolvedValueOnce(OPEN)
    const gate = await startGate()
    expect(gate.access.value.status).toBe('checking')
    await poll()
    expect(gate.access.value.status).toBe('open')
    gate.stop()
  })
})
