import { describe, expect, it, vi } from 'vitest'
import { createPopulation, retireEncounter, tickPopulation } from './engine'
import { caveArea, caveNest, populationConfig, row, gridGeometry, deps } from './testing'

const config = populationConfig([caveArea([caveNest('clock', row(0, 0, 8))], { idle: { dormantAfterMs: 300_000, staggerMinMs: 0, staggerMaxMs: 0 } })])
const input = (now: number) => ({ now, activeAreas: new Set(['cueva-inicial']), geometry: () => gridGeometry(), random: () => 0 })
function populated() {
  const created = createPopulation(config, deps)
  if (!created.ok) throw new Error('fixture config rejected')
  const result = tickPopulation(created.state, config, deps, input(0))
  if (!result.ok) throw new Error(result.reason)
  const alive = Object.values(result.state.nests).flatMap(n => n.alive)
  expect(alive).toHaveLength(2)
  return { state: result.state, alive }
}

describe('audit F2 / F3 acceptance', () => {
  it('F2 rejects a retirement earlier than an already accepted retirement', () => {
    const { state, alive } = populated()
    const first = retireEncounter(state, config, { encounterId: alive[0].id, cause: 'defeated', now: 100_000, random: () => 0 })
    if (!first.ok) throw new Error(first.reason)
    const random = vi.fn(() => 0)
    expect(retireEncounter(first.state, config, { encounterId: alive[1].id, cause: 'defeated', now: 1, random })).toEqual({ ok: false, reason: 'clock-regressed', state: first.state })
    expect(random).not.toHaveBeenCalled()
  })

  it('F2 rejects a tick earlier than an already accepted retirement', () => {
    const { state, alive } = populated()
    const first = retireEncounter(state, config, { encounterId: alive[0].id, cause: 'defeated', now: 100_000, random: () => 0 })
    if (!first.ok) throw new Error(first.reason)
    expect(tickPopulation(first.state, config, deps, input(1))).toEqual({ ok: false, reason: 'clock-regressed', state: first.state })
  })

  it('F2 a duplicate is a no-op even if its finite timestamp is stale', () => {
    const { state, alive } = populated()
    const first = retireEncounter(state, config, { encounterId: alive[0].id, cause: 'defeated', now: 100_000, random: () => 0 })
    if (!first.ok) throw new Error(first.reason)
    const random = vi.fn(() => 0)
    const duplicate = retireEncounter(first.state, config, { encounterId: alive[0].id, cause: 'defeated', now: 1, random })
    expect(duplicate).toEqual({ ok: false, reason: 'not-alive', state: first.state })
    expect(duplicate.state).toBe(first.state)
    expect(random).not.toHaveBeenCalled()
  })

  it('F3 mismatched configuration cannot retire or consume randomness', () => {
    const { state, alive } = populated()
    const random = vi.fn(() => 0)
    const other = { ...config, namespace: 'other-instance' }
    expect(retireEncounter(state, other, { encounterId: alive[0].id, cause: 'defeated', now: 1, random })).toEqual({ ok: false, reason: 'namespace-mismatch', state })
    expect(random).not.toHaveBeenCalled()
  })
})
