// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { SKILLS_RULES_VERSION } from '../../skills/domain/balance'
import { CROPS } from '../../skills/domain/farming'
import { RESOURCES, RESOURCE_BY_ID } from '../../skills/domain/resources'
import { createSkillsWorldPolicy, type SettlementStore } from './skillsWorldPolicy'

// RESOURCE YIELD-2 on the SKILLS side: the stock ranges are rules, the range
// travels to WORLD privately, and a stale node is final without paying.

const TICK = 600
const NODE = { id: 'pradera:-6:-64:tree', resourceKind: 'tree', variantId: 'tree', areaId: 'pradera', tx: -6, ty: -64, zone: 0, biome: 'grassland' }

function store(commit: SettlementStore['commitWork']): SettlementStore & { calls: number } {
  const counter = { calls: 0 }
  return Object.assign(counter, {
    async playerState() { return { xp: {}, materials: {}, pokemon: [] } },
    async commitWork(input: Parameters<SettlementStore['commitWork']>[0]) { counter.calls++; return commit(input) },
  })
}

const attempt = (actionId: string) => ({ actionId, playerId: 'p', pokemon: { instanceId: 123, speciesId: 123 }, node: NODE, workKind: 'chop', requestedAt: 0, attemptMs: TICK })

describe('stock ranges are rules', () => {
  it('common tree 2–4, pine 2–3, basic rock 1–3, every advanced resource 1', () => {
    expect(Object.fromEntries(RESOURCES.map(resource => [resource.id, resource.stock]))).toEqual({
      common_tree: [2, 4], pine_tree: [2, 3], hardwood_tree: [1, 1], boreal_tree: [1, 1],
      stone_outcrop: [1, 3], coal_seam: [1, 1], iron_vein: [1, 1], gold_vein: [1, 1], crystal_cluster: [1, 1],
    })
    for (const resource of RESOURCES) {
      expect(resource.stock[0]).toBeGreaterThanOrEqual(1)
      expect(resource.stock[1]).toBeLessThanOrEqual(4)
    }
  })

  it('the rules version is skills-1.3', () => {
    expect(SKILLS_RULES_VERSION).toBe('skills-1.3')
  })

  it('Agricultura is not stocked', () => {
    expect(CROPS.length).toBeGreaterThan(0)
    expect(CROPS.every(crop => !('stock' in crop))).toBe(true)
  })
})

describe('the authorization carries the stock range to WORLD, never to the requester', () => {
  it('stock is a top-level, WORLD-private field; details stay the requester’s terms only', async () => {
    const policy = createSkillsWorldPolicy({ store: store(async () => ({ applied: true, settlement: null })), random: () => 0.5 })
    const answer = await policy.authorizeWorkAttempt(attempt('00000000-0000-4000-8000-000000000001-00')) as Record<string, unknown>
    expect(answer).toMatchObject({ ok: true, stock: { min: 2, max: 4 } })
    expect(JSON.stringify(answer.details)).not.toMatch(/stock|attempts|chance|durationMs/)
    expect(RESOURCE_BY_ID.get('common_tree')!.stock).toEqual([2, 4])
  })
})

describe('a stale node is final and pays nothing', () => {
  it('stale_node → not retryable, nothing marked settled: the next settle recomputes and asks the store again', async () => {
    let answer: { applied: boolean; settlement: null; rejected?: string } = { applied: false, settlement: null, rejected: 'stale_node' }
    const s = store(async () => answer)
    const clock = { t: 0 }
    const policy = createSkillsWorldPolicy({ store: s, random: () => 0, now: () => clock.t })
    await policy.authorizeWorkAttempt(attempt('00000000-0000-4000-8000-000000000002-00'))
    clock.t += 60_000
    const stale = await policy.settleWork({ actionId: '00000000-0000-4000-8000-000000000002-00', playerId: 'p', world: null })
    expect(stale).toEqual({ ok: false, retryable: false, reason: 'stale-node' })
    // Not settled in memory: a second call goes to the store again (it would have been a stored duplicate otherwise).
    answer = { applied: true, settlement: null }
    const again = await policy.settleWork({ actionId: '00000000-0000-4000-8000-000000000002-00', playerId: 'p', world: null })
    expect(again).toMatchObject({ ok: true, status: 'applied' })
    expect(s.calls).toBe(2)
  })
})
