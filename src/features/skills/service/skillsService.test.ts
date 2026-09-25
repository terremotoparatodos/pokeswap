import { describe, expect, it } from 'vitest'
import { AUTHORIZATION_TTL_MS, SETTLE_EARLY_TOLERANCE_MS } from '../domain/balance'
import { createSeededRandom } from '../domain/rng'
import { totalXpForLevel } from '../domain/xpCurve'
import type { WorkTarget } from '../domain/workRules'
import { createManualClock, createMemorySkillsStore } from './memoryAdapters'
import { createSkillsService, type WorkAttemptInput } from './skillsService'

function setup() {
  const store = createMemorySkillsStore()
  const clock = createManualClock(1_000_000)
  const service = createSkillsService({ progress: store.progress, ledger: store.ledger, clock, random: createSeededRandom(7) })
  return { store, clock, service }
}

const attempt = (actionId: string, target: WorkTarget = { kind: 'gather', resourceId: 'common_tree' }, speciesId = 123): WorkAttemptInput => ({
  actionId, playerId: 'ash', worker: { instanceId: 'poke-1', speciesId }, target,
})

function authorizeAndWait(env: ReturnType<typeof setup>, input: WorkAttemptInput): number {
  const auth = env.service.authorizeWorkAttempt(input)
  if (!auth.allowed) throw new Error(auth.reason)
  env.clock.advance(auth.durationMs)
  return auth.durationMs
}

describe('authorizeWorkAttempt', () => {
  it('allows level-appropriate work and returns what WORLD needs to run it', () => {
    const { service } = setup()
    const auth = service.authorizeWorkAttempt(attempt('a1'))
    expect(auth).toMatchObject({ allowed: true, actionId: 'a1', skillId: 'woodcutting', requiredLevel: 1, playerLevel: 1, aptitude: 5, xp: 10 })
    if (!auth.allowed) return
    expect(auth.durationMs).toBeGreaterThan(0)
    expect(auth.reward).toMatchObject({ itemId: 'common_log', min: 1, max: 2 })
  })

  it('refuses with a sentence the player can act on', () => {
    const { service } = setup()
    const auth = service.authorizeWorkAttempt(attempt('a1', { kind: 'gather', resourceId: 'iron_vein' }, 74))
    expect(auth).toMatchObject({ allowed: false, reason: 'level_too_low', message: 'Requiere Minería 20', requiredLevel: 20 })
  })

  it('refuses a reused actionId, before and after settlement', () => {
    const env = setup()
    authorizeAndWait(env, attempt('a1'))
    expect(env.service.authorizeWorkAttempt(attempt('a1'))).toMatchObject({ allowed: false, reason: 'duplicate_action' })
    env.service.settleWork('a1', { outcome: 'completed' })
    expect(env.service.authorizeWorkAttempt(attempt('a1'))).toMatchObject({ allowed: false, reason: 'duplicate_action' })
  })

  it('refuses malformed input from a hostile caller', () => {
    const { service } = setup()
    const bad = [
      { ...attempt(''), actionId: '' },
      { ...attempt('x'), playerId: '' },
      { ...attempt('x'), worker: { instanceId: 'p', speciesId: 1.5 } },
      { ...attempt('x'), target: null as unknown as WorkTarget },
      { ...attempt('x'.repeat(200)) },
    ]
    for (const input of bad) expect(service.authorizeWorkAttempt(input)).toMatchObject({ allowed: false, reason: 'invalid_request' })
  })

  it('does not change anything by itself: no XP, no items, until settle', () => {
    const { service, store } = setup()
    service.authorizeWorkAttempt(attempt('a1'))
    expect(store.progress.xpOf('ash').woodcutting).toBe(0)
    expect(store.inventoryOf('ash')).toEqual({})
  })
})

describe('settleWork', () => {
  it('grants XP and items for a completed action', () => {
    const env = setup()
    authorizeAndWait(env, attempt('a1'))
    const result = env.service.settleWork('a1', { outcome: 'completed' })
    expect(result.status).toBe('settled')
    if (result.status !== 'settled') return
    expect(result.settlement.xpGained).toBe(10)
    expect(env.store.progress.xpOf('ash').woodcutting).toBe(10)
    expect(env.store.inventoryOf('ash').common_log).toBe(result.settlement.rewards[0].quantity)
  })

  it('is idempotent: the same actionId settled twice rewards once', () => {
    const env = setup()
    authorizeAndWait(env, attempt('a1'))
    const first = env.service.settleWork('a1', { outcome: 'completed' })
    const second = env.service.settleWork('a1', { outcome: 'completed' })
    expect(first.status).toBe('settled')
    expect(second.status).toBe('already_settled')
    if (first.status !== 'settled' || second.status !== 'already_settled') return
    expect(second.settlement).toEqual(first.settlement)
    expect(env.store.progress.xpOf('ash').woodcutting).toBe(10)
    expect(env.store.inventoryOf('ash').common_log).toBe(first.settlement.rewards[0].quantity)
    expect(env.store.settlementCount()).toBe(1)
  })

  it('stays idempotent when a cancel and a completion race for the same action', () => {
    const env = setup()
    authorizeAndWait(env, attempt('a1'))
    env.service.settleWork('a1', { outcome: 'cancelled' })
    const late = env.service.settleWork('a1', { outcome: 'completed' })
    expect(late).toMatchObject({ status: 'already_settled', settlement: { outcome: 'cancelled', xpGained: 0, rewards: [] } })
    expect(env.store.progress.xpOf('ash').woodcutting).toBe(0)
  })

  it('stays idempotent when the ledger loses a concurrent commit', () => {
    const env = setup()
    authorizeAndWait(env, attempt('a1'))
    // Simulate another server instance committing first, between our read and our write.
    const realCommit = env.store.ledger.commitSettlement
    let raced = false
    env.store.ledger.commitSettlement = settlement => {
      if (!raced) {
        raced = true
        realCommit({ ...settlement, rewards: [], xpGained: 10, settledAt: settlement.settledAt - 1 })
        return false
      }
      return realCommit(settlement)
    }
    const result = env.service.settleWork('a1', { outcome: 'completed' })
    expect(result.status).toBe('already_settled')
    expect(env.store.settlementCount()).toBe(1)
    expect(env.store.progress.xpOf('ash').woodcutting).toBe(10)
  })

  it('refuses to settle a completion before the work could have finished', () => {
    const env = setup()
    const auth = env.service.authorizeWorkAttempt(attempt('a1'))
    if (!auth.allowed) throw new Error('allowed')
    env.clock.advance(auth.durationMs - SETTLE_EARLY_TOLERANCE_MS - 1)
    expect(env.service.settleWork('a1', { outcome: 'completed' })).toEqual({ status: 'too_early' })
    env.clock.advance(1)
    expect(env.service.settleWork('a1', { outcome: 'completed' }).status).toBe('settled')
  })

  it('closes an action cancelled by WORLD without paying', () => {
    const env = setup()
    env.service.authorizeWorkAttempt(attempt('a1'))
    const result = env.service.settleWork('a1', { outcome: 'cancelled' })
    expect(result).toMatchObject({ status: 'settled', settlement: { outcome: 'cancelled', xpGained: 0, rewards: [] } })
  })

  it('does not pay an authorization that expired', () => {
    const env = setup()
    env.service.authorizeWorkAttempt(attempt('a1'))
    env.clock.advance(AUTHORIZATION_TTL_MS + 1)
    expect(env.service.settleWork('a1', { outcome: 'completed' })).toMatchObject({ status: 'settled', settlement: { outcome: 'cancelled', xpGained: 0 } })
  })

  it('does not know actions it never authorized', () => {
    const { service } = setup()
    expect(service.settleWork('ghost', { outcome: 'completed' })).toEqual({ status: 'unknown_action' })
    expect(service.settleWork('', { outcome: 'completed' })).toEqual({ status: 'invalid_request' })
    expect(service.settleWork('a1', { outcome: 'granted' as never })).toEqual({ status: 'invalid_request' })
  })

  it('reports level-ups and what they unlock', () => {
    const env = setup()
    env.store.setXp('ash', 'mining', totalXpForLevel(10) - 5)
    authorizeAndWait(env, attempt('m1', { kind: 'gather', resourceId: 'stone_outcrop' }, 74))
    const result = env.service.settleWork('m1', { outcome: 'completed' })
    if (result.status !== 'settled') throw new Error(result.status)
    expect(result.levelUpLine).toBe('Minería 9 → 10')
    expect(result.unlocks.map(unlock => unlock.id)).toEqual(['coal_seam', 'rhythm-10'])
  })

  it('stops XP at the provisional cap but keeps paying items', () => {
    const env = setup()
    env.store.setXp('ash', 'woodcutting', totalXpForLevel(50))
    authorizeAndWait(env, attempt('w1'))
    const result = env.service.settleWork('w1', { outcome: 'completed' })
    if (result.status !== 'settled') throw new Error(result.status)
    expect(result.settlement.xpGained).toBe(0)
    expect(result.settlement.levelAfter).toBe(50)
    expect(result.settlement.rewards[0].quantity).toBeGreaterThan(0)
  })
})

describe('a full farming cycle through the service', () => {
  it('plants, tends and harvests with XP at each step and items only at harvest', () => {
    const env = setup()
    const plot = { plotId: 'huerta-1', kind: 'town' as const, cropId: null, tended: false }
    authorizeAndWait(env, attempt('f1', { kind: 'farm', action: 'plant', plot: { ...plot, stage: 'EMPTY' }, cropId: 'oran' }, 1))
    expect(env.service.settleWork('f1', { outcome: 'completed' })).toMatchObject({ status: 'settled', settlement: { xpGained: 8, rewards: [] } })

    authorizeAndWait(env, attempt('f2', { kind: 'farm', action: 'tend', plot: { ...plot, stage: 'GROWING', cropId: 'oran' } }, 1))
    expect(env.service.settleWork('f2', { outcome: 'completed' })).toMatchObject({ settlement: { xpGained: 4, rewards: [] } })

    authorizeAndWait(env, attempt('f3', { kind: 'farm', action: 'harvest', plot: { ...plot, stage: 'READY', cropId: 'oran', tended: true } }, 1))
    const harvest = env.service.settleWork('f3', { outcome: 'completed' })
    if (harvest.status !== 'settled') throw new Error(harvest.status)
    expect(harvest.settlement.xpGained).toBe(18)
    expect(harvest.settlement.rewards[0].quantity).toBeGreaterThanOrEqual(3)
    expect(env.store.progress.xpOf('ash').farming).toBe(30)
  })
})
