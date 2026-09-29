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

// RESOURCE YIELD-2 recovery: a duplicate reports the stored settlement (M-3),
// and closing an authorization is idempotent and never unpays (M-5).

const ID = '00000000-0000-4000-8000-000000000003-01'
const canonical = (overrides: Record<string, unknown> = {}) => ({
  action_id: ID, user_id: 'u', skill_id: 'woodcutting', outcome: 'completed', xp_gained: 10, xp_after: 1_250,
  rewards: [{ itemId: 'common_log', quantity: 2, bonus: true }], level_before: 9, level_after: 10, node_id: NODE.id, rules_version: 'skills-1.3',
  ...overrides,
})

describe('a duplicate reports the canonical settlement', () => {
  it('applied → reply lost → retry with the same id → duplicate carrying the ORIGINAL materials, XP and levels', async () => {
    // The first commit is written by the database and then its reply is lost.
    let lost = true
    const stored: unknown[] = []
    const s = store(async input => {
      if (lost) { lost = false; stored.push(input); throw new Error('reply lost') }
      return { applied: false, settlement: canonical() }
    })
    const clock = { t: 0 }
    // Each settle re-rolls the drop in memory: the retry's own roll must never reach the player.
    const policy = createSkillsWorldPolicy({ store: s, random: () => 0.99, now: () => clock.t })
    await policy.authorizeWorkAttempt(attempt(ID))
    clock.t += 60_000
    const first = await policy.settleWork({ actionId: ID, playerId: 'p', world: null })
    expect(first).toEqual({ ok: false, retryable: true, reason: 'store-unavailable' })
    const retry = await policy.settleWork({ actionId: ID, playerId: 'p', world: null }) as { ok: boolean; status: string; summary: Record<string, unknown> }
    expect(retry).toMatchObject({ ok: true, status: 'duplicate' })
    expect(retry.summary).toMatchObject({
      skillId: 'woodcutting', xpGained: 10, xpAfter: 1_250, levelBefore: 9, levelAfter: 10, duplicate: true,
      rewards: [{ itemId: 'common_log', quantity: 2, bonus: true }],
    })
    expect(retry.summary.levelUpLine).toEqual(expect.any(String))
    expect(s.calls).toBe(2)
    expect(stored).toHaveLength(1)
  })

  it('a stored cancellation reports nothing paid; a malformed or foreign row falls back to the bare duplicate', async () => {
    const policy = (row: unknown) => {
      const clock = { t: 0 }
      const p = createSkillsWorldPolicy({ store: store(async () => ({ applied: false, settlement: row as never })), random: () => 0, now: () => clock.t })
      return { p, clock }
    }
    for (const [row, expected] of [
      [canonical({ outcome: 'cancelled' }), { xpGained: 0, rewards: [], duplicate: true }],
      [canonical({ action_id: 'someone-else-00' }), { skillId: 'woodcutting', duplicate: true }],
      [canonical({ xp_gained: -1 }), { skillId: 'woodcutting', duplicate: true }],
      [null, { skillId: 'woodcutting', duplicate: true }],
    ] as const) {
      const { p, clock } = policy(row)
      await p.authorizeWorkAttempt(attempt(ID))
      clock.t += 60_000
      const answer = await p.settleWork({ actionId: ID, playerId: 'p', world: null }) as { summary: Record<string, unknown> }
      expect(answer.summary).toMatchObject(expected)
      if (!('xpGained' in expected)) expect(answer.summary).toEqual(expected)
    }
  })
})

describe('closing an authorization (cancelWork) is idempotent and never unpays', () => {
  const setup = (commit: SettlementStore['commitWork']) => {
    const s = store(commit)
    const clock = { t: 0 }
    const policy = createSkillsWorldPolicy({ store: s, random: () => 0, now: () => clock.t })
    return { s, clock, policy }
  }

  it('after stale_node: closed once, twice — later settles are refused without reaching the store', async () => {
    const { s, clock, policy } = setup(async () => ({ applied: false, settlement: null, rejected: 'stale_node' }))
    await policy.authorizeWorkAttempt(attempt(ID))
    clock.t += 60_000
    expect(await policy.settleWork({ actionId: ID, playerId: 'p', world: null })).toMatchObject({ reason: 'stale-node' })
    policy.cancelWork({ actionId: ID })
    policy.cancelWork({ actionId: ID })
    expect(await policy.settleWork({ actionId: ID, playerId: 'p', world: null })).toEqual({ ok: false, retryable: false, reason: 'expired' })
    expect(s.calls).toBe(1)
  })

  it('after success and after a duplicate: a close is a no-op, a later retry still dedupes in the store', async () => {
    for (const reply of [{ applied: true, settlement: canonical() }, { applied: false, settlement: canonical() }]) {
      const { s, clock, policy } = setup(async () => reply)
      await policy.authorizeWorkAttempt(attempt(ID))
      clock.t += 60_000
      expect(await policy.settleWork({ actionId: ID, playerId: 'p', world: null })).toMatchObject({ ok: true })
      policy.cancelWork({ actionId: ID })
      expect(await policy.settleWork({ actionId: ID, playerId: 'p', world: null })).toMatchObject({ ok: true })
      expect(s.calls).toBe(2)
    }
  })

  it('after an ambiguous failure the authorization stays open: the same id can still be confirmed by dedupe', async () => {
    let down = true
    const { s, clock, policy } = setup(async () => { if (down) throw new Error('down'); return { applied: false, settlement: canonical() } })
    await policy.authorizeWorkAttempt(attempt(ID))
    clock.t += 60_000
    expect(await policy.settleWork({ actionId: ID, playerId: 'p', world: null })).toMatchObject({ retryable: true })
    down = false
    expect(await policy.settleWork({ actionId: ID, playerId: 'p', world: null })).toMatchObject({ ok: true, status: 'duplicate' })
    expect(s.calls).toBe(2)
  })

  it('a cancellation before any settle closes it without pay; a completion after it is refused', async () => {
    const { s, clock, policy } = setup(async () => ({ applied: true, settlement: canonical() }))
    await policy.authorizeWorkAttempt(attempt(ID))
    policy.cancelWork({ actionId: ID })
    clock.t += 60_000
    expect(await policy.settleWork({ actionId: ID, playerId: 'p', world: null })).toEqual({ ok: false, retryable: false, reason: 'expired' })
    expect(s.calls).toBe(0)
  })
})
