import { describe, expect, it } from 'vitest'
import { NODE_BY_ID } from '../domain/catalog/nodes'
import type { GatheringCheck } from '../domain/gathering'
import { castLine, FISHING_TIMING, IDLE_FISHING, reelLine, tickFishing } from './fishingSession'
import { describeNodeStatus, formatCountdown, resolveNodeStatus, type NodeStatusInput } from './nodeStatus'

const ok = { ok: true, preview: {} } as unknown as GatheringCheck
const rejected = (reason: 'level_too_low' | 'insufficient_energy' | 'tool_broken'): GatheringCheck => ({ ok: false, reason })
const input = (overrides: Partial<NodeStatusInput> = {}): NodeStatusInput => ({
  check: ok, remainingCharges: 3, inventoryFits: true, phase: 'idle', ...overrides,
})

describe('node status', () => {
  it('follows the action timeline first', () => {
    expect(resolveNodeStatus(input({ phase: 'working' }))).toBe('in_progress')
    expect(resolveNodeStatus(input({ phase: 'rare' }))).toBe('rare_drop')
    expect(resolveNodeStatus(input({ phase: 'success' }))).toBe('success')
    expect(resolveNodeStatus(input({ phase: 'cooldown' }))).toBe('cooldown')
  })

  it('prioritises hard requirements, then depletion, space and energy', () => {
    expect(resolveNodeStatus(input({ check: rejected('level_too_low'), remainingCharges: 0 }))).toBe('locked_level')
    expect(resolveNodeStatus(input({ check: rejected('tool_broken') }))).toBe('tool_broken')
    expect(resolveNodeStatus(input({ check: rejected('insufficient_energy'), remainingCharges: 0 }))).toBe('depleted')
    expect(resolveNodeStatus(input({ check: rejected('insufficient_energy'), inventoryFits: false }))).toBe('inventory_full')
    expect(resolveNodeStatus(input({ check: rejected('insufficient_energy') }))).toBe('no_energy')
    expect(resolveNodeStatus(input())).toBe('available')
  })

  it('describes blocked states with the numbers the player needs', () => {
    const node = NODE_BY_ID.get('iron_vein')!
    const context = { node, level: 12, respawnInSeconds: 75, energyNeeded: 20, energyHave: 7.6 }
    expect(describeNodeStatus('locked_level', context)).toMatchObject({ title: 'Requiere Minería Nv. 15', detail: 'Tenés Nv. 12', canAct: false })
    expect(describeNodeStatus('no_energy', context).detail).toBe('Necesitás 20; tenés 7')
    expect(describeNodeStatus('depleted', context).detail).toBe('Se recupera en 1:15')
    expect(describeNodeStatus('available', context).canAct).toBe(true)
    expect(formatCountdown(0)).toBe('0:00')
  })
})

describe('fishing session', () => {
  const T0 = 10_000

  it('waits, bites and catches inside the window', () => {
    const cast = castLine(T0, () => 0)
    expect(cast).toMatchObject({ phase: 'waiting', biteAt: T0 + FISHING_TIMING.minWaitMs })
    const bite = tickFishing(cast, cast.biteAt)
    expect(bite.phase).toBe('bite')
    expect(reelLine(bite, cast.biteAt + 100).phase).toBe('caught')
  })

  it('scares the fish when reeling early and loses it when late', () => {
    const cast = castLine(T0, () => 1)
    expect(cast.biteAt).toBe(T0 + FISHING_TIMING.maxWaitMs)
    expect(reelLine(cast, T0 + 10).phase).toBe('escaped')
    expect(tickFishing(cast, cast.biteEndsAt).phase).toBe('escaped')
    expect(reelLine(cast, cast.biteEndsAt + 1).phase).toBe('escaped')
  })

  it('stays idle until cast', () => {
    expect(tickFishing(IDLE_FISHING, T0)).toBe(IDLE_FISHING)
    expect(reelLine(IDLE_FISHING, T0)).toBe(IDLE_FISHING)
  })
})
