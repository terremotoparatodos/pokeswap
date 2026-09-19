// The pieces, on their own (R32.4).
//
// The end-to-end tests prove the boundary holds. These prove *why* it holds,
// one piece at a time — the id format, the whitelist, the bounded ledger and
// the room's lifecycle — because a property that only shows up in a full
// battle is a property nobody can debug.

import { describe, expect, it } from 'vitest'
import { formatActionId, parseActionId } from './actionId'
import { createIdempotencyLedger } from './idempotency'
import { createAuthorityItemCatalog } from './itemCatalog'
import { validateTransportAction } from './validate'
import { createExpeditionRoomCore } from './expeditionRoomCore'
import { createManualClock } from './clock'
import { createFixedSeedSource } from './seed'
import { createBattleAuthority } from './authority'
import { createAuthorityHarness } from './harness'
import type { AuthorityEventEnvelope } from './protocol'

const WELL_FORMED = {
  actionId: 'controller-a:1',
  battleId: 'battle-1',
  catalogVersion: '1.oras.db4ae081bb58',
  battleRulesVersion: 'pokeswap-battle-v1',
  intent: { kind: 'useMove', combatantId: 'ally-0', moveId: 85, targetId: 'wild-0' },
}

describe('the action id', () => {
  it('round-trips what a client builds', () => {
    expect(parseActionId(formatActionId('controller-a', 12)))
      .toEqual({ controllerId: 'controller-a', sequence: 12 })
  })

  it('tolerates a colon inside the controller id', () => {
    // Splitting on the *last* colon, so a controller id that already contains
    // one — a namespaced id, a URN — does not silently become someone else's.
    expect(parseActionId('auth:supabase:abc:7'))
      .toEqual({ controllerId: 'auth:supabase:abc', sequence: 7 })
  })

  it('refuses every other spelling', () => {
    const bad = ['', 'controller-a', 'controller-a:', ':1', 'controller-a:0', 'controller-a:01',
      'controller-a:-1', 'controller-a: 1', 'controller-a:1 ', 'controller-a:1.0', 'controller-a:1e3',
      'controller-a:' + '9'.repeat(30), 'x'.repeat(200) + ':1', 1, null, undefined, {}, ['a:1']]
    for (const value of bad) expect(parseActionId(value)).toBeNull()
  })
})

describe('the transport validator', () => {
  it('accepts a well-formed action and rebuilds it field by field', () => {
    const result = validateTransportAction(WELL_FORMED)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.action).toEqual(WELL_FORMED)
  })

  it('copies out only what it knows, so extra fields cannot ride along', () => {
    const loaded = validateTransportAction({
      ...WELL_FORMED,
      damage: 9999,
      seed: 1,
      revision: 42,
      intent: { ...WELL_FORMED.intent, damage: 9999, critical: true, seed: 1 },
    })
    const plain = validateTransportAction(WELL_FORMED)
    expect(loaded).toEqual(plain)
  })

  it('names the right refusal for the right mistake', () => {
    const reasonOf = (payload: unknown) => {
      const result = validateTransportAction(payload)
      return result.ok ? 'ok' : result.reason
    }
    expect(reasonOf(null)).toBe('INVALID_SCHEMA')
    expect(reasonOf([WELL_FORMED])).toBe('INVALID_SCHEMA')
    expect(reasonOf({ ...WELL_FORMED, actionId: 'nope' })).toBe('INVALID_ACTION_ID')
    expect(reasonOf({ ...WELL_FORMED, battleId: '' })).toBe('INVALID_SCHEMA')
    expect(reasonOf({ ...WELL_FORMED, catalogVersion: 3 })).toBe('INVALID_SCHEMA')
    expect(reasonOf({ ...WELL_FORMED, intent: { kind: 'advanceTime', deltaMs: 5 } })).toBe('UNKNOWN_ACTION')
    expect(reasonOf({ ...WELL_FORMED, intent: { kind: 'mindControl', combatantId: 'a' } })).toBe('UNKNOWN_ACTION')
    expect(reasonOf({ ...WELL_FORMED, intent: { kind: 7 } })).toBe('INVALID_SCHEMA')
    expect(reasonOf({ ...WELL_FORMED, intent: { kind: 'useMove', combatantId: 'a' } })).toBe('INVALID_SCHEMA')
    expect(reasonOf({ ...WELL_FORMED, intent: { kind: 'useItem', combatantId: 'a', targetId: 'b', item: {} } }))
      .toBe('INVALID_SCHEMA')
  })

  it('keeps an optional field optional without letting it be rubbish', () => {
    const without = validateTransportAction(WELL_FORMED)
    expect(without.ok && without.action.intent).toEqual(WELL_FORMED.intent)
    const withTarget = validateTransportAction({
      ...WELL_FORMED, intent: { ...WELL_FORMED.intent, targetId: 'wild-0' },
    })
    expect(withTarget.ok && withTarget.action.intent).toMatchObject({ targetId: 'wild-0' })
    const rubbish = validateTransportAction({
      ...WELL_FORMED, intent: { ...WELL_FORMED.intent, targetId: 42 },
    })
    expect(rubbish.ok).toBe(false)
  })
})

describe('the idempotency ledger', () => {
  const entry = (actionId: string, revision: number) =>
    ({ actionId, revision, events: [] as readonly AuthorityEventEnvelope[] })

  it('remembers an accepted action and raises its controller s floor', () => {
    const ledger = createIdempotencyLedger()
    expect(ledger.recall('a:1')).toBeNull()
    expect(ledger.acceptedFloor('a')).toBe(0)

    ledger.remember({ controllerId: 'a', sequence: 1 }, entry('a:1', 1))
    expect(ledger.recall('a:1')).toEqual(entry('a:1', 1))
    expect(ledger.acceptedFloor('a')).toBe(1)
    // One controller's floor is not another's.
    expect(ledger.acceptedFloor('b')).toBe(0)
  })

  it('never lowers a floor, whatever order the actions arrive in', () => {
    const ledger = createIdempotencyLedger()
    ledger.remember({ controllerId: 'a', sequence: 9 }, entry('a:9', 1))
    ledger.remember({ controllerId: 'a', sequence: 4 }, entry('a:4', 2))
    expect(ledger.acceptedFloor('a')).toBe(9)
  })

  it('evicts the oldest entries and stays bounded', () => {
    const ledger = createIdempotencyLedger({ maxEntries: 4 })
    for (let sequence = 1; sequence <= 10; sequence += 1) {
      ledger.remember({ controllerId: 'a', sequence }, entry(`a:${sequence}`, sequence))
    }
    expect(ledger.size).toBe(4)
    expect(ledger.recall('a:1')).toBeNull()
    expect(ledger.recall('a:6')).toBeNull()
    // The four newest survive.
    expect(ledger.recall('a:7')).toEqual(entry('a:7', 7))
    expect(ledger.recall('a:10')).toEqual(entry('a:10', 10))
    // And the floor survives the eviction, which is what keeps a forgotten
    // action from being run a second time.
    expect(ledger.acceptedFloor('a')).toBe(10)
  })
})

describe('the item catalog', () => {
  it('answers with the server s numbers, or with nothing', () => {
    const items = createAuthorityItemCatalog()
    expect(items.itemEffect('potion', null)).toEqual({ kind: 'healHp', amount: 20 })
    expect(items.itemEffect('ether', 85)).toEqual({ kind: 'restorePp', moveId: 85, amount: 10 })
    // An Ether has to say which move; without one there is nothing to restore.
    expect(items.itemEffect('ether', null)).toBeNull()
    expect(items.itemEffect('elixir-of-nine-thousand', null)).toBeNull()
    expect(items.ball('great-ball')).toEqual({ id: 'great-ball', bonus: 1.5 })
    expect(items.ball('cheat-ball')).toBeNull()
  })
})

describe('the room skeleton', () => {
  const room = () => createExpeditionRoomCore({
    roomId: 'room-1',
    clock: createManualClock(0),
    seedSource: createFixedSeedSource(1),
    catalog: { catalogVersion: 'x' } as never,
  })

  it('replaces a controller s old socket when it reconnects', () => {
    const subject = room()
    subject.join({ sessionId: 's1', controllerId: 'a' })
    subject.join({ sessionId: 's2', controllerId: 'a' })
    expect(subject.participants()).toEqual([{ sessionId: 's2', controllerId: 'a' }])

    subject.join({ sessionId: 's3', controllerId: 'b' })
    subject.leave('s2')
    expect(subject.participants()).toEqual([{ sessionId: 's3', controllerId: 'b' }])
  })

  it('has nothing to say before a battle exists', () => {
    const subject = room()
    subject.join({ sessionId: 's1', controllerId: 'a' })
    expect(subject.battle()).toBeNull()
    expect(subject.update()).toEqual({ events: [], snapshot: null })
    const refused = subject.message('s1', 'expedition:action', {})
    expect(refused).toMatchObject({ kind: 'rejected', reason: 'UNKNOWN_BATTLE' })
  })
})

describe('version validation at creation', () => {
  it('refuses to start a battle on a catalog this server does not run', async () => {
    const harness = await createAuthorityHarness({
      party: [{ speciesId: 25, level: 50, moves: ['thunderbolt'] }],
      wild: [{ speciesId: 213, level: 50, moves: ['tackle'] }],
    })
    expect(() => createBattleAuthority({
      battleId: 'b', sides: [], catalog: harness.catalog,
      clock: createManualClock(0), seedSource: createFixedSeedSource(1),
      supported: { catalogVersions: ['1.oras.somethingelse'], battleRulesVersions: ['pokeswap-battle-v1'] },
    })).toThrow(/not supported/)

    expect(() => createBattleAuthority({
      battleId: 'b', sides: [], catalog: harness.catalog,
      clock: createManualClock(0), seedSource: createFixedSeedSource(1),
      supported: { catalogVersions: [harness.catalog.catalogVersion], battleRulesVersions: ['pokeswap-battle-v0'] },
    })).toThrow(/not supported/)
  })
})
